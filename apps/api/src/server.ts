import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { MemoryMailProvider, SmtpMailProvider } from './lib/mailer.js';
import { BullJobQueue, InlineJobQueue } from './lib/jobs.js';
import { runRetention } from './lib/maintenance.js';
import type { PrivacyService } from './modules/privacy/privacy.service.js';
import { connectTenantCacheBus } from './modules/tenants/tenant.cache.js';
import { createApp } from './app.js';
import { syncIndexes } from './db/connect.js';
import { runMigrations } from './db/migrations.js';
import { ClamdScanner } from './lib/clamav.js';
import { storageFromEnv } from './lib/storage-factory.js';
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
  await runMigrations(logger);
  logger.info('connected to MongoDB and Redis');

  connectTenantCacheBus({
    publish: (slug) => void redis.publish('tenant:invalidate', slug),
    subscribe: (onSlug) => {
      void subscriber.subscribe('tenant:invalidate');
      subscriber.on('message', (_ch, slug) => onSlug(slug));
    },
  });

  const fileStore = storageFromEnv(env);
  // Three minutes: a 200 MB study video is streamed to clamd and scanned before it is stored.
  const clamd =
    env.MALWARE_SCANNER === 'clamav'
      ? new ClamdScanner({ address: env.CLAMAV_ADDRESS, timeoutMs: 180_000 })
      : null;
  const readiness = {
    mongo: async () => mongoose.connection.readyState === 1,
    redis: async () => (await redis.ping()) === 'PONG',
    // Uploads fail closed without the scanner, so it is part of readiness when configured.
    ...(clamd ? { clamav: () => clamd.ping() } : {}),
    ...(fileStore.ready ? { storage: fileStore.ready } : {}),
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
  // An `api` process only queues jobs; `worker` and `all` run them.
  const runsJobs = env.PROCESS_ROLE !== 'api';
  const jobs =
    env.JOBS_DRIVER === 'inline' ? new InlineJobQueue() : new BullJobQueue(bullConnection, logger, runsJobs);
  const app = createApp({
    env,
    logger,
    readiness,
    mailer,
    redis,
    jobs,
    storage: fileStore.storage,
    rateLimitScale: env.RATE_LIMIT_SCALE,
  });
  const services = app.locals.services as {
    files: FilesService;
    realtime: RealtimeGateway;
    privacy: PrivacyService;
  };
  // A worker serves only its health and readiness (for the container check), never the API.
  const server =
    env.PROCESS_ROLE === 'worker'
      ? createServer(
          (req, res) =>
            void healthOnly(req.url ?? '', readiness).then(([status, body]) => {
              res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
            }),
        ).listen(env.API_PORT, () => logger.info({ port: env.API_PORT, role: 'worker' }, 'worker running'))
      : app.listen(env.API_PORT, () =>
          logger.info({ port: env.API_PORT, jobs: env.JOBS_DRIVER, role: env.PROCESS_ROLE }, 'api listening'),
        );
  if (env.PROCESS_ROLE === 'worker') services.realtime.emitThrough(createAdapter(ioPub, ioSub));
  else services.realtime.attach(server, createAdapter(ioPub, ioSub));
  const files = services.files;
  const retention = () =>
    runRetention(files, logger, services.privacy).catch((err: unknown) =>
      logger.error({ err }, 'retention failed'),
    );
  // Timers that queue background work run where jobs run (an `api` process leaves them to workers).
  if (runsJobs) {
    setTimeout(retention, 30_000).unref();
    setInterval(retention, 6 * 3600_000).unref();
  }

  // Ingestion: every minute, queue fetches for due news and job sources, and due job alerts
  // (job ids dedupe across instances).
  if (env.INGESTION_ENABLED && runsJobs) {
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
  if (runsJobs) setInterval(nudgeTick, 5 * 60_000).unref();

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

/** The worker's only HTTP surface: liveness and readiness of its dependencies (no API). */
async function healthOnly(
  url: string,
  readiness: Record<string, () => Promise<boolean>>,
): Promise<[number, unknown]> {
  if (url === '/api/v1/health') return [200, { ok: true, data: { status: 'ok', role: 'worker' } }];
  if (url !== '/api/v1/ready')
    return [404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }];
  const checks = await Promise.all(
    Object.entries(readiness).map(async ([name, check]) => [name, await check().catch(() => false)] as const),
  );
  const ready = checks.every(([, ok]) => ok);
  return [ready ? 200 : 503, { ok: ready, data: { checks: Object.fromEntries(checks) } }];
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
