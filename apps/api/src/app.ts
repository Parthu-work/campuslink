import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Redis } from 'ioredis';
import { API_PREFIX } from '@campuslink/shared';
import type { Env } from './config/env.js';
import { httpLogSerializers, type Logger } from './lib/logger.js';
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
import { ModerationService } from './modules/moderation/moderation.service.js';
import { queueRoutes } from './modules/moderation/queue.routes.js';
import { PostsService } from './modules/feed/posts.service.js';
import { FeedService } from './modules/feed/feed.service.js';
import { FollowsService, OneUsefulThingService, StoriesService } from './modules/feed/social.service.js';
import { feedRoutes } from './modules/feed/feed.routes.js';
import { QaService } from './modules/qa/qa.service.js';
import { qaRoutes } from './modules/qa/qa.routes.js';
import { ContentSourcesService, FETCH_JOB } from './modules/content-sources/sources.service.js';
import { sourceRoutes } from './modules/content-sources/sources.routes.js';
import { ALERT_JOB, JobsService } from './modules/jobs/jobs.service.js';
import { jobRoutes } from './modules/jobs/jobs.routes.js';
import { JOB_FETCH_JOB, JobSourcesService } from './modules/job-sources/job-sources.service.js';
import { jobSourceRoutes } from './modules/job-sources/job-sources.routes.js';
import { REFERRAL_EXPIRE_JOB, ReferralsService } from './modules/referrals/referrals.service.js';
import { referralRoutes } from './modules/referrals/referrals.routes.js';
import { NUDGE_JOB, RoadmapsService, installLibraryRoadmaps } from './modules/roadmaps/roadmaps.service.js';
import { roadmapRoutes } from './modules/roadmaps/roadmaps.routes.js';
import { GamificationService } from './modules/gamification/gamification.service.js';
import { gamificationRoutes } from './modules/gamification/gamification.routes.js';
import { EVENT_REMINDER_JOB, EventsService } from './modules/events/events.service.js';
import { eventRoutes } from './modules/events/events.routes.js';
import { AnalyticsService } from './modules/analytics/analytics.service.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { PrivacyService } from './modules/privacy/privacy.service.js';
import { privacyRoutes } from './modules/privacy/privacy.routes.js';
import { consentService } from './modules/consent/consent.service.js';

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

  // ── Feed and content (Phase 4) ─────────────────────────────
  const moderationService = new ModerationService({
    notifications: notificationsService,
    profiles: profilesService,
  });
  let followsRef: FollowsService | null = null;
  const sourcesService = new ContentSourcesService({
    fetcher,
    jobs: queue,
    logger,
    onRemoved: (id) => followsRef?.dropTarget('source', id) ?? Promise.resolve(),
    followerCounts: (ids) => followsRef?.followerCounts('source', ids) ?? Promise.resolve(new Map()),
  });
  const followsService = new FollowsService({
    profiles: profilesService,
    safety: safetyService,
    sources: () => sourcesService,
  });
  followsRef = followsService;
  const postsService = new PostsService({
    files: filesService,
    profiles: profilesService,
    notifications: notificationsService,
    safety: safetyService,
    moderation: moderationService,
    fetcher,
  });
  const storiesService = new StoriesService({
    files: filesService,
    profiles: profilesService,
    safety: safetyService,
  });
  const outService = new OneUsefulThingService({
    posts: postsService,
    sources: sourcesService,
    follows: followsService,
  });
  const feedService = new FeedService({
    posts: postsService,
    follows: followsService,
    sources: sourcesService,
    profiles: profilesService,
    safety: safetyService,
  });
  const qaService = new QaService({
    profiles: profilesService,
    notifications: notificationsService,
    safety: safetyService,
    moderation: moderationService,
  });
  moderationService.register('post', postsService.postHandler);
  moderationService.register('comment', postsService.commentHandler);
  moderationService.register('story', storiesService.handler);
  moderationService.register('question', qaService.questionHandler);
  moderationService.register('answer', qaService.answerHandler);
  moderationService.register('item', sourcesService.itemHandler);
  for (const type of ['post', 'comment', 'story', 'question', 'answer'] as const)
    safetyService.registerTarget(type, (viewer, id) => moderationService.reportTarget(type, viewer, id));
  filesService.registerAccess('post_media', (fileId, viewer) => postsService.mediaAccess(fileId, viewer));
  filesService.registerAccess('story_media', (fileId, viewer) => storiesService.mediaAccess(fileId, viewer));
  safetyService.onBlock((a, b) => followsService.onBlock(a, b));
  queue.register(FETCH_JOB, (data) => sourcesService.runFetch(data));

  // ── Jobs and referrals (Phase 5) ─────────────────────────────
  const jobsService = new JobsService({
    profiles: profilesService,
    safety: safetyService,
    notifications: notificationsService,
    moderation: moderationService,
  });
  const jobSourcesService = new JobSourcesService({
    fetcher,
    jobs: queue,
    logger,
    listings: jobsService,
    adzuna:
      env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY
        ? { appId: env.ADZUNA_APP_ID, appKey: env.ADZUNA_APP_KEY }
        : null,
  });
  const referralsService = new ReferralsService({
    listings: jobsService,
    profiles: profilesService,
    safety: safetyService,
    notifications: notificationsService,
    files: filesService,
    jobs: queue,
  });
  jobsService.referrerCounts = (keys, viewer) => referralsService.referrerCounts(keys, viewer);
  jobsService.sourceInfo = (ids) => jobSourcesService.info(ids);
  moderationService.register('job', jobsService.handler);
  safetyService.registerTarget('job', (viewer, id) => moderationService.reportTarget('job', viewer, id));
  safetyService.registerTarget('referral', (viewer, id) => referralsService.reportTarget(viewer, id));
  filesService.registerAccess('referral_resume', (fileId, viewer) =>
    referralsService.resumeAccess(fileId, viewer),
  );
  safetyService.onBlock((a, b) => referralsService.onBlock(a, b));
  queue.register(JOB_FETCH_JOB, (data) => jobSourcesService.runFetch(data));
  queue.register(ALERT_JOB, (data) => jobsService.runAlert(data));
  queue.register(REFERRAL_EXPIRE_JOB, (data) => referralsService.onExpire(data));

  // ── Roadmaps (Phase 6) ─────────────────────────────
  const roadmapsService = new RoadmapsService({
    profiles: profilesService,
    notifications: notificationsService,
    jobs: queue,
  });
  moderationService.register('roadmap', roadmapsService.handler);
  moderationService.register('roadmap_comment', roadmapsService.commentHandler);
  safetyService.registerTarget('roadmap', (viewer, id) =>
    moderationService.reportTarget('roadmap', viewer, id),
  );
  safetyService.registerTarget('roadmap_comment', (viewer, id) =>
    roadmapsService.commentReportTarget(viewer, id),
  );
  queue.register(NUDGE_JOB, (data) => roadmapsService.runNudge(data));
  platformService.onTenantCreated = installLibraryRoadmaps;

  // ── Gamification, events and analytics (Phase 7) ─────────────────────────────
  const gamificationService = new GamificationService({
    profiles: profilesService,
    notifications: notificationsService,
    logger,
  });
  const eventsService = new EventsService({
    profiles: profilesService,
    notifications: notificationsService,
    jobs: queue,
  });
  for (const svc of [
    postsService,
    qaService,
    sessionsService,
    referralsService,
    roadmapsService,
    eventsService,
  ])
    svc.award = gamificationService.award;
  moderationService.register('event', eventsService.handler);
  moderationService.register('event_question', eventsService.questionHandler);
  for (const type of ['event', 'event_question'] as const)
    safetyService.registerTarget(type, (viewer, id) => eventsService.reportTarget(type, viewer, id));
  queue.register(EVENT_REMINDER_JOB, (data) => eventsService.onReminder(data));
  const analyticsService = new AnalyticsService({
    cohorts: () => profilesService.cohorts(),
    pendingVerification: () => verificationService.pendingCount(),
    activeSince: (since) => authService.activeSince(since),
    postsByAuthor: (since) => postsService.countByAuthorSince(since),
    answersByAuthor: (since) => qaService.answersByAuthorSince(since),
    stepsByUser: (since) => roadmapsService.stepsByUserSince(since),
    sessions: (since) => sessionsService.completedSince(since),
    referrals: (since) => referralsService.statsSince(since),
    jobs: (since) => jobsService.postedSince(since),
    events: (since) => eventsService.stats(since),
    eventHosts: async (since) => (await eventsService.hostsSince(since)).map(String),
  });

  // ── Privacy rights (Phase 8) ─────────────────────────────
  const privacyService = new PrivacyService({ auth: authService, profiles: profilesService, logger });
  const hook = (svc: { exportFor(u: string): Promise<unknown>; eraseFor(u: string): Promise<void> }) => ({
    exportFor: (u: string) => svc.exportFor(u),
    eraseFor: (u: string) => svc.eraseFor(u),
  });
  // Order matters for erasure: content and files first, the account record last (privacy service).
  privacyService.register('account', hook(authService));
  privacyService.register('profile', hook(profilesService));
  privacyService.register('consents', { exportFor: (u) => consentService.current(u) });
  privacyService.register('verification', hook(verificationService));
  privacyService.register('posts', hook(postsService));
  privacyService.register('stories', hook(storiesService));
  privacyService.register('follows', hook(followsService));
  privacyService.register('questions', hook(qaService));
  privacyService.register('messages', hook(messagingService));
  privacyService.register('mentorship', hook(mentorsService));
  privacyService.register('mentorshipRequests', hook(requestsService));
  privacyService.register('sessions', hook(sessionsService));
  privacyService.register('jobs', hook(jobsService));
  privacyService.register('referrals', hook(referralsService));
  privacyService.register('roadmaps', hook(roadmapsService));
  privacyService.register('points', hook(gamificationService));
  privacyService.register('events', hook(eventsService));
  privacyService.register('notifications', hook(notificationsService));
  privacyService.register('files', hook(filesService));

  const extraSearch = async (auth: Parameters<typeof postsService.search>[0], q: string) => ({
    posts: auth.permissions.has('feed:read') ? await postsService.search(auth, q) : [],
    questions: auth.permissions.has('feed:read') ? await qaService.search(auth, q) : [],
    jobs: auth.permissions.has('jobs:read') ? await jobsService.search(auth, q) : [],
    roadmaps: auth.permissions.has('roadmaps:read') ? await roadmapsService.search(auth, q) : [],
    events: auth.permissions.has('events:rsvp') ? await eventsService.search(auth, q) : [],
  });
  const cookie = {
    secure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
  };

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => String(req.id),
      autoLogging: env.NODE_ENV !== 'test',
      serializers: httpLogSerializers,
    }),
  );
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
  app.use(API_PREFIX, defineModule('profiles', profileRoutes(profilesService, extraSearch), pipeline));
  app.use(
    API_PREFIX,
    defineModule('mentorship', mentorshipRoutes(mentorsService, requestsService, sessionsService), pipeline),
  );
  app.use(API_PREFIX, defineModule('sessions', sessionRoutes(sessionsService), pipeline));
  app.use(API_PREFIX, defineModule('messaging', messagingRoutes(messagingService), pipeline));
  app.use(API_PREFIX, defineModule('notifications', notificationRoutes(notificationsService), pipeline));
  app.use(API_PREFIX, defineModule('moderation', moderationRoutes(safetyService), pipeline));
  app.use(
    API_PREFIX,
    defineModule(
      'feed',
      feedRoutes({
        posts: postsService,
        feed: feedService,
        follows: followsService,
        stories: storiesService,
        out: outService,
        files: filesService,
        sources: sourcesService,
      }),
      pipeline,
    ),
  );
  app.use(API_PREFIX, defineModule('qa', qaRoutes(qaService), pipeline));
  app.use(API_PREFIX, defineModule('content-sources', sourceRoutes(sourcesService), pipeline));
  app.use(
    API_PREFIX,
    defineModule('jobs', jobRoutes({ jobs: jobsService, referrals: referralsService }), pipeline),
  );
  app.use(API_PREFIX, defineModule('job-sources', jobSourceRoutes(jobSourcesService), pipeline));
  app.use(
    API_PREFIX,
    defineModule('referrals', referralRoutes({ referrals: referralsService, files: filesService }), pipeline),
  );
  app.use(API_PREFIX, defineModule('roadmaps', roadmapRoutes(roadmapsService), pipeline));
  app.use(API_PREFIX, defineModule('gamification', gamificationRoutes(gamificationService), pipeline));
  app.use(API_PREFIX, defineModule('events', eventRoutes(eventsService), pipeline));
  app.use(API_PREFIX, defineModule('analytics', analyticsRoutes(analyticsService), pipeline));
  app.use(API_PREFIX, defineModule('privacy', privacyRoutes(privacyService), pipeline));
  app.use(
    API_PREFIX,
    defineModule(
      'moderation-queue',
      queueRoutes({
        moderation: moderationService,
        qa: qaService,
        sources: sourcesService,
        safety: safetyService,
      }),
      pipeline,
    ),
  );

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
    moderation: moderationService,
    posts: postsService,
    feed: feedService,
    follows: followsService,
    stories: storiesService,
    out: outService,
    qa: qaService,
    sources: sourcesService,
    jobs: jobsService,
    jobSources: jobSourcesService,
    referrals: referralsService,
    roadmaps: roadmapsService,
    gamification: gamificationService,
    events: eventsService,
    analytics: analyticsService,
    privacy: privacyService,
  };
  return app;
}
