import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { MemoryMailProvider, SmtpMailProvider } from './lib/mailer.js';
import { BullJobQueue, InlineJobQueue } from './lib/jobs.js';
import { runRetention } from './lib/maintenance.js';
import { BillingService } from './modules/billing/billing.service.js';
import { DigestService } from './modules/notifications/digest.service.js';
import { NextStepService } from './modules/next-step/next-step.service.js';
import { PeersService } from './modules/peers/peers.service.js';
import { ParentDigestService } from './modules/notifications/parent-digest.service.js';
// [slot: G9]
import { RosterSyncService } from './modules/imports/roster-sync.service.js';
// [slot: A G10 G11 G13]
import { GraphService } from './modules/graph/graph.service.js';
import { CopilotIndexService } from './modules/copilot/copilot-index.service.js';
// [slot: B G12]
import { NetworkService } from './modules/network/network.service.js';
import type { InsightsService } from './modules/insights/insights.service.js';
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
import { GuardianService } from './modules/verification/guardian.service.js';
import type { InactivityService } from './modules/privacy/inactivity.service.js';

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
    productInsights: InsightsService;
    inactivity: InactivityService;
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
    runRetention(files, logger, services.privacy, services.productInsights, services.inactivity).catch(
      (err: unknown) => logger.error({ err }, 'retention failed'),
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
  // Members who turned 18 (B2): hourly, one run per college that has any (job ids dedupe per day).
  const adultTick = () =>
    GuardianService.enqueueDue(jobs).catch((err: unknown) => logger.error({ err }, 'adulthood tick failed'));
  if (runsJobs) {
    setTimeout(adultTick, 60_000).unref();
    setInterval(adultTick, 3600_000).unref();
  }

  // Billing (B10): hourly, one daily run per college (job ids dedupe per day): seats, overdue
  // invoices, reminders and read-only.
  const billingTick = () =>
    BillingService.enqueueDaily(jobs).catch((err: unknown) => logger.error({ err }, 'billing tick failed'));
  if (runsJobs) {
    setTimeout(billingTick, 90_000).unref();
    setInterval(billingTick, 3600_000).unref();
  }

  // The weekly digest (prompt 1b, R8): hourly; one run per college a week, from Monday 09:00 IST.
  const digestTick = () =>
    DigestService.enqueueWeekly(jobs).catch((err: unknown) => logger.error({ err }, 'digest tick failed'));
  if (runsJobs) {
    setTimeout(digestTick, 120_000).unref();
    setInterval(digestTick, 3600_000).unref();
  }

  // The weekly Next Step (prompt 2, G7): hourly; one run per college an ISO week, from Monday 19:00 IST.
  const nextStepTick = () =>
    NextStepService.enqueueWeekly(jobs).catch((err: unknown) =>
      logger.error({ err }, 'next step tick failed'),
    );
  // Senior Buddy matching (prompt 2, G7): hourly; one run per college a day.
  const buddyTick = () =>
    PeersService.enqueueDaily(jobs).catch((err: unknown) => logger.error({ err }, 'buddy tick failed'));
  // The parent digest (prompt 2, G8): hourly; one run per college a month, from the 1st (IST).
  const parentTick = () =>
    ParentDigestService.enqueueMonthly(jobs).catch((err: unknown) =>
      logger.error({ err }, 'parent digest tick failed'),
    );
  if (runsJobs) {
    setTimeout(parentTick, 210_000).unref();
    setInterval(parentTick, 3600_000).unref();
  }
  // [slot: G9]
  // The roster sync (prompt 2, G9): hourly; one run per college a day, from 02:00 (IST).
  const rosterTick = () =>
    RosterSyncService.enqueueDue(jobs).catch((err: unknown) =>
      logger.error({ err }, 'roster sync tick failed'),
    );
  if (runsJobs) {
    setTimeout(rosterTick, 240_000).unref();
    setInterval(rosterTick, 3600_000).unref();
  }
  // [slot: A G10 G11 G13]
  // The Placement Graph (prompt 2, G10): hourly; one run per college a day, from 02:00 IST.
  const graphTick = () =>
    GraphService.enqueueNightly(jobs).catch((err: unknown) => logger.error({ err }, 'graph tick failed'));
  if (runsJobs) {
    setTimeout(graphTick, 240_000).unref();
    setInterval(graphTick, 3600_000).unref();
  }
  // The Career Copilot's index (prompt 2, G11): hourly; one run per college a day, from 03:00 IST.
  const copilotTick = () =>
    CopilotIndexService.enqueueDaily(jobs).catch((err: unknown) =>
      logger.error({ err }, 'copilot index tick failed'),
    );
  if (runsJobs) {
    setTimeout(copilotTick, 270_000).unref();
    setInterval(copilotTick, 3600_000).unref();
  }
  // [slot: B G12]
  // The network's reconcile (prompt 2, G12, ADR 0014 N19): every 15 minutes, one run per college and
  // window (projections, candidacies, hires, credentials and the yearly key rotation).
  const networkTick = () =>
    NetworkService.enqueueReconcile(jobs).catch((err: unknown) =>
      logger.error({ err }, 'network tick failed'),
    );
  if (runsJobs) {
    setTimeout(networkTick, 240_000).unref();
    setInterval(networkTick, 15 * 60_000).unref();
  }
  if (runsJobs) {
    setTimeout(nextStepTick, 150_000).unref();
    setInterval(nextStepTick, 3600_000).unref();
    setTimeout(buddyTick, 180_000).unref();
    setInterval(buddyTick, 3600_000).unref();
  }

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
