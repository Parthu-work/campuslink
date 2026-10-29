# MASTER PROMPT 1 of 2: CampusLink — production-complete core

You are the principal engineer on the CampusLink monorepo. Your mission in this prompt is to turn the current build into a product a Tier-3 Indian college can run its students, alumni and placement office on, and pay for. Deployment and infrastructure are **out of scope** (a separate effort). Prompt 2 (`master-prompt-2-habit-growth-moat.md`) continues from where this one ends.

**The product thesis you are building toward:** CampusLink becomes the college's *system of record* for placements, alumni and student readiness. A college cannot afford to lose it because its placement history, accreditation evidence, alumni graph and study library live there, and because it works where Tier-3 students already are: on a cheap Android phone, on WhatsApp, in Telugu or Hindi.

Every fact about the codebase below was **verified against commit `cc965b1`** (branch `claude/sleepy-euler-bi65m3`, 29 Oct 2026). Do not re-audit the codebase. Trust §2, open only the files each phase lists under **Touches**, and if a fact turns out wrong, correct it in `docs/build/facts.md` and carry on.

---

## Step 0: Set up (before anything else)

1. **Baseline.** Run `git log -1 --format=%h`.
   - If `main` is still at `35fc3e4` and `claude/sleepy-euler-bi65m3` is at `cc965b1`, the branch is a straight continuation of `main`. Run the full gate (§3) on the branch. If it is green, fast-forward `main` to it (`git checkout main && git merge --ff-only origin/claude/sleepy-euler-bi65m3`) and push.
   - If your session imposes a branch rule, follow that instead and record it in the progress log.
   - If HEAD is not `cc965b1`, run `git diff --stat cc965b1..HEAD` and re-verify only the facts in §2 that touch changed files.
2. **Save this prompt** verbatim to `docs/build/master-prompt-1.md`. Copy §2 into `docs/build/facts.md` (you will keep it current). Read `docs/design/revamp/decisions.md`, `docs/adr/0008-design-language.md` and `docs/design/revamp/progress.md` (its last section) once: they hold the owner's design and AI decisions and the current budget numbers. Phases 12 and 13 of the revamp may have landed after `cc965b1`; if so, note their changes in `facts.md` and continue.
3. **Progress log.** Create `docs/build/progress.md` with every phase in §5 and a status. After each phase, record what shipped, decisions, deviations and what comes next. A new session reads this file first and resumes from the first phase that is not **Done**.
4. **README.** Replace the stale status line ("Phase 3 (mentorship)") with one line: what the product is and a link to `docs/build/progress.md`.
5. Commit (`docs: add build master prompt 1, facts and progress log`) and push.

---

## 1. Decisions already made (do not re-open)

- **D1. Phone-first identity.** Students, alumni and faculty may sign up and sign in with a mobile number and a one-time code (WhatsApp first, SMS fallback). Email becomes optional for them. `SUPER_ADMIN` and `COLLEGE_ADMIN` keep password plus TOTP (`MFA_REQUIRED_ROLES` is unchanged). A member who holds an MFA-required role cannot sign in by phone code.
- **D2. Age.** Replace the self-declared `isAdult` tick with a birth month (`YYYY-MM`). Store only the date the member turns 18 (`adultOn`), never the birth month itself. Members under 18 need verifiable guardian consent (§5, B2) and get a restricted account until it is recorded.
- **D3. WhatsApp provider.** Use the Meta WhatsApp Cloud API directly, with no reseller, behind a `WhatsAppProvider` adapter with `disabled` and `console` stubs (CLAUDE.md "free tools only").
- **D4. SMS.** Use SMS only for OTP fallback and critical reminders, through the existing `SmsProvider` interface extended for India's DLT rules. The first concrete adapter is MSG91. Implement it from MSG91's official API docs and keep it swappable.
- **D5. Payments.** Most Tier-3 colleges pay by bank transfer against an invoice, so "record a bank payment (UTR)" is the primary flow. Razorpay Payment Links is the online option behind a `PaymentProvider` adapter with a stub.
- **D6. AI cost.** The platform-wide key (`AI_DEFAULT_*` env, already wired as `platformDefault` in `AiSettingsService`) becomes the default for every college and is metered per college against its plan. Colleges may still bring their own key. Change the Anthropic default chat model from `claude-opus-5-5` to `claude-haiku-5-5` for answers. Offer `claude-sonnet-5-5` as the "deep" model for heavy tasks. Opus is used only when an admin picks it. **This deliberately overrides two revamp decisions** (`docs/design/revamp/decisions.md`, Phase 9: "no provider is the default" and "Anthropic default model: `claude-opus-5-5`"). Keep the rest of that decision: a college with no key and no plan entitlement is still _not configured_ (library, keyword search, passage answers), and external providers stay off until the admin accepts the data notice. Record the override as ADR 0009 and in `decisions.md`.
- **D7. Faculty reading students' study chats:** never. Remove the unused `facultySeeChats` setting (model, service, shared schema, UI, i18n and the four test files that still set it: `test/isolation/study.test.ts`, `study-insights.test.ts`, `study-injection.test.ts`, `study-chat.test.ts`) and say so in `docs/privacy.md`. The models use `strict:'throw'`, so ship a one-off `$unset` of the stored field for existing settings documents, and prove with a test that an old document still loads and saves.
- **D8. Breadth.** Do not delete any module. For **new** colleges, `stories`, `reels`, `contentSources` and `leaderboards` default to **off**. Existing colleges keep their current settings.
- **D9. Plans.** Two plans, priced per enrolled student per year: **Connect** (₹40, minimum ₹60,000) and **Placement** (₹75, minimum ₹1,20,000), plus a **Pilot** (free, time-boxed). Prices and limits live in config and can be edited in the platform console. Students and alumni never pay.
- **D10. Stop and ask me before** any change to session tokens, refresh rotation, tenancy enforcement, the encryption scheme, or anything that sends personal data to a new third party not listed in this prompt. Everything else: decide, record the decision in the progress log, and continue.

---

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

---

## 3. How to work

- **Gate per phase** (from CLAUDE.md): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then `pnpm --filter @campuslink/api exec vitest run --coverage`, `pnpm --filter @campuslink/web budget` and the gitleaks scan. Commit with conventional commits, push, run `pnpm test:e2e`, confirm CI is green, then update `docs/build/progress.md`.
- **Every new tenant-owned collection** needs four things:
  1. an isolation suite case;
  2. `exportFor`/`eraseFor` registered with `PrivacyService` plus a case in `test/privacy.test.ts`;
  3. indexes that lead with `tenantId`;
  4. any `…Enc` fields listed in `ENCRYPTED_COLLECTIONS`.
- **Every new endpoint** needs:
  1. a permission (new permissions go in `ALL_PERMISSIONS`, `PERMISSIONS` and the role arrays);
  2. authorization and negative tests;
  3. a regenerated `docs/permissions.md`.
- **Every new UI string** goes in `en.json`, `te.json` and (from B12) `hi.json`. Every new screen is built from the primitives and checked at 360 px and desktop, in both themes.
- **The revamp's design rules are binding** (read `docs/design/revamp/decisions.md` and `docs/adr/0008-design-language.md` once in Step 0). The ones new screens most often break:
  1. type sizes come from the type scale; a lint rule rejects `text-xs`, `text-sm`, `text-lg` and similar;
  2. touch targets are 44 px; a long form's actions sit in `FormFooter`; `Sheet` (bottom sheet on phones) is separate from `Dialog`;
  3. celebrations fire only at the ADR 0008 moments (do not add new ones), and haptics stay opt-in;
  4. a locale's strings load only when that locale is chosen (Hindi must follow Telugu's pattern), and every screen stays under its route budget;
  5. every UI colour comes from the college's palette; never hard-code one.
     If a phase here needs something these rules forbid, record the conflict in `docs/build/progress.md` and pick the rule.
- **Every notification** goes through `NotificationsService.notify()`, with a new `NotificationType` and a `CATEGORY_OF` entry.
- **Keep the initial bundle under 170 KB.** If a phase pushes it over, move code out of the first load (lazy routes, `lazy()` parts) before adding anything else.
- **Write a spec first.** For each phase, write `docs/specs/<feature>.md` (goal, data, API, UI, privacy, tests, acceptance) before coding, unless the phase below already states all of that.

---

## 4. Phase map

| Phase | Name | Why it matters |
| --- | --- | --- |
| B1 | Feature switches and the cut list | Focus the product per college without deleting anything |
| B2 | Phone-first identity, age and guardian consent | Tier-3 students live on phones; DPDP compliance for under-18s |
| B3 | WhatsApp and SMS channels | The channel students and alumni actually read |
| B4 | One-tap invites and class onboarding | Activation from roster to active member in two minutes |
| B5 | Mentorship loop that never dead-ends | Reply time, nudges, auto-rematch, mentor stats and reviews |
| B6 | TPO console | Bulk approval, onboarding progress, targeted announcements |
| B7 | Placement drives | The workflow a college pays for |
| B8 | Placement outcomes and accreditation reports | The system of record; NBA, NAAC and NIRF evidence |
| B9 | Product analytics | Activation, weekly use and retention: the traction story |
| B10 | Plans, entitlements and billing | Revenue inside the product |
| B11 | AI cost control | Platform key by default, model tiers, metering |
| B12 | Hindi and the language framework | Second-language growth beyond Telangana |
| B13 | Offline and low-data mode | Works on 3G and in hostels with bad Wi-Fi |
| B14 | In-app help, feedback, legal pages and app-level observability | Support without email chains; trustworthy legal surface |
| B15 | Hardening, demo data and final report | Prove it all works together |

---

## 5. Phases

### B1. Feature switches and the cut list

**Goal:** let each college run a focused product.

**Touches:** `modules/tenants/tenant.model.ts`, `packages/shared/src/schemas/tenant.ts`, `packages/shared/src/navigation.ts`, `apps/web/src/features/admin/` (Features screen), feed, stories and content-sources services.

1. Add `features.reels`, `features.contentSources`, `features.study`, `features.placements`, `features.whatsapp` and `features.peerMentors` (reserved for Prompt 2). Defaults for **new** tenants: `stories:false`, `reels:false`, `contentSources:false`, `leaderboards:false`, and everything else `true`. Migrate existing tenants by writing their current effective values explicitly, so nothing changes for them.
2. The API enforces each switch: routes of a disabled feature return `403 FEATURE_DISABLED` (add the code to `ErrorCode` in shared), and background jobs for that tenant no-op.
3. Navigation hides disabled destinations through the existing `shipped` set passed to `buildNav()`.
4. The Admin › Features screen shows every switch with a one-line explanation.

**Done when:** disabling each feature hides it everywhere (nav, Create sheet, command palette, deep links) and the API refuses it. Tests cover each switch.

### B2. Phone-first identity, age and guardian consent

**Goal:** a student signs up in under two minutes with only a phone, and minors are handled lawfully.

**Touches:** `user.model.ts`, `auth.service.ts`, `auth.routes.ts`, `schemas/auth.ts`, `verification.model.ts`, `verification.service.ts`, `lib/sms.ts`, `config/env.ts`, `consent.ts`, `scripts/field-rotation.ts`, `apps/web/src/features/auth/`, `features/verify/`.

**Data**

- `User`:
  - `email` becomes optional, with a partial unique index `{tenantId, email}` only where `email` exists;
  - `passwordHash` becomes optional;
  - add `phoneVerifiedAt`, `adultOn: Date` and `guardianConsentAt: Date|null`;
  - add the `phoneIndex` partial unique index `{tenantId, phoneIndex}`;
  - add status `guardian_pending`;
  - replace `ageDeclaredAt` by `ageCheckedAt`, migrating existing users.
- `OtpChallenge`:
  - `userId` becomes optional;
  - add `phoneIndex`;
  - add purposes `phone_signup`, `phone_login`, `phone_change` and `guardian_consent`;
  - keep hashing, attempts and daily caps;
  - add a per-phone cap of 5 a day and a per-IP limiter `otp` in `http/rate-limit.ts`.
- Roster (`IMPORT_FIELDS`): add `guardianPhone`, encrypted as `guardianPhoneEnc`/`guardianPhoneIndex` and listed in `ENCRYPTED_COLLECTIONS`.

**API**

- `POST /auth/phone/start {phone, purpose, channel?}`:
  - normalise to E.164, with +91 as the default country;
  - answer identically whether or not the number exists (no enumeration);
  - send via `OtpSender` (B3): WhatsApp authentication template first, SMS fallback;
  - mark `bot:true`.
- `POST /auth/phone/verify {challengeId, code, signup?}`:
  - on signup, the body carries `name`, `intent`, `birthMonth: 'YYYY-MM'`, `consents[]` and `locale`; create the user and the session through `createSession`;
  - on login, refuse MFA-required roles (`USE_PASSWORD_AND_2FA` error) and lock after repeated failures, like `login`.
- `POST /me/phone/change`: needs a code to the old number, or a fresh password re-check; the new number then needs its own code. Revoke other sessions. Audit both steps.
- Email/password signup stays as it is (for faculty and staff), with `isAdult` replaced by `birthMonth`.

**Roster match**

In `VerificationService.start`, when the user's verified phone blind-indexes to the record's `phoneIndex`, claim with method `roll_phone_match` (mirroring `roll_email_match`). Otherwise send a code to the phone on record through `OtpSender`. `no_contact` now only happens when the record has neither email nor phone.

**Minors**

If `adultOn > now`, the account is created in `guardian_pending`. Only verification and the guardian-consent screen are usable; every other permission is withheld.

Guardian consent (DPDP Rules 2025, Rule 10):

- The college's admission record is the "reliable details" source, so the guardian's phone must come from the roster (`guardianPhone`).
- The OTP goes to that phone. The guardian sees a short, versioned declaration (new consent purpose `guardian_consent`, version 1) in their chosen language and confirms with the code.
- If the roster has no guardian phone, the student may enter one. It then needs TPO or admin approval in the verification queue (`method: 'guardian_manual'`).

Rules while a member is a minor:

- no personalised "For you" ranking (chronological feed);
- excluded from product analytics events (B9);
- not shown on leaderboards;
- direct messages only inside an accepted mentorship or with staff;
- contact details always private.

On `adultOn`, a daily job lifts these rules and notifies the member.

Document all of this in `docs/privacy.md` and mark it **needs legal review**. The DPDP Fourth Schedule exemption for educational institutions covers only tracking and behavioural monitoring for educational activities or safety; do not rely on it for anything else.

**Web**

- A phone-first sign-up and sign-in. The OTP field already auto-submits on the 6th digit; reuse `components/ui/otp.tsx`. Add a WhatsApp/SMS channel switch and resend with a countdown.
- The birth-month picker.
- The guardian-pending screen, with a "send to guardian" action.
- Settings › Security gets "change phone".

**Tests:**

- OTP brute force and caps;
- no enumeration;
- minor restrictions on every guarded route (one table-driven test);
- the job that lifts restrictions at `adultOn`;
- phone change requiring the old number;
- isolation for the changed collections;
- e2e: phone sign-up as an adult and as a minor (the console provider exposes codes the same way `codeFrom` does for Mailpit).

### B3. WhatsApp and SMS channels

**Goal:** notifications and codes reach people where they read, within a cost cap.

**Touches:** new `lib/whatsapp.ts`, `lib/sms.ts`, new `modules/notifications/channels/`, `notifications.service.ts`, `templates.ts`, `schemas/messaging.ts`, `consent.ts`, `config/env.ts`, `app.ts`, new public webhook routes.

**Adapters**

- `WhatsAppProvider { available; sendTemplate(to, name, lang, params: string[], buttons?: {payload: string}[]): Promise<{messageId}>; sendAuthCode(to, code, lang) }` with three implementations:
  - `disabled`;
  - `console` (development: keeps the last 200 messages in memory, exposed at a development-only route for e2e);
  - `cloud`: `POST https://graph.facebook.com/{WHATSAPP_GRAPH_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages` with `Authorization: Bearer {WHATSAPP_TOKEN}`, through `safeFetch`.
- Codes use an **authentication template** with a copy-code button (one-tap autofill needs an Android app package; add it in Prompt 2's Android phase). The template body is fixed by Meta; set `code_expiration_minutes: 10` and `add_security_recommendation: true`.
- `SmsProvider` gains `sendTemplate(to, dltTemplateId, vars[])`, with three implementations:
  - `disabled`;
  - `console`;
  - `msg91`.

  Every SMS template is registered on India's DLT platform. The registered template id is sent with every message; a mismatch is silently dropped by the carrier, so template text lives in one file (`modules/notifications/channels/sms-templates.ts`) and is copied character for character into `docs/sms-templates.md` for registration. OTP uses the **service** category.

- `OtpSender.send(phone, code, lang, preferred)`: WhatsApp when enabled and the member has not chosen SMS; otherwise SMS; record which channel was used.
- **Env:** `WHATSAPP_PROVIDER (disabled|console|cloud)`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION`. `SMS_PROVIDER` becomes `disabled|console|msg91`, with `SMS_API_KEY`, `SMS_SENDER_ID` and `SMS_DLT_ENTITY_ID`. Production refuses the `console` providers (the same pattern as the `MAIL_DRIVER=disabled` refusal in `env.ts`).

**Notification channel**

- Add `'whatsapp'` to `CHANNELS`. Its defaults are on for `requests`, `sessions`, `reminders`, `jobs` (alerts only) and the new `placements` category (B7); off for everything else.
- WhatsApp sends require the new consent purpose `whatsapp_updates` (version 1, optional), asked at sign-up with plain wording. Meta's policy requires this opt-in.
- `DELIVER_JOB` sends WhatsApp after quiet hours, like push.
- Template mapping lives in `modules/notifications/channels/whatsapp-templates.ts`: `NotificationType → {template, category: 'utility'|'authentication', params: (data) => string[]}`.
  - Params are names, times, session types, company names and counts only, never message text (CLAUDE.md rule).
  - Every template's exact text in en, te and hi goes in `docs/whatsapp-templates.md` for Meta approval.
- **Reply buttons.** Templates for `request_received`, `booking_reminder` and `drive_open` carry quick-reply buttons (Accept / Decline, I'll be there, Register). The button payload is a signed, expiring token: `jose` HS256 with a new `WHATSAPP_ACTION_SECRET`, carrying `{tenantId, userId, action, refId, exp}`. The webhook verifies the token, then performs the action through the owning service's existing method inside `runInTenant`, with `backgroundAuth()` so current permissions and blocks apply. Free-text inbound messages get one fixed auto-reply with a link to the app; they are never stored.

**Webhook**

Routes `GET/POST /webhooks/whatsapp`, `scope:'any'`, public, rate-limited:

- `GET` echoes `hub.challenge` when `hub.mode=subscribe` and `hub.verify_token` matches.
- `POST` verifies `X-Hub-Signature-256` (HMAC-SHA256 of the **raw** body with `WHATSAPP_APP_SECRET`; capture the raw body for this path only), dedupes on the message id, and records delivery statuses (`sent`, `delivered`, `read`, `failed`) on the notification by provider message id.

**Fair use and metering**

- New tenant model `ChannelUsage {day, channel, category, count}`.
- Per-member cap: by default at most **2 non-critical** WhatsApp messages per week. Codes, session reminders and drive deadlines are critical and exempt.
- Per-tenant monthly cap comes from the plan (B10).
- At the cap, fall back to push or email and alert admins once at 80% and once at 100% (copy the AI budget pattern, `ai_budget_warning`/`ai_budget_reached`, into new `channel_budget_warning`/`channel_budget_reached` types).

**Web:** notification settings get the WhatsApp column (and the phone number it goes to). Admin › Features gets the WhatsApp switch; Admin › Overview shows the month's usage.

**Tests:**

- signature failure → 401;
- replayed message id is ignored;
- tampered or expired button token is refused;
- cross-tenant token is refused;
- caps and fallback;
- quiet hours;
- a member without consent never gets WhatsApp;
- production refuses the console providers.

### B4. One-tap invites and class onboarding

**Goal:** from roster row to active member in two minutes, without anyone typing an email address.

**Touches:** `modules/verification/` (invites), `modules/imports/`, new `apps/web/src/features/join/`, `features/admin/`.

**Invite links**

- New tenant model `InviteLink {whitelistId, tokenHash, createdBy, expiresAt (14 days), usedAt, channel}`.
- `GET /invite/:token` (public, `bot:true`) returns the college name and branding, the first name and the masked roll number.
- `POST /invite/:token/accept`:
  1. send a code to the phone (or email) **on the roster record**;
  2. on confirmation, create the account, claim the record (`roll_invite_link`), set the role from `kind` and sign in;
  3. if a minor, go through the B2 guardian step.
- Tokens are 256-bit random values, stored hashed, single use, and audited.

**Bulk sending**

- From Admin › List, the TPO selects records (by branch, batch and status) and sends invites by WhatsApp (template `invite_student`/`invite_alumni`, within caps) or downloads a CSV of personal links to share through class WhatsApp groups.
- An invite is re-sent at most once per 72 hours per record.

**Class join codes**

- New model `JoinCode {code (8 chars, no ambiguous letters), branch, gradYear, kind, expiresAt, createdBy, uses}`.
- A printable poster at `/admin/onboarding/poster/:id` carries a QR code (generated client-side or by the server's `qrcode` package as SVG). It opens `/join/:code`, where the student enters their roll number and gets a code at the phone on record.
- Codes are rate-limited and the TPO can expire them.

**Alumni claim**

The same link flow, plus a 3-field profile step:

1. current company and role (prefilled if imported);
2. what they can help with (topics);
3. "30 minutes a month?" (sets `accepting` and `weeklyCap` on the mentor model).

Celebrate on finish (an ADR 0008 moment: verification).

**Tests:** single use, expiry, codes to the roster contact only (never to a contact the claimant types), rate limits, isolation, e2e for the full student link → active member flow.

### B5. Mentorship loop that never dead-ends

**Goal:** every request gets an answer or a better option within 48 hours.

**Touches:** `modules/mentorship/` (`requests.service.ts`, `mentors.service.ts`, `request.model.ts`, `mentor.model.ts`), `packages/shared/src/constants/mentorship.ts`, `features/mentors/`, `features/mentorship/`.

**Nudges and rematch**

- Add to the request model: `version`, `nudgedAt` and `rematchOfferedAt`.
- New delayed jobs (job ids carry the request id; handlers no-op if the version changed):
  - `mentorship.nudge` at 24 h: WhatsApp or push to the mentor with Accept/Decline buttons (B3);
  - `mentorship.rematch` at 48 h: the mentee gets "three mentors likely to reply", from `match()` excluding the pending mentor, mentors at their weekly cap, and mentors whose median reply time is over 72 h.
- One tap withdraws the old request and sends the same message to the chosen mentor. A rematch does not count against `mentorshipRequestsPerWeek`.

**Mentor stats**

`MentorsService.stats(mentorId)` returns these figures (compute from requests and sessions; cache 1 hour):

- median reply hours over 90 days (shown only from 3 requests);
- reply rate band (High, Medium or Low);
- sessions completed;
- next free slot (from `slots.ts`);
- average rating and review count (shown only from 3 reviews).

Show the stats on mentor cards and the mentor page; the revamp log lists these as "API does not provide".

**Reviews**

After feedback, the mentee may publish a short public review (≤ 280 characters, plain text). It needs:

- its own model;
- a `ModeratableHandler` with `ModerationService` and a report target with `SafetyService`;
- `exportFor`/`eraseFor`.

The private feedback stays private.

**Matching quality**

`scoreMatch()` adds bounded terms:

- a reply-speed boost (+0 to 10);
- a load penalty (−0 to 15 when pending requests ≥ weekly cap);
- shared target company (+10, using `targetCompanies` against the mentor's `companyKey`).

Reasons stay visible ("Replies within a day", "Works at a company you're targeting"). Keep it deterministic and unit-tested.

**Tests:** job versioning, rematch exclusions, weekly limit untouched by a rematch, stats suppression, review moderation, isolation.

### B6. TPO console

**Goal:** the TPO runs onboarding and communication from one place, in minutes.

**Touches:** `modules/verification/verification.routes.ts`, `modules/admin/overview.service.ts`, `modules/feed/post.model.ts`, `posts.service.ts`, `feed.routes.ts`, `packages/shared/src/navigation.ts`, `features/admin/`.

**Bulk verification:** `POST /admin/verification/bulk-decision {ids (≤100), decision, reason?}` with permission `verification:review`. Each decision runs through the existing `decide()` and is audited individually; the response gives per-id results.

**Onboarding progress**

`GET /admin/onboarding?branch&gradYear` (`imports:manage` or `verification:review`) returns, per branch × batch:

- roster count;
- invited;
- claimed;
- verified;
- active in the last 7 days (with `suppress()`).

`POST /admin/onboarding/nudge {branch, gradYear}` sends invites to the unclaimed (B4 caps apply).

Add an `onboarding` admin section (group `people`) and an overview card: "N students not yet joined".

**Targeted announcements**

- Announcement posts already exist (`post.announcement`, `announcements:post`). Add `audience {branches[], gradYears[], roles[]}` (empty means everyone), `pinnedUntil`, and an optional "also send on WhatsApp" (template `college_announcement`, title only; critical-exempt only when the poster marks it urgent, and urgent is capped at 4 a month per college).
- The feed shows a member only the announcements whose audience matches them.

**Tests:** bulk decision partial failures, audit entries, audience filtering, pinned order, the urgent cap.

### B7. Placement drives

**Goal:** turn a drive from a calendar event into the end-to-end workflow TPOs run on spreadsheets and WhatsApp groups today.

**Touches:** new `apps/api/src/modules/placements/`, `packages/shared/src/schemas/placements.ts`, `packages/shared/src/constants/placements.ts`, `roles.ts`, `navigation.ts`, `app.ts`, `files/file.model.ts`, `notifications`, `events` (link), `imports` (academic fields), new `apps/web/src/features/placements/`.

**Data (all tenant models)**

- `PlacementCompany {name, companyKey (lib/company.ts), website?, sector?, notes (TPO only)}`.
- `AcademicRecord {userId, cgpa, activeBacklogs, historyBacklogs, tenthPct?, twelfthPct?, diplomaPct?, source: import|tpo|self, verifiedBy?, verifiedAt?}`. Importable through the imports wizard as a new import type `academics` keyed by roll number; self-reported values need TPO verification before they count.
- `PlacementDrive`:
  - basics: `{companyId, title, roles[{title, ctcMinLpa, ctcMaxLpa, location, type: full_time|internship|ppo}], mode: on_campus|off_campus|pool|virtual, venue?, driveDate, registrationCloseAt};`
  - eligibility: `{branches[], gradYears[], minCgpa?, maxActiveBacklogs?, maxHistoryBacklogs?, minTenthPct?, minTwelfthPct?}` plus `questions[{label, kind: text|choice|file}]`;
  - rounds: `rounds[{name, kind: aptitude|coding|technical|hr|group_discussion|other, at?}]`;
  - lifecycle: `status: draft|open|closed|in_progress|completed|cancelled`, `linkedEventId?`, `version`.
- `DriveRegistration`:
  - `{driveId, userId, answers, resumeFileId?};`
  - `status: registered|withdrawn|tpo_override;`
  - `roundResults[{round, result: pending|cleared|not_cleared|absent}];`
  - `final: in_process|selected|not_selected|withdrawn;`
  - unique per `{driveId, userId}`.
- `Offer`:
  - `{userId, companyKey, companyName, role, ctcLpa (exact; visible to the member and TPO only), ctcBand (derived), offerDate, type, source: drive|off_campus|ppo|internship_conversion, driveId?};`
  - `status: reported|verified|rejected|declined_by_student, proofFileId?, verifiedBy?, verifiedAt?;`
  - new file purposes `placement_resume` and `offer_proof` (with `deleteAfter` 30 days after verification).

**Eligibility:** a pure function `checkEligibility(drive, record, profile) → {eligible, reasons[]}` in `packages/shared/src/placements/eligibility.ts`, unit-tested with table cases. Never use gender, caste or any protected attribute as a criterion; the schema has no such field, so keep it that way.

**Flows**

1. The TPO creates a drive (optionally creating a linked `drive` event for the calendar and RSVP) and opens it. Eligible students are notified (`drive_open`, WhatsApp with a Register button).
2. Students see the eligible drives with a countdown, and register with one tap (a PDF resume uploaded as `placement_resume` for now; Prompt 2's resume builder replaces this).
3. Ineligible students see why ("CGPA 6.2, needs 6.5"). The TPO can override per student, audited.
4. The TPO exports registrants as CSV or XLSX for the company (`reports:export`, audited, with only the columns the TPO ticks).
5. The TPO enters round results in a table or uploads a CSV keyed by roll number. Each student is notified per round (`drive_round_result`).
6. A selection creates a `verified` Offer (`drive_selected`, celebrate: add "offer" to the ADR 0008 moments).
7. Off-campus offers: a student reports one with proof (or from the job tracker's `offer` status, which offers "Report to your TPO"). The TPO verifies or rejects it with a reason.

**Permissions** (new):

- `placements:view` (STUDENT, STAFF);
- `placements:register` (STUDENT);
- `placements:manage` (TPO, COLLEGE_ADMIN);
- `outcomes:report` (STUDENT, ALUMNI);
- `outcomes:verify` (TPO, COLLEGE_ADMIN).

**Navigation:**

- a `placements` NavId: a main tab for students in their final two years (role-aware, through `buildNav`), Explore for others;
- an admin section `placements` in a new `AdminGroup` `placements`;
- overview cards for "offers waiting for verification" and "drives closing in 48 h".

**Notifications:** a new category `placements`, with the types `drive_open`, `drive_reminder` (24 h before the registration close, critical), `drive_round_result`, `drive_selected`, `offer_verified` and `offer_rejected`.

**Privacy**

- An exact CTC is never shown to other students. Aggregates use bands and `suppress()`.
- On erasure, offers and registrations are **anonymised**, not deleted: `userId` becomes null, and branch, year, company and band are kept, because they are the college's institutional placement record. The proof file is deleted. Add this to `docs/privacy.md`.

**Tests:**

- eligibility table;
- registration races (the unique index);
- override audit;
- result CSV import (unknown roll numbers reported, never guessed);
- versioned delayed reminders;
- export columns;
- isolation;
- permissions;
- erasure anonymisation;
- e2e: TPO creates a drive → student registers → TPO marks rounds → offer verified.

### B8. Placement outcomes and accreditation reports

**Goal:** the college's placement and progression evidence is generated, not compiled by hand.

**Touches:** new `apps/api/src/modules/reports/`, `modules/placements/`, `modules/analytics/`, new `apps/web/src/features/reports/`.

**More outcome types** (tenant models, self-reported and TPO-verified, importable):

- `HigherStudy {userId, institution, program, country, admitYear, qualifyingExam?}`;
- `ExamQualification {userId, exam: GATE|CAT|GRE|GMAT|IELTS|TOEFL|UPSC|STATE_PSC|NET|OTHER, year, scoreBand?}`;
- `Venture {userId, name, registered: boolean, year}`.

**Report definitions** (`modules/reports/definitions/*.ts`)

Each definition is `{id, framework: 'NBA'|'NAAC'|'NIRF'|'internal', title, version, params (programme or branch, academic years), compute(services) → {columns, rows, totals}, evidence(services) → student-level rows, sourceNote, needsReview: boolean}`. Ship these:

1. **NBA SAR, placement, higher studies and entrepreneurship** per programme over three years: x placed, y higher studies (with a qualifying exam), z entrepreneurs, N final-year students; the yearly ratio and the three-year average. The commonly published Tier-II format scores this as 30 × the average of `(x+y+z)/N`. Show it as "per the SAR format" and mark it `needsReview` until checked against the current NBA SAR manual.
2. **NAAC, placement of outgoing students** (year-wise list with company and package band).
3. **NAAC, progression to higher education.**
4. **NAAC, students qualifying state, national or international exams.**
5. **NAAC, alumni engagement:** events with alumni participation, mentoring sessions and referrals, from existing modules. Alumni financial contribution arrives with alumni giving in Prompt 2.
6. **NIRF-style graduation outcome:** median salary of placed graduates per programme (the median, not the mean; hidden below 5).
7. **Internal:** placement % by branch (eligible vs placed), offers per student, top recruiters, median band, year-on-year.

Frameworks change (NAAC moved to binary accreditation in 2025), so every definition is versioned, carries its `sourceNote`, and never invents thresholds or scores.

**Output**

- An on-screen `Table` with the totals.
- XLSX (add `write-excel-file`) and CSV downloads.
- An evidence workbook (student-level rows) only with `reports:export`, audited, with a footer: "Generated by CampusLink on <date> from verified records".
- A principal dashboard (`/admin/reports`): placement %, median band, top recruiters and the trend, with `StatCard` and `ColumnChart`.

**Tests:** fixtures with known answers for every definition, small-count suppression, export audit, isolation.

### B9. Product analytics (first party)

**Goal:** answer "is it working?" with numbers, inside the app, without third-party trackers.

**Touches:** new `apps/api/src/modules/insights/` (or extend `analytics`), `app.ts`, `modules/platform/`, `apps/web/src/features/admin/analytics-admin.tsx`, `features/platform/`.

**Events**

- New tenant model `ProductEvent {day, userId, name, props}`. `name` comes from a closed list in shared, for example `signed_up`, `verified`, `first_request`, `request_answered`, `session_completed`, `drive_registered`, `offer_verified`, `study_question`, `roadmap_step`, `invite_accepted`. `props` holds only ids and enums, never text.
- Emit events from services after confirmed writes (the same places that call `award`). Members under 18 are excluded (B2). Respect the existing `analytics_aggregate` consent.
- Retain events 13 months, then roll them up into daily aggregates.

**Metrics** (an `InsightsService`, every count through `suppress()`):

- activation funnel: invited → signed up → verified → first meaningful action within 7 days;
- weekly active members by role;
- week-N retention cohorts by signup week;
- request → session conversion and median reply time;
- drive registration rate;
- offers per 100 final-years;
- study questions per active student.

**Views**

- The college sees its own metrics in Admin › Analytics (new tabs: Activation, Retention, Mentorship, Placements).
- The platform console gets a **cross-college** view of the same aggregates. It reads through a named platform path (`withPlatformScope('insights:platform-aggregates', …)`) that reads only per-tenant aggregates, never member rows, and is audit-logged. This is the YC traction dashboard.

**Tests:** funnel and cohort maths on fixtures, minors excluded, consent respected, the platform path returns aggregates only, isolation.

### B10. Plans, entitlements and billing

**Goal:** a college can be quoted, invoiced, paid and limited by plan, inside the product.

**Touches:** `modules/tenants/tenant.model.ts`, new `apps/api/src/modules/billing/`, `modules/platform/`, `packages/shared/src/constants/plans.ts`, `navigation.ts`, `features/platform/`, new `features/admin/billing`.

**Plans as config** (`packages/shared/src/constants/plans.ts`)

`PLANS = {pilot, connect, placement}`, each with:

- price per student per year (paise);
- annual minimum;
- included features (the B1 switches);
- monthly WhatsApp allowance per student;
- monthly AI token allowance;
- seat definition (verified students + alumni active in the last 12 months).

The platform console can override per college (custom deals).

**Entitlements:** `EntitlementsService.can(tenant, feature)` and `.limit(tenant, meter)`. B1 switches become `plan allows && college enabled`. Seat counting runs nightly. Going over seats shows a banner to admins and never blocks students mid-year.

**Invoices** (tenant model `Invoice`, numbered by a platform-level sequence per financial year):

- Fields: a sequential number per financial year (`CL/2026-27/0001`; the counter lives in a new platform model `InvoiceCounter`, added to `PLATFORM_MODELS` with a test), seller details from env, buyer (college legal name, address, GSTIN optional), line items, SAC code (configurable, default empty with a warning: confirm with a CA), taxable value, GST (CGST+SGST or IGST by place of supply, or none when the seller is unregistered: a config flag), total in words, due date.
- A PDF rendered with `pdf-lib` (Noto Sans for the ₹ sign), stored as file purpose `invoice`.
- Statuses: `draft`, `issued`, `paid`, `overdue`, `void`.

**Payments**

- Primary: the platform owner records a bank payment (amount, date, UTR), audited.
- Online: `PaymentProvider` with `stub` and `razorpay` implementations. Payment Link creation and a webhook with signature verification (HMAC SHA256 with the webhook secret, per Razorpay's docs) mark the invoice paid idempotently.
- Reminders at 7 days before due, on the due date and at 7 days after, to college admins.
- After 30 days overdue the college goes **read-only**: no new invites, drives or uploads; everything already there stays readable and exportable. **Never delete data for non-payment.**

**Screens:**

- platform console: plans, a college's subscription, invoices, record payment, usage;
- Admin › Billing (new section, group `college`, permission `tenant:settings`): plan, seats used, WhatsApp and AI usage against allowances, invoices to download, and a "Pay online" link when enabled.

**Tests:** invoice numbering under concurrency (unique index on the counter), GST maths, webhook signature, idempotent payment, read-only mode on every write route (one table-driven test), seat counting, isolation, a permission matrix for the new routes.

### B11. AI cost control

**Goal:** the study assistant works for every college without them owning a provider account, at a cost the plan covers.

**Touches:** `packages/shared/src/constants/study.ts`, `modules/study/ai-settings.service.ts`, `ai-usage.service.ts`, `features/admin/ai-admin.tsx`, `modules/billing/`.

1. `DEFAULT_CHAT_MODEL.anthropic` becomes `'claude-haiku-5-5'`. Add `DEEP_CHAT_MODEL.anthropic = 'claude-sonnet-5-5'`, used only by features that ask for "deep" (Prompt 2's mock interviews and resume rewrite). Keep "never guess model names" for the other providers.
2. A college with no key of its own uses `platformDefault` automatically (already wired). Its monthly budget is the plan's AI allowance (B10) rather than `monthlyTokenBudget = 0`. Admins can lower it but never raise it above the allowance.
3. `AiUsageModel` gets a `feature` field (`study_chat`, `embedding`, `transcription`, `rerank`, and later `resume`, `interview`, `copilot`). Usage rolls into billing usage (B10) and the platform console's per-college AI cost estimate, using prices the platform owner enters once (env or console).
4. Add a live smoke script, `pnpm --filter @campuslink/api ai:smoke`. With real keys in env, it runs one answer, one embedding and `/quiz` per configured provider and prints the token counts. It is not part of CI. This closes the "providers tested only against fakes" gap in `docs/phases/phase-9.md`.

**Tests:** default model, allowance clamp, usage by feature, the platform default used when no college key is set.

### B12. Hindi and the language framework

**Goal:** add a language as a translation job, not a code change.

**Touches:** `packages/shared/src/locales.ts` and every hard-coded `'en'|'te'` site listed in §2, `apps/web/src/i18n/`, `notifications/templates.ts`, fonts.

1. Make every `'en'|'te'` site derive from `SUPPORTED_LOCALES` (types and Mongoose enums). Add `'hi'`.
2. Create `apps/web/src/i18n/hi.json` by translating every key. Keep a `docs/build/translation-review.md` list of strings for a native speaker. Load locale bundles lazily, so the initial JS does not grow.
3. Add a Devanagari font next to the Telugu one (self-hosted; subset; `unicode-range`; preload nothing extra).
4. Server templates (notifications, WhatsApp, SMS, invoices) get `hi` text.
5. Add a test that fails when any key is missing in any locale (extend the existing `apps/web/src/i18n/parity.test.ts`). Also extend `detectLanguage()` in `modules/study/chat/prompt.ts` (today it returns only `'en'|'te'`) to recognise Devanagari, so the study assistant answers in Hindi.
6. Write `docs/adding-a-language.md`: the steps to add Tamil or Kannada.

### B13. Offline and low-data mode

**Goal:** the core screens work on a bad connection and keep working offline for reading.

**Touches:** `apps/web/src/lib/query-client.ts`, `lib/queries.ts`, `lib/service-worker.ts`, `features/settings/` (preferences), media components.

1. Persist selected TanStack Query caches to IndexedDB (a small hand-written persister to keep the bundle small). Persist these keys: my profile, my sessions, the last 50 messages per conversation, saved jobs and tracker, my roadmaps, the drives I'm registered for, study notes I opened, and the last feed page. Never persist other members' contact details. Clear everything on sign-out (shared phones).
2. Cold start shows the last-known content immediately with a quiet "updated N min ago" (audit item B13 from the revamp).
3. **Data saver** (Settings › Preferences; auto-on when `navigator.connection.saveData` or `effectiveType` is `2g`/`slow-2g`): no video autoplay, lower image quality (the server already re-encodes; add a `?w=` variant), no stories, digests over WhatsApp instead of push.
4. Queue writes made offline only for safe, idempotent actions (RSVP, save a job, mark a roadmap step) with the existing `Idempotency-Key`, and replay them on reconnect. Anything else says "you're offline".

**Tests:** e2e offline reads of each persisted screen, cache cleared on sign-out, idempotent replay, budget unchanged.

### B14. In-app help, feedback, legal pages and app-level observability

**Goal:** support without email chains, trustworthy legal surfaces, and errors you hear about before a college does.

**Touches:** new `modules/support/`, `modules/tenants/` (legal settings), `lib/logger.ts`, `app.ts`, `apps/web/src/features/help/`, error boundaries in `app/`.

**Help and feedback**

- A Help centre: short articles in `apps/web/src/features/help/articles/<locale>/*.md`, rendered with the existing markdown subset.
- "Report a problem" (category, description, optional screenshot through `FilesService`) creates a `SupportTicket` routed to the college admins (college matters) or the platform owner (bugs), with statuses and replies. Never attach logs containing personal data.

**Legal**

- The college's privacy policy and terms are rendered in-app from versioned markdown with tenant placeholders (college legal name, grievance officer name and contact, retention values) set in Admin › Branding › Legal.
- A change of version re-asks consent on next sign-in (the existing `PRIVACY_NOTICE_VERSION` mechanism).
- The grievance officer is shown in Settings › Privacy.

**Observability (application side only; no infrastructure)**

- An `ErrorReporter` interface with `console` and `sentry` adapters (the Sentry SDK or any Sentry-compatible endpoint such as self-hosted GlitchTip, chosen by `ERROR_REPORTER` and `ERROR_REPORTER_DSN`).
  - The API reports unhandled errors with the request id, route and tenant slug only.
  - The web app reports from error boundaries and failed chunk loads, with the user id hashed and no personal data. It loads lazily after first paint, and the CSP adds the DSN host only when configured (`security-headers.conf` and its test).
- `GET /metrics` (platform scope, a token in env) exposes Prometheus-format counters: requests by route and status, job outcomes, OTP sends by channel, WhatsApp delivery failures, AI tokens.

**Tests:** ticket isolation and routing, legal re-consent, no personal data in reported events (a test that scans the payload), metrics auth.

### B15. Hardening, demo data and final report

1. Extend `pnpm seed` with a placement season for both demo colleges: a fictional company list (clearly labelled demo), three drives in different states, registrations, results and offers, outcome records, invoices on the Placement plan, product events for a 6-week cohort, a WhatsApp console log, and one minor with guardian consent pending. Follow "never invent data": demo data must be obviously fictional.
2. Extend `pnpm loadtest` with phone OTP sign-in, drive registration (500 concurrent on one drive) and report generation for 3 years × 1,000 students.
3. Update `docs/architecture.md`, `docs/data-model.md`, `docs/privacy.md`, `docs/threat-model.md` (new rows for OTP, the webhook, invite links, the billing webhook and the minors flow), `docs/security-review.md` and `CLAUDE.md` (new modules, rules and adapters).
4. **ADRs:** 0009 phone-first identity and minors; 0010 WhatsApp channel and action tokens; 0011 placement records survive erasure in anonymised form; 0012 plans, entitlements and read-only on non-payment.
5. **Final report** in `docs/build/report-1.md`:
   - what shipped per phase;
   - decisions and deviations;
   - every new env var;
   - every external registration the owner must do (Meta Business verification, a WhatsApp number and templates, DLT entity, header and templates, MSG91, Razorpay, a CA review of the invoice format, a lawyer review of the minors flow and legal texts, a native Hindi review);
   - known gaps;
   - the metrics B9 now shows for the demo cohort.

**Acceptance for the whole prompt:** a fresh college can be created, its roster imported, its students and alumni invited and active by phone in two minutes each, its TPO can run a drive end to end, its principal can download NBA and NAAC evidence, and the platform owner can invoice it. Every gate is green and the bundle is ≤ 170 KB.
