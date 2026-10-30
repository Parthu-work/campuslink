# Codebase facts (kept current)

Copied from §2 of `master-prompt-1.md` (verified against `cc965b1`). Corrections and additions found while building go in **Corrections** below, newest last; the copied text is left as it was so the two can be compared.

## Corrections

- **Baseline (Step 0, 29 Oct 2026).** `claude/sleepy-euler-bi65m3` had moved on to `df83e3c`, six commits past `cc965b1`: revamp phases 12 (re-audit) and 13 (final report) landed. Code changes since `cc965b1` touch only `apps/web/src/app/router.tsx` (route-match cache), `lib/preload.ts`, `lib/transitions.ts` (skip view transitions on slow devices), `lib/use-scroll-chrome.ts` (bars stay on restored scroll), the audit scripts and one e2e spec. None of the §2 facts change. This build branches from `df83e3c`.
- **Bundle.** Initial JS is **169.5 KB** at `df83e3c` (not 169.3): 0.5 KB of headroom.
- **Local infrastructure in cloud sessions.** Docker Hub may rate-limit pulls; `mirror.gcr.io/library/mongo:8.0`, `mirror.gcr.io/library/redis:7.4-alpine`, `mirror.gcr.io/axllent/mailpit:v1.27` and `mirror.gcr.io/zricethezav/gitleaks:v8.30.1` (the same gitleaks build as `ghcr.io/gitleaks/gitleaks:v8.30.1`) work when retagged. If the container's open-file limit is low, MongoDB panics mid-suite with "Too many open files" (WiredTiger keeps handles to the dropped per-file test databases): start `dockerd --default-ulimit nofile=20000:20000` and give mongod `--wiredTigerEngineConfigString 'file_manager=(close_idle_time=5,close_scan_interval=5,close_handle_minimum=200)'` through a local compose override. Peak is then about 4,000 handles for the full API suite.

- **Changed by B1 to B4** (details in `progress.md`). `PLATFORM_MODELS` is now `Tenant`, `Migration`, `WebhookReceipt`. Data migrations run at boot from `db/migrations.ts`. Feature switches: 11 keys in `packages/shared/src/features.ts` (`RouteSpec.feature`, `featureEnabled`, `gatedJob`). i18n runs on `apps/web/src/i18n/core.ts` (i18next is gone). Users may have no email or password (phone sign-up); `OtpService` issues every one-time code. Notifications have a fourth channel, WhatsApp (`ChannelService`). New permission `onboarding:manage` (TPO, admin) and Admin › Onboarding; invite links and class join codes live in `modules/verification/onboarding.*`. New rate limiters: `otp`, `webhook`, `invite`. ADRs now run to 0011.

- **Changed by B5 to B7.** New modules: `placements` (companies, academic records, drives, registrations, offers; `placements.open` and `placements.reminder` jobs). New permissions `placements:view`, `placements:register`, `placements:manage`, `outcomes:report`, `outcomes:verify`; new nav destination `placements` (a main tab for students in their last two years, `inFinalYears`), admin group `placements` (sections Placement drives and Offers). Notification category `placements` (types `drive_open`, `drive_reminder`, `drive_round_result`, `drive_selected`, `offer_verified`, `offer_rejected`). File purposes `placement_resume` and `offer_proof`. `importMapping.type` is `roster` or `academics`; academic imports have no rollback. Mentorship requests carry `version` and two delayed jobs (B5); posts carry `audience`, `pinnedUntil`, `urgent` (B6). `write-excel-file` is an API dependency (registrant exports).

## 2. Verified codebase facts (commit `cc965b1`)

Read `CLAUDE.md` once. It is authoritative for conventions; this section is the map.

**Size and shape.** About 93k lines of TypeScript: API 35k, API tests 15k, web 35k, e2e 3.5k, shared 4.8k. There are 30 API modules under `apps/api/src/modules/` (`admin analytics audit auth consent content-sources events feed files gamification health idempotency imports job-sources jobs mentorship messaging moderation notifications platform privacy profiles qa referrals roadmaps sessions study tenants users verification`). ADRs run to 0008, so new ADRs start at **0009**.

**Routes.** Declare routes with `defineModule(name, specs, pipeline)` in `apps/api/src/http/registry.ts`. A `RouteSpec` has these fields:

- required: `method`, `path`, `summary`, `tag`, `access` (`{kind:'public'}`, `{kind:'authenticated'}` or `{kind:'permission', permission}`);
- optional: `scope` (`college` by default, or `platform` or `any`), `body`, `query`, `params` (Zod), `limiter` (a `LimiterName` from `http/rate-limit.ts`), `csrf`, `upload {field, maxBytes}`, `idempotent`, `bot`, `stream`;
- the handler receives `({req,res,body,query,params,file})` and returns a `HandlerResult` of `{status?, data, meta?, raw?, streamed?}`.

Wire modules in `apps/api/src/app.ts` (818 lines): services are constructed in order, jobs are registered with `queue.register(NAME, handler)`, moderation targets with `moderationService.register(kind, handler)`, privacy with `privacyService.register(name, hook(service))`, and routes with `app.use(API_PREFIX, defineModule(...))`. Regenerate the OpenAPI spec and `docs/permissions.md` with `pnpm --filter @campuslink/api docs:gen`.

**Models.** Create every model with `defineTenantModel(name, schema)` or `definePlatformModel(name, schema)` in `apps/api/src/db/models.ts`. `PLATFORM_MODELS` is an allowlist that today contains only `Tenant`. `baseSchemaOptions` sets `strict:'throw'`, `strictQuery`, timestamps and no version key. Every compound index leads with `tenantId` (a test enforces this). The tenant plugin is `db/tenant-plugin.ts`; it refuses `$lookup`, `$unionWith`, `bulkWrite` and `estimatedDocumentCount` inside a tenant context.

**Jobs.** `lib/jobs.ts` exports `JobQueue { register(name, handler), enqueue(name, data:{tenantId,...}, {jobId?, delayMs?}), cancel(name, jobId) }`. Job ids may not contain `:`. Tests use `InlineJobQueue` (`drain()`, `runDelayed()`). In production `PROCESS_ROLE=worker` runs jobs (`deploy/worker.Dockerfile`).

**Tenant.** `modules/tenants/tenant.model.ts` has these fields:

- `slug`, `kind` (college or platform), `status`, `branding{displayName, shortName, primary, secondary, accent, monogram, city}`, `logo.fileId`;
- `features{studentPosting, stories, leaderboards, alumniMatch, jobsAggregation}`, `allowedEmailDomains`, `limits{mentorshipRequestsPerWeek, referralRequestsPerWeek}`, `permissionOverrides{grant, revoke}`;
- `subscription{plan: trial|standard|premium, seatLimit:1000, renewalDate}`, `retention{inactiveAccountDays, deletedAccountGraceDays}`, `suspendedAt`.

The platform console edits `subscription` (`modules/platform/platform.service.ts`).

**User.** `modules/auth/user.model.ts` has these fields:

- `email` (required, lowercased), `name`, `passwordHash` (required, `select:false`), `roles`, `capabilities`, `status` (active, suspended or deleting);
- `verified`, `emailVerifiedAt`, `ageDeclaredAt` (required), `locale` (`'en'|'te'` enum), `phoneEnc`, `phoneIndex`;
- `mfa{…}`, `failedLogins`, `lockedUntil`, `tokenVersion`, `lastLoginAt`.

Indexes: unique `{tenantId, email}`, `{tenantId, roles, _id}`, a text index on name and email, and `{tenantId, status, deletionPurgeAt}`.

**Auth.** `modules/auth/auth.service.ts` has these methods:

- account: `signup(tenant, body, meta)`, `verifyEmail`, `resendVerification`;
- sign-in and sessions: `login`, `loginWithMfa`, `createSession(…)`, `refresh`, `logout`, `revokeSession`, `revokeAllSessions`;
- passwords: `forgotPassword`, `resetPassword`, `changePassword`;
- MFA: `mfaSetup`, `mfaEnable`, `mfaDisable`;
- other: `sendInvite`, `activeSince`.

`packages/shared/src/schemas/auth.ts` defines `signupBody = {name, email, password, intent: STUDENT|ALUMNI, isAdult: literal(true), consents[], locale: en|te}`. Refresh coordination on the client is `apps/web/src/lib/refresh-coordinator.ts`; do not touch it.

**Verification.** `modules/verification/verification.service.ts`:

- `start(tenant, userId, rollNumber, gradYear, meta)` matches a `WhitelistModel` record. It auto-verifies on an email blind-index match (`roll_email_match`). Otherwise it sends a code to the record's email, or to the record's phone if `sms.available` (it never is: `lib/sms.ts` exports only `DisabledSmsProvider`, `env.SMS_PROVIDER` is `z.enum(['disabled'])`). Failing both, it returns `no_contact`.
- `confirm(...)`, `onEmailVerified(...)`, `requestWithId(...)` (college ID photo), `queue(status)` and `decide(tenant, reviewerId, id, decision, reason)` handle one decision at a time.

`OtpChallengeModel` (`verification.model.ts`) has `userId` (required), `purpose: roll_claim|company_email`, `targetId`, `codeHash`, `attempts`, `expiresAt`, `purgeAt`, `consumedAt`. Constants: 10-minute TTL, 5 attempts, 5 challenges a day. Invites: `invites.service.ts` has `invite(req, actorId, emails[], kind)` and `consume(email)`; `InviteModel` stores only `emailIndex`.

**Roster.** `modules/imports/whitelist.model.ts` has `rollNumber`, `name`, `branch`, `gradYear`, `kind` (student or alumni), `emailEnc`/`emailIndex`, `phoneEnc`/`phoneIndex`, `status` (unclaimed or claimed), `claimedBy`, `claimedAt`, `source` (import, manual or invite). `IMPORT_FIELDS` (`packages/shared/src/constants/people.ts`) is `rollNumber, name, branch, gradYear, email, phone, kind`. `BRANCHES` is `CSE IT ECE EEE MECH CIVIL CHEM AIML DS OTHER`. Import adapters are `csv`, `xlsx` and `remote` (`modules/imports/adapters/`).

**Encryption.** `FieldCipher` (`lib/crypto.ts`) provides `encrypt`, `decrypt`, `blindIndex` and `blindIndexes`. Every encrypted field must be listed in `ENCRYPTED_COLLECTIONS` in `apps/api/src/scripts/field-rotation.ts` (a test enforces this); today that covers users, profiles, whitelist and push subscriptions.

**Notifications.** `modules/notifications/notifications.service.ts`: `notify(userId, type, data: Record<string,string>, {noEmail?})` runs inside the tenant context. It stores in-app notifications and queues the `DELIVER_JOB` for email and push after quiet hours (`quietHours{enabled,start,end,timezone}`). In `packages/shared/src/schemas/messaging.ts`:

- `NOTIFICATION_TYPES` holds 40 types, from `request_received` through `ai_budget_reached`;
- `NOTIFICATION_CATEGORIES` = `requests sessions reminders messages community moderation jobs roadmaps achievements events study`;
- `CATEGORY_OF` maps each type to its category;
- `CHANNELS = ['inApp','email','push']`, with `DEFAULT_CHANNELS` per category.

Server-side text lives in `modules/notifications/templates.ts` as `Record<Locale, …>`; payloads carry names, types and times only, never message or request text.

**Consent.** `packages/shared/src/consent.ts` defines `CONSENT_PURPOSES = {account (required), mentorship_matching, email_digests, analytics_aggregate}`, all at version 1, and `PRIVACY_NOTICE_VERSION = '2026-10-draft'`. Consent records are kept on erasure.

**Locales.** `SUPPORTED_LOCALES = ['en','te']` (`packages/shared/src/locales.ts`). `'en'|'te'` is also hard-coded in `user.model.ts`, `schemas/auth.ts`, `schemas/users.ts`, `constants/study.ts`, `study/chat.model.ts`, `notifications/templates.ts` and `apps/web/src/i18n/index.ts`. `en.json` and `te.json` each have 3,080 lines, with top-level keys `common nav landing auth mfa home settings admin role feature platform errors verify people profile palette session slots mentors match request sessions messages mentor notify notifications safety topics content feed stories qa mod sources jobs referrals jobSources roadmaps progress rewards events analytics pwa botCheck design study ai`.

**Permissions.** `packages/shared/src/roles.ts` defines the roles `SUPER_ADMIN COLLEGE_ADMIN TPO FACULTY ALUMNI STUDENT`, the capability `CERTIFIED_CONTRIBUTOR`, `ALL_PERMISSIONS` (with the descriptions map `PERMISSIONS`), the `STUDENT`, `ALUMNI` and `STAFF` arrays, `ROLE_PERMISSIONS`, `MFA_REQUIRED_ROLES = [SUPER_ADMIN, COLLEGE_ADMIN]` and `ASSIGNABLE_ROLES`. Permissions that already exist and are relevant here: `announcements:post` (staff; used in `feed/posts.service.ts` for `announcement` posts), `reports:export` (TPO, admin), `analytics:cohort`, `analytics:tenant`, `verification:review`, `imports:manage`, `tenant:settings`, `events:create`.

**Navigation.** `packages/shared/src/navigation.ts` is the single source for every menu:

- `NavId` lists every destination; `ADMIN_PERMISSIONS` is the set of permissions that open the admin area;
- `AdminGroup` is `people community insights college`;
- `ADMIN_SECTIONS` lists 14 sections built with `section(id, path, permission, group)`;
- `SETTINGS_SECTIONS` is `security privacy preferences notifications data`;
- `buildNav(subject, shipped)` builds the menus, and the web reads them through `apps/web/src/lib/nav.ts › useNav()`.

The admin overview's queue counts come from `modules/admin/overview.service.ts › AdminOverviewService.overview(viewer)`.

**Web.** `apps/web/src/app/router.tsx` declares screens with `screen(load.x, 'Export', permission, at('/path'), loaderFn)`, plus `layout()` and `still()` (no pull to refresh). Reads live once in `apps/web/src/lib/queries.ts`; a screen's main read spreads `...SCREEN` (`lib/query-client.ts`).

Primitives in `components/ui/`: `avatar-stack back-link burst button choice-group column-chart dialog error-state field form-footer illustration intent-link mesh misc otp page-header person-avatar progress radar-sweep rich-text role-chip slot-picker stat-card stepper switch tab-nav table tabs tag-input tooltip`.

Helpers in `lib/`: `toast.ts`, `celebrate.ts`, `drafts.ts`, `names.ts`, `use-url-overlay.ts`, `use-dialog-history.ts`, `upload.ts`, `push.ts`, `service-worker.ts`, `realtime.ts`.

Bundle budget: initial JS ≤ 170 KB gzipped (currently **169.3 KB**, with almost no headroom) and ≤ 70 KB per screen; enforced by `pnpm --filter @campuslink/web budget`. Every new screen must lazy-load.

**Mentorship.** Request model fields: `menteeId`, `mentorId`, `sessionType`, `message`, `goal`, `background`, `need`, `slotStart`, `status`, `declineTemplate`, `declineNote`, `respondedAt`, `expiresAt`, `bookingId`, `conversationId`. A unique partial index allows one pending request per pair.

- `REQUEST_TTL_DAYS = 7` (`packages/shared/src/constants/mentorship.ts`); `EXPIRE_JOB = 'mentorship.expire'` (`requests.service.ts`).
- `SESSION_TYPES = quick_chat video_1on1 mock_interview resume_review`.
- `MentorsService.match(viewer)` and `scoreMatch()` live in `mentors.service.ts`; the mentor model carries `accepting`, `weeklyCap`, `audience`, `sessionTypes`, availability windows and `timezone`. The mentee profile carries `goals` and `targetCompanies`.
- Holds come only from `holdsFor()` (`slots.ts`).

**Events.** `EVENT_KINDS = meetup talk drive workshop ama office_hours` (`packages/shared/src/schemas/events.ts`). Event model fields: `kind`, `mode`, `startsAt`, `endsAt`, `location`, `onlineUrl`, `capacity`, `audience`, `branches`, `hostId`, `status` (scheduled or cancelled), `version`. RSVPs have a waitlist and check-in. A "drive" today is **just an event with RSVP**.

**Jobs.** The job tracker uses `TRACK_STATUSES = saved applied interviewing offer rejected withdrawn` (private to the member) and `REFERRAL_STATUSES = pending referred declined expired withdrawn` (`packages/shared/src/constants/jobs.ts`). Company names are normalised in `lib/company.ts`.

**Background work on a member's behalf** uses `backgroundAuth()` (`modules/users/users.service.ts`); `withPlatformScope(reason, fn)` and `runInTenant` are in `lib/context.ts`.

**Analytics.** `AnalyticsService` (`modules/analytics/analytics.service.ts`) composes `AnalyticsSources` (cohorts, pending verification, active since, posts, answers, steps, sessions, referrals, jobs, events), cached 5 minutes per college. Small counts are hidden with `suppress()` from `packages/shared/src/schemas/analytics.ts` (`n < 5` → `'<5'`). There are no activation funnels, retention cohorts or product events.

**Gamification.** `lib/awards.ts › Award(userId, kind, refId, {from})`. `XP_RULES` (`schemas/gamification.ts`) has these kinds: `roadmap_step roadmap_finished post_published answer_accepted session_completed feedback_given event_attended study_quiz session_mentored new_mentee referral_given answer_accepted_alumni roadmap_published event_hosted`.

**Files.** `FILE_PURPOSES` (`modules/files/file.model.ts`) = `avatar id_card import_source message_attachment post_media story_media referral_resume study_material study_thumbnail study_transcript branding`. `FilesService` provides `storeImage`, `storeLogo`, `storeVideo`, `pending`, `claim`, `storeAttachment`, `storeResume`, `storeImportSource`, `storeStudyMaterial`, `signedUrl(fileId, viewer)`, `read`, `readForViewer`, `detach`, `remove` and `purgeExpired`.

**AI.** Providers are in `modules/study/ai/` (`anthropic gemini openai mock provider registry breaker rerank tokens`):

- `LLMProvider.generate({model, system, messages, maxTokens, temperature}, {onText, signal})` returns `{text, inputTokens, outputTokens, stopReason}`;
- `EmbeddingProvider.embed(texts, model)`;
- calls go through `guardedChat`/`guardedEmbeddings` (`ai/breaker.ts`).

`AiSettingsService` (`study/ai-settings.service.ts`) holds per-college keys and `platformDefault`, and its `runtime()` applies the monthly budget. `AiUsageModel` has fields `day`, `userId`, `kind`, `model`, `requests`, `inputTokens`, `outputTokens`; `AI_USAGE_KINDS = chat embedding transcription rerank`. `DEFAULT_CHAT_MODEL.anthropic = 'claude-opus-5-5'` (`packages/shared/src/constants/study.ts:57`). Env already has `AI_DEFAULT_PROVIDER`, `AI_DEFAULT_API_KEY`, `AI_DEFAULT_CHAT_MODEL`, `AI_DEFAULT_BASE_URL` and the embedding equivalents.

**Libraries already in `apps/api`.** `pdf-lib` (write PDFs), `pdfjs-dist`, `qrcode`, `read-excel-file` (read only; to write XLSX, add `write-excel-file`), `csv-parse`, `sharp`, `jose`, `otplib`, `web-push`, `undici`, `nodemailer`. Do not add a dependency when one of these does the job.

**Tests.** `apps/api/test/helpers.ts` provides `testApp(overrides)`, `makeTenant(slug)`, `makeUser(ctx, tenant, {roles, mfa})`, `api(ctx, host, token)`, `codeFrom(ctx, to)` and `cookiesFrom`. Isolation suites live in `apps/api/test/isolation/*.test.ts` (copy the pattern of `phase7.test.ts`: two tenants, every cross-tenant read, write, update, delete and search must fail). The permission matrix test runs on the registry. E2E specs are in `apps/web/e2e/*.spec.ts` with axe. Privacy cases are in `test/privacy.test.ts`. The MongoDB-backed suites need Docker; if Docker or MongoDB dies mid-gate, restart and re-run.
