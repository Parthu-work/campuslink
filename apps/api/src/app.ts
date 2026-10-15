import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Redis } from 'ioredis';
import { API_PREFIX } from '@campuslink/shared';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { requestId } from './middleware/request-id.js';
import { rejectOperatorKeys } from './middleware/no-operators.js';
import { corsMiddleware, buildOriginMatcher } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes.js';
import { tenantResolver } from './http/tenant.middleware.js';
import { createLimiters } from './http/rate-limit.js';
import { authenticate, csrfProtection } from './http/auth.middleware.js';
import { defineModule, type RouteRegistry, type PipelineDeps } from './http/registry.js';
import { buildOpenApi } from './http/openapi.js';
import { TokenService } from './lib/jwt.js';
import { FieldCipher } from './lib/crypto.js';
import type { MailProvider } from './lib/mailer.js';
import { AuthService } from './modules/auth/auth.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { UsersService } from './modules/users/users.service.js';
import { meRoutes, adminUserRoutes } from './modules/users/users.routes.js';
import { tenantRoutes } from './modules/tenants/tenants.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { PlatformService } from './modules/platform/platform.service.js';
import { platformRoutes } from './modules/platform/platform.routes.js';
import { uploader } from './http/upload.js';
import { safeFetch } from './lib/safe-fetch.js';
import { requireTenantId } from './lib/context.js';
import { LocalDiskStorage, S3StorageStub, type StorageProvider } from './lib/storage.js';
import { InlineJobQueue, type JobQueue } from './lib/jobs.js';
import { DisabledSmsProvider } from './lib/sms.js';
import { FilesService } from './modules/files/files.service.js';
import { fileRoutes } from './modules/files/files.routes.js';
import { ImportsService, IMPORT_JOB } from './modules/imports/imports.service.js';
import { WhitelistService } from './modules/imports/whitelist.service.js';
import { importRoutes } from './modules/imports/imports.routes.js';
import { ProfilesService } from './modules/profiles/profiles.service.js';
import { profileRoutes } from './modules/profiles/profiles.routes.js';
import { InvitesService } from './modules/verification/invites.service.js';
import { VerificationService } from './modules/verification/verification.service.js';
import { verificationRoutes } from './modules/verification/verification.routes.js';
import { IdempotencyService } from './modules/idempotency/idempotency.service.js';
import { botCheck } from './http/bot.middleware.js';
import { disabledBotProtection, TurnstileBotProtection, type BotProtection } from './lib/bot.js';
import { RealtimeGateway } from './http/realtime.js';
import { JitsiVideoProvider, dailyVideoStub, hmsVideoStub, type VideoProvider } from './lib/video.js';
import { WebPushSender, type PushSender } from './modules/notifications/push.js';
import { DELIVER_JOB, NotificationsService } from './modules/notifications/notifications.service.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { SafetyService } from './modules/moderation/safety.service.js';
import { moderationRoutes } from './modules/moderation/moderation.routes.js';
import { MessagingService } from './modules/messaging/messaging.service.js';
import { messagingRoutes } from './modules/messaging/messaging.routes.js';
import { COMPLETE_JOB, REMINDER_JOB, SessionsService } from './modules/sessions/sessions.service.js';
import { sessionRoutes } from './modules/sessions/sessions.routes.js';
import { MentorsService } from './modules/mentorship/mentors.service.js';
import { EXPIRE_JOB, RequestsService } from './modules/mentorship/requests.service.js';
import { mentorshipRoutes } from './modules/mentorship/mentorship.routes.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  readiness: Record<string, ReadinessCheck>;
  mailer: MailProvider;
  redis?: Redis | undefined;
  /** Multiplies every rate limit (tests use a large value except where limits are under test). */
  rateLimitScale?: number;
  fetchImpl?: typeof fetch;
  storage?: StorageProvider;
  jobs?: JobQueue;
  /** SSRF-safe fetcher used for remote imports, push and bot checks (injected in tests). */
  fetcher?: typeof safeFetch;
  bot?: BotProtection;
  video?: VideoProvider;
  push?: PushSender;
}

export function createApp({
  env,
  logger,
  readiness,
  mailer,
  redis,
  rateLimitScale = 1,
  fetchImpl,
  storage,
  jobs,
  fetcher = safeFetch,
  bot,
  video,
  push,
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.set('query parser', 'simple');

  const isAllowedOrigin = buildOriginMatcher(env.CORS_ALLOWED_ORIGINS);
  const tokens = new TokenService(env.JWT_ACCESS_SECRET, env.JWT_TICKET_SECRET, env.JWT_ACCESS_TTL_SECONDS);
  const cipher = new FieldCipher(env.FIELD_ENCRYPTION_KEY);
  const limiters = createLimiters(redis, rateLimitScale);
  const registry: RouteRegistry = [];
  const botProtection =
    bot ??
    (env.BOT_PROTECTION === 'turnstile' && env.TURNSTILE_SECRET
      ? new TurnstileBotProtection(env.TURNSTILE_SECRET, fetcher)
      : disabledBotProtection);
  const pipeline: PipelineDeps = {
    registry,
    uploader,
    limiters,
    authenticate: authenticate(tokens),
    csrf: csrfProtection(isAllowedOrigin),
    bot: botCheck(botProtection),
    idempotency: new IdempotencyService(),
  };
  const realtime = new RealtimeGateway({ tokens, rootDomain: env.APP_ROOT_DOMAIN, isAllowedOrigin, logger });
  const videoProvider =
    video ??
    (env.VIDEO_PROVIDER === '100ms'
      ? hmsVideoStub()
      : env.VIDEO_PROVIDER === 'daily'
        ? dailyVideoStub()
        : new JitsiVideoProvider(
            env.JITSI_BASE_URL,
            env.JITSI_APP_ID && env.JITSI_APP_SECRET
              ? { appId: env.JITSI_APP_ID, secret: env.JITSI_APP_SECRET }
              : undefined,
          ));
  const pushSender =
    push ??
    new WebPushSender(
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
        : null,
      fetcher,
    );

  const authService = new AuthService({
    tokens,
    mailer,
    cipher,
    logger,
    webOrigin: env.WEB_ORIGIN,
    refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
    hibpEnabled: env.HIBP_ENABLED,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const store =
    storage ??
    (env.STORAGE_DRIVER === 's3' ? new S3StorageStub() : new LocalDiskStorage(env.STORAGE_LOCAL_DIR));
  const queue = jobs ?? new InlineJobQueue();
  const filesService = new FilesService(store);
  const profilesService = new ProfilesService(cipher, filesService);
  const usersService = new UsersService(authService, profilesService);
  const platformService = new PlatformService(authService);
  const invitesService = new InvitesService(cipher, mailer, authService);
  const verificationService = new VerificationService({
    cipher,
    mailer,
    sms: new DisabledSmsProvider(),
    profiles: profilesService,
    files: filesService,
    invites: invitesService,
  });
  const importsService = new ImportsService({ files: filesService, cipher, jobs: queue, fetcher });
  const whitelistService = new WhitelistService(cipher);
  authService.onEmailVerified = (userId, email, meta) =>
    verificationService.onEmailVerified(userId, email, meta);
  authService.onUserCreated = (userId) => profilesService.sync(userId);
  queue.register(IMPORT_JOB, (data, progress) => importsService.run(String(data.jobId), progress));

  // ── Mentorship (Phase 3) ─────────────────────────────
  const tenantUrl = authService.tenantUrl.bind(authService);
  const notificationsService = new NotificationsService({
    mailer,
    logger,
    cipher,
    push: pushSender,
    realtime,
    jobs: queue,
    tenantUrl,
  });
  const safetyService = new SafetyService(profilesService);
  const messagingService = new MessagingService({
    cipher,
    files: filesService,
    profiles: profilesService,
    notifications: notificationsService,
    realtime,
  });
  const sessionsService = new SessionsService({
    video: videoProvider,
    jobs: queue,
    profiles: profilesService,
    notifications: notificationsService,
    tenantUrl,
  });
  const mentorsService = new MentorsService({
    profiles: profilesService,
    safety: safetyService,
    sessions: sessionsService,
  });
  const requestsService = new RequestsService({
    mentors: mentorsService,
    sessions: sessionsService,
    messaging: messagingService,
    profiles: profilesService,
    notifications: notificationsService,
    jobs: queue,
  });
  sessionsService.slotCheck = mentorsService.checkSlot;
  sessionsService.slotList = (mentorId, menteeId, type, days, ignore) =>
    mentorsService.slotsForPair(mentorId, menteeId, type, days, ignore);
  filesService.registerAccess('message_attachment', (fileId, viewer) =>
    messagingService.attachmentAccess(fileId, viewer),
  );
  safetyService.registerTarget('message', (viewer, id) => messagingService.reportTarget(viewer, id));
  safetyService.registerTarget('request', (viewer, id) => requestsService.reportTarget(viewer, id));
  safetyService.onBlock(async (a, b) => {
    await messagingService.setBlocked(a, b, true);
    await requestsService.onBlock(a, b);
    await sessionsService.onBlock(a, b);
  });
  safetyService.onUnblock((a, b) => messagingService.setBlocked(a, b, false));
  realtime.hooks.typingTarget = (auth, conversationId) => messagingService.typingTarget(auth, conversationId);
  usersService.onSuspended = (userId) => realtime.disconnectUser(requireTenantId(), userId);
  queue.register(DELIVER_JOB, (data) => notificationsService.deliver(data));
  queue.register(REMINDER_JOB, (data) => sessionsService.onReminder(data));
  queue.register(COMPLETE_JOB, (data) => sessionsService.onComplete(data));
  queue.register(EXPIRE_JOB, (data) => requestsService.onExpire(data));
  const cookie = {
    secure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
  };

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => String(req.id), autoLogging: env.NODE_ENV !== 'test' }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: env.NODE_ENV === 'production',
    }),
  );
  app.use(corsMiddleware(env.CORS_ALLOWED_ORIGINS));
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(rejectOperatorKeys);
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(API_PREFIX, healthRouter(readiness));
  app.use(API_PREFIX, limiters.global, tenantResolver(env.APP_ROOT_DOMAIN));
  app.use(API_PREFIX, defineModule('tenants', tenantRoutes(), pipeline));
  app.use(API_PREFIX, defineModule('auth', authRoutes(authService, cookie), pipeline));
  app.use(
    API_PREFIX,
    defineModule('users', [...meRoutes(usersService), ...adminUserRoutes(usersService)], pipeline),
  );
  app.use(API_PREFIX, defineModule('audit', auditRoutes(), pipeline));
  app.use(API_PREFIX, defineModule('platform', platformRoutes(platformService, readiness), pipeline));
  app.use(API_PREFIX, defineModule('files', fileRoutes(filesService), pipeline));
  app.use(
    API_PREFIX,
    defineModule('imports', importRoutes(importsService, whitelistService, invitesService), pipeline),
  );
  app.use(
    API_PREFIX,
    defineModule('verification', verificationRoutes(verificationService, invitesService), pipeline),
  );
  app.use(API_PREFIX, defineModule('profiles', profileRoutes(profilesService), pipeline));
  app.use(
    API_PREFIX,
    defineModule('mentorship', mentorshipRoutes(mentorsService, requestsService, sessionsService), pipeline),
  );
  app.use(API_PREFIX, defineModule('sessions', sessionRoutes(sessionsService), pipeline));
  app.use(API_PREFIX, defineModule('messaging', messagingRoutes(messagingService), pipeline));
  app.use(API_PREFIX, defineModule('notifications', notificationRoutes(notificationsService), pipeline));
  app.use(API_PREFIX, defineModule('moderation', moderationRoutes(safetyService), pipeline));

  const openapi = buildOpenApi(registry);
  app.get(`${API_PREFIX}/openapi.json`, (_req, res) => res.json(openapi));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  app.locals.registry = registry;
  app.locals.services = {
    auth: authService,
    users: usersService,
    platform: platformService,
    tokens,
    cipher,
    files: filesService,
    imports: importsService,
    verification: verificationService,
    profiles: profilesService,
    queue,
    realtime,
    notifications: notificationsService,
    messaging: messagingService,
    sessions: sessionsService,
    mentors: mentorsService,
    requests: requestsService,
    safety: safetyService,
  };
  return app;
}
