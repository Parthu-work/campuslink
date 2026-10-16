import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { MemoryMailProvider, SmtpMailProvider } from './lib/mailer.js';
import { BullJobQueue, InlineJobQueue } from './lib/jobs.js';
import { runRetention } from './lib/maintenance.js';
import { connectTenantCacheBus } from './modules/tenants/tenant.cache.js';
import { createApp } from './app.js';
import { syncIndexes } from './db/connect.js';
import type { FilesService } from './modules/files/files.service.js';
import type { RealtimeGateway } from './http/realtime.js';
import { ContentSourcesService } from './modules/content-sources/sources.service.js';
import { JobSourcesService } from './modules/job-sources/job-sources.service.js';
import { JobsService } from './modules/jobs/jobs.service.js';
import { RoadmapsService } from './modules/roadmaps/roadmaps.service.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
// BullMQ needs its own connection with unlimited retries; pub/sub needs a dedicated subscriber.
const bullConnection = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
const subscriber = new Redis(env.REDIS_URL, { lazyConnect: true });
// Socket.io Redis adapter: events reach users connected to any API instance.
const ioPub = new Redis(env.REDIS_URL, { lazyConnect: true });
const ioSub = new Redis(env.REDIS_URL, { lazyConnect: true });

async function main() {
  await Promise.all([
    mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }),
    redis.connect(),
    bullConnection.connect(),
    subscriber.connect(),
    ioPub.connect(),
    ioSub.connect(),
  ]);
  await syncIndexes();
  logger.info('connected to MongoDB and Redis');

  connectTenantCacheBus({
    publish: (slug) => void redis.publish('tenant:invalidate', slug),
    subscribe: (onSlug) => {
      void subscriber.subscribe('tenant:invalidate');
      subscriber.on('message', (_ch, slug) => onSlug(slug));
    },
  });

  const readiness = {
    mongo: async () => mongoose.connection.readyState === 1,
    redis: async () => (await redis.ping()) === 'PONG',
  };
  const mailer =
    env.MAIL_DRIVER === 'disabled'
      ? new MemoryMailProvider()
      : new SmtpMailProvider(
          {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            ...(env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : {}),
          },
          env.MAIL_FROM,
        );
  const jobs = env.JOBS_DRIVER === 'inline' ? new InlineJobQueue() : new BullJobQueue(bullConnection, logger);
  const app = createApp({
    env,
    logger,
    readiness,
    mailer,
    redis,
    jobs,
    rateLimitScale: env.RATE_LIMIT_SCALE,
  });
  const server = app.listen(env.API_PORT, () =>
    logger.info({ port: env.API_PORT, jobs: env.JOBS_DRIVER }, 'api listening'),
  );

  const services = app.locals.services as { files: FilesService; realtime: RealtimeGateway };
  services.realtime.attach(server, createAdapter(ioPub, ioSub));
  const files = services.files;
  const retention = () =>
    runRetention(files, logger).catch((err: unknown) => logger.error({ err }, 'retention failed'));
  setTimeout(retention, 30_000).unref();
  setInterval(retention, 6 * 3600_000).unref();

  // Ingestion: every minute, queue fetches for due news and job sources, and due job alerts
  // (job ids dedupe across instances).
  if (env.INGESTION_ENABLED) {
    const tick = () =>
      Promise.all([
        ContentSourcesService.enqueueDue(jobs),
        JobSourcesService.enqueueDue(jobs),
        JobsService.enqueueDueAlerts(jobs),
      ]).catch((err: unknown) => logger.error({ err }, 'ingestion tick failed'));
    setTimeout(tick, 15_000).unref();
    setInterval(tick, 60_000).unref();
  }
  // Weekly roadmap goal checks: every five minutes, queue the due ones (job ids dedupe).
  const nudgeTick = () =>
    RoadmapsService.enqueueDueNudges(jobs).catch((err: unknown) =>
      logger.error({ err }, 'nudge tick failed'),
    );
  setInterval(nudgeTick, 5 * 60_000).unref();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    void services.realtime.close();
    server.close(async () => {
      await jobs.close().catch(() => undefined);
      await Promise.allSettled([
        mongoose.disconnect(),
        redis.quit(),
        bullConnection.quit(),
        subscriber.quit(),
        ioPub.quit(),
        ioSub.quit(),
      ]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
