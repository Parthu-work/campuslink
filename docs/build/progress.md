# Build progress (master prompt 1)

A new session reads this file first and resumes from the first phase that is not **Done**. The prompt is [`master-prompt-1.md`](master-prompt-1.md); the codebase map is [`facts.md`](facts.md).

| Phase | Name                                                           | Status      |
| ----- | -------------------------------------------------------------- | ----------- |
| B1    | Feature switches and the cut list                              | Done        |
| B2    | Phone-first identity, age and guardian consent                 | Done        |
| B3    | WhatsApp and SMS channels                                      | Done        |
| B4    | One-tap invites and class onboarding                           | Done        |
| B5    | Mentorship loop that never dead-ends                           | Done        |
| B6    | TPO console                                                    | Done        |
| B7    | Placement drives                                               | Not started |
| B8    | Placement outcomes and accreditation reports                   | Not started |
| B9    | Product analytics                                              | Not started |
| B10   | Plans, entitlements and billing                                | Not started |
| B11   | AI cost control                                                | Not started |
| B12   | Hindi and the language framework                               | Not started |
| B13   | Offline and low-data mode                                      | Not started |
| B14   | In-app help, feedback, legal pages and app-level observability | Not started |
| B15   | Hardening, demo data and final report                          | Not started |

## Step 0 · Set up

- **Baseline:** `main` is at `35fc3e4`; `claude/sleepy-euler-bi65m3` is at `df83e3c` (six commits past `cc965b1`: revamp phases 12 and 13), a straight continuation of `main`. The gate is green on `df83e3c` (format, lint, typecheck, 120 shared + 55 web + 758 API tests, build, bundle budget 169.5 KB, gitleaks).
- **Branch rule (deviation from Step 0.1):** this session must develop and push on `claude/keen-babbage-ts0wgj` and may not push to any other branch, so `main` was **not** fast-forwarded. The working branch was fast-forwarded to `df83e3c` and every phase is pushed there. Fast-forwarding `main` to it is left to the owner.
- **ADR numbering (conflict inside the prompt):** D6 asks for the AI-cost override to be ADR 0009, and B15 lists 0009 to 0012 for phone identity, WhatsApp, placements and plans. Decisions in §1 win, so the numbers shift by one: **0009** AI cost and model tiers (D6), **0010** phone-first identity and minors, **0011** WhatsApp channel and action tokens, **0012** placement records survive erasure in anonymised form, **0013** plans, entitlements and read-only on non-payment.
- **Local infrastructure** notes (Docker Hub rate limits, MongoDB open-file limit) are in `facts.md` › Corrections.

## B1 · Feature switches and the cut list (Done)

**Shipped**

- Eleven switches in `packages/shared/src/features.ts` (zod-free): the five old ones plus `reels`, `contentSources`, `study`, `placements`, `whatsapp` and `peerMentors` (reserved). New colleges start with stories, reels, outside content and leaderboards off (`NEW_TENANT_FEATURES`); older colleges keep what they had (`LEGACY_FEATURES`, written by the migration `b1-explicit-feature-switches` and applied on read by `resolveFeatures`).
- API: `RouteSpec.feature` and `withFeature()`; the pipeline answers `403 FEATURE_DISABLED` (new `ErrorCode`) right after the tenant scope. Content-level checks for reels, source follows and outside items in the feed, and fetched openings in Jobs. Gated jobs (`gatedJob`) for source and job-source fetches and study processing. The admin overview leaves out Study's queues while it is off. `docs/permissions.md` marks gated endpoints.
- A data-migration runner (`apps/api/src/db/migrations.ts`, platform model `Migration` as the lock, run at boot after index sync). B2 and D7 use it next.
- Web: `featureShipped()` and `NavSubject.features` hide destinations and admin sections; `inFeature` on routes shows "Your college has switched this off" for saved links; Home, the composer, Mentors and Progress hide switched-off parts; Admin › Features explains each switch.
- Spec: `docs/specs/feature-switches.md`. Tests: shared navigation, `apps/api/test/features.test.ts` (registry-driven: every gated route), `apps/web/e2e/features.spec.ts`.

**Decisions**

- **Student posting stays off for new colleges.** The brief says "everything else true"; student posting is a moderation policy a college opts into rather than a module, so it keeps its old default (security and privacy first).
- **The switch runs before authentication**, so a switched-off route says so to anyone (the switches are already public in `GET /tenant`).
- **Feature-gated jobs no-op at run time** rather than not being queued, so a college that switches a feature back on resumes at the next tick.
- **i18next and react-i18next were replaced by a 1 KB runtime** (`apps/web/src/i18n/core.ts` and `react.ts`) with the same keys, `{{vars}}`, default variables, `_one`/`_other` plurals and `defaultValue`. The first load was at 169.9 KB of 170 after B1's own additions; it is now **154.7 KB**, which leaves room for the screens and the offline cache later phases add to the first load. Unit-tested (`core.test.ts`); every existing screen test and the e2e suite run on it.

**Deviations:** none from the phase. The test helper `makeTenant` creates colleges with `LEGACY_FEATURES` (what every test assumed); three suites that use the leaderboard now switch it on explicitly, as a real college would.

**Next:** B2 (phone-first identity, age and guardian consent).

## B2 · Phone-first identity, age and guardian consent (Done)

**Shipped**

- Phone sign-up and sign-in (`POST /auth/phone/start`, `/auth/phone/verify`), changing the number (`/me/phone/change`, `/confirm`), and the guardian step (`/me/guardian`, `/start`, `/confirm`, `/manual`). One `OtpService` for every one-time code (hashing, 10-minute expiry, 5 attempts, single use, 5 a day per member and per number, the `otp` IP limiter); `OtpSender` sends WhatsApp first and SMS as fallback. `disabled` and `console` providers for both channels (B3 adds Meta Cloud API and MSG91), refused in production; `GET /dev/outbox` shows the console messages outside production.
- `User`: optional email and password, encrypted phone with a partial unique index, `adultOn` (minors only), `guardianConsentAt`, status `guardian_pending`, `ageCheckedAt` (migration `b2-age-checked-at`). Email sign-up asks for a birth month too.
- Roster: `guardianPhone` import field (encrypted, blind-indexed); a re-import may add a guardian number to an already claimed record. A proved phone claims the one unclaimed roster record with that number (`list_phone_match`), and roll verification matches a verified phone (`roll_phone_match`) or sends the code to the phone on record.
- Minors: no permissions while `guardian_pending`; with consent, a chronological For you, contact details never shown to others, never on leaderboards. Hourly tick and job `auth.adulthood` clear `adultOn`, open pending accounts and send `adult_now`. Guardian numbers the student enters go to the verification queue (`guardian_manual`).
- Web: phone-first sign-up and sign-in (email one tap away), birth-month picker, code step (WhatsApp/SMS switch, resend countdown, sends itself on the sixth digit), the guardian screen (declaration in English or Telugu), Settings › Security › Mobile number (lazily loaded), guardian requests in the verification queue.
- Docs: `docs/specs/phone-identity.md`, `docs/privacy.md` (marked needs legal review), `docs/sms-templates.md` (a test keeps it identical to the code), ADR 0010, `.env.example`. Seed: a fictional minor on both demo rosters with a guardian number.
- Tests: `phone-auth.test.ts` (15), `minors.test.ts` (7, including every permission route refused while pending), `isolation/phone.test.ts`, the migration, `channel-templates.test.ts`, `e2e/phone-signup.spec.ts` (adult, minor waiting, phone sign-in, minor with guardian consent).

**Decisions**

- **Sign-in codes go only to numbers with an account**; the answer is identical either way. A sign-up code for an existing number signs into that account after the code is proved.
- **A phone code never bypasses TOTP** a member turned on; MFA-required roles are refused by phone (`USE_PASSWORD_AND_2FA`).
- **`adultOn` assumes the latest possible birthday** (first day of the month after the 18th birthday month), and adults store no age data at all (data minimisation). Birth months under 13 or over 100 years ago are refused.
- **TPOs get `verification:review`** (they run onboarding: guardian numbers now, bulk verification in B6). Reviewers see a guardian number in full to compare it with admission papers; it is deleted from the request once decided.
- **Guardian consent is recorded in the consent log** (purpose `guardian_consent` v1, source `guardian`) with the roster record, language and channel as evidence, never the guardian's number. The declaration text is a versioned legal text shipped in both languages together (`features/guardian/declaration.ts`), not interface copy, because the guardian chooses its language.
- **Direct messages for minors:** no route opens a conversation outside an accepted mentorship, so the rule holds by construction (pinned by a test).
- **Lean-read features:** the old `isAdult` tick is gone everywhere; `MeResponse.email` is nullable; notification email is skipped for members without an address.

**Deviations:** none. **Needs the owner:** a lawyer's review of the minors flow and the declaration (docs/privacy.md).

**Next:** B3 (WhatsApp and SMS channels).

## B3 · WhatsApp and SMS channels (Done)

**Shipped**

- Adapters: `CloudWhatsAppProvider` (Meta Cloud API: templates with quick replies, the authentication template with a copy-code button, free-form text for the fixed auto-reply) and `Msg91SmsProvider` (MSG91 v5 Flow API), both through `safeFetch` with a host allowlist, selected by `WHATSAPP_PROVIDER` and `SMS_PROVIDER`; env validation for every setting; production refuses the console providers.
- WhatsApp as a fourth notification channel (`CHANNELS`, defaults on for requests, sessions, reminders and jobs), behind the opt-in consent `whatsapp_updates`, a verified number and the college's `whatsapp` switch. Template map with parameters and exact text in en, te and hi (`whatsapp-templates.ts`, `docs/whatsapp-templates.md` generated by `pnpm --filter @campuslink/api docs:whatsapp`, a test keeps them identical).
- `ChannelService`: fair use (2 non-critical a member per week; the college's monthly allowance, 2,000 until B10), push-then-email fallback, `channel_budget_warning`/`channel_budget_reached` to admins, metering (`ChannelMessage`, `ChannelUsage`; codes too), signed quick-reply actions (request accept/decline, session "I'll be there"), and the webhook (`GET/POST /webhooks/whatsapp`: handshake, signature over the raw body, dedupe, statuses, button taps, one auto-reply a day).
- Web: a WhatsApp card and column in notification settings (with the number messages go to), the consent at sign-up and in privacy settings, and the month's usage on the admin overview.
- Docs: `docs/specs/whatsapp-channel.md`, ADR 0011, `docs/privacy.md`, `.env.example`.
- Fixed on the way: server-side notification text never filled `{percent}` (the AI budget email said "{percent}%"); every remaining placeholder is now filled from the data.

**Decisions**

- **SMS carries codes only.** Critical reminders by SMS need a second DLT template; WhatsApp already exempts them from caps. Left for when a college asks.
- **Critical messages are exempt from both caps** (member and college); the admin text says so.
- **A tap must come from the number the button went to**, on top of the token check and current permissions.
- **The webhook lives on the platform host** (one URL for all colleges) and finds the college from the message record through the named platform path `channels:webhook-status`; deliveries are deduplicated in a platform-level `WebhookReceipt` (TTL 7 days). The operator-key guard allows Meta's `hub.*` handshake keys and deeper bodies on webhook paths only.

**Needs the owner (live checks).** The Meta and MSG91 documentation sites were outside this session's network allow-list, so both adapters follow the providers' published request shapes from memory and are verified only against fakes. Before turning either on, send one code and one template with real credentials (`WHATSAPP_PROVIDER=cloud`, `SMS_PROVIDER=msg91`) and confirm: the Graph API version, the copy-code button component, MSG91's `template_id` (mapped to the DLT template in the MSG91 panel) and its `var1…` names.

**Next:** B4 (one-tap invites and class onboarding).

## B4 · One-tap invites and class onboarding (Done)

**Shipped**

- Personal invite links for people on the college's list (`InviteLink`: a hash of a 256-bit token, 14 days, single use; a record is invited at most every 72 hours), sent by WhatsApp (new templates `cl_invite_student`, `cl_invite_alumni`, counted against the college's allowance) or downloaded as CSV for the college's own mail merge.
- Class join codes (`JoinCode`: 8 characters without look-alikes, per kind and optionally branch and year, 1 to 60 days) with a printable poster and QR code; the roll number finds the record within the code's class.
- Both end the same way: a code to the contact on the college's record (never one typed in; at most five a day per record), then a verified member with the record's name and kind, the B2 age rules, signed in. Alumni get three skippable questions (company and role, topics, "30 minutes a month?").
- `onboarding:manage` (TPO, College admin) and Admin › Onboarding (`people` group). Public routes have a new `invite` rate limit; code requests use `otp` and `bot: true`.
- Seed: two demo records per college with a mobile number and no account (`Demo Invite Student`, `Demo Classcode Student`).
- Tests: `test/onboarding.test.ts` (15), `test/isolation/onboarding.test.ts` (4), a privacy case, template parity; e2e `e2e/invites.spec.ts` (WhatsApp invite → link → member; join code → poster → member).
- CI: the e2e job runs MongoDB as a quiet step instead of a service (a service container prints its whole log at teardown, which buried Playwright's report), and Playwright keeps an HTML report in CI for the failure artifact.
- Docs: `docs/specs/invites.md`, `docs/permissions.md`, `docs/whatsapp-templates.md`.

**Decisions**

- **An invite never touches an existing account.** If the contact on the record already has one, the answer is "sign in, then confirm your roll number" (409). Merging or signing in through an invite would make the link a second way into an account.
- **WhatsApp invites need the college's attestation of opt-in** (recorded in the audit log); the people are not members, so there is no consent record of ours to check.
- **Invites go in English** until a college-level language exists (B12).
- **A link whose WhatsApp message failed is deleted** so the record can be invited again at once; once the allowance is reached the rest are reported "not sent".
- **No overview count** for onboarding: unclaimed records are not a review queue.
- Email-only records join with a verified email and no password; they sign in again through "Forgot password" or by adding a number. Noted in the spec.

**Earlier phases.** B3's CI run (`60883d8`) is green including e2e; the full local e2e suite passed (144 passed, 12 skipped). B2's last run (`8f485b9`) failed only in e2e, and its logs were unreadable (see the CI change above); B3's green run supersedes it.

**Next:** B5 (mentorship loop that never dead-ends).

## B5 · Mentorship loop that never dead-ends (Done)

**Shipped**

- Requests carry `version`, `nudgedAt`, `rematchOfferedAt` and `rematchOf`. Two delayed jobs per request: `mentorship.nudge` at 24 hours (WhatsApp with Accept/Decline through the new `cl_request_waiting` template, or push and email) and `mentorship.rematch` at 48 hours (the mentee hears about mentors likely to reply). Both carry the version and no-op when it changed; every change of status cancels them.
- `GET /mentorship/requests/:id/alternatives` (three mentors: not the one waited on, not at their cap, median reply not over 72 hours) and `POST /mentorship/requests/:id/rematch` (withdraws and resends the same message; outside the weekly limit).
- Mentor stats on cards, the mentor page and the rematch sheet: median reply time and reply band (from 3 requests), sessions completed, the viewer's next free slot, rating (from 3 reviews) and review count; cached an hour.
- Public reviews (`MentorReview`): after private feedback, 10 to 280 characters, first name and rating, moderated (`review` content and report target), exported and erased.
- `scoreMatch()`: reply-speed boost (+0 to 10, reason "Replies within a day") and load penalty (−0 to 15).
- New notification types `request_nudge` and `request_rematch` (en, te, hi on the server; en, te in the app).
- Web: stats line on mentor tiles (kept apart from the review list so Browse stays within the 70 KB screen budget), a track record and "What mentees say" on the mentor page, the rematch offer and sheet on sent requests, "Write a public review" after feedback, reviews removable from the moderation queue.
- Seed: a demo review of Rahul. Tests: `test/mentorship-loop.test.ts` (10), `test/isolation/mentorship-loop.test.ts` (3), privacy case, e2e `e2e/mentorship-loop.spec.ts`. Spec: `docs/specs/mentorship-loop.md`.

**Decisions**

- **Target company is not added twice.** `scoreMatch()` already gives +30 for a mentor at a company the mentee is targeting (Phase 3, normalised company names); the prompt's +10 term would count the same thing again.
- **Rating comes from public reviews**, not from private feedback, so the number on the page is explained by the reviews under it.
- **Unknown reply time does not exclude a mentor from a rematch** (new mentors would never get a chance); only a known median over 72 hours does.
- **No rematch message without suggestions.** If nobody qualifies, the mentee is not told to look elsewhere for nothing.
- **A rematch keeps the session type and drops the time**, since the slot was the first mentor's.
- **Reviews live in the mentorship module**; the sessions module learns which bookings have one through a hook (`SessionsService.reviewedOf`), keeping modules to services.

**Next:** B6 (TPO console).

## B6 · TPO console (Done)

**Shipped**

- `POST /admin/verification/bulk-decision` (up to 100; each through `decide()`, audited on its own, per-id results), with selection, "Approve selected" and "Reject selected" in Admin › Verification.
- `GET /admin/onboarding` (per branch and batch: on the list, invited, joined, verified, active this week through `suppress()`) and `POST /admin/onboarding/nudge` (B4 invites for one class), shown as "Progress by class" with a Nudge button in Admin › Onboarding; "Not joined yet" card on the admin overview.
- Targeted announcements: `audience`, `pinnedUntil`, `urgent` on posts; the audience applies to every read path; pinned announcements lead For you; "also send on WhatsApp" fans out the `announcement` notification (title only, template `college_announcement`, critical when urgent; 4 urgent a month per college). Composer options and "Pinned" / "For …" badges on cards.
- Tests: `test/tpo-console.test.ts` (8), `test/isolation/tpo-console.test.ts` (3), e2e `e2e/tpo-console.spec.ts`. Spec: `docs/specs/tpo-console.md`.

**Decisions**

- **`onboarding:manage` guards the progress and nudge routes** instead of "imports:manage or verification:review" (a route declares one permission; TPO and admins hold it).
- **The admin section already existed** (B4), so B6 extends it rather than adding a second one.
- **Only the activity count is suppressed** in the progress table; the other counts describe the college's own list.
- **Announcements notify only when "also send on WhatsApp" is chosen**; otherwise they are feed posts as before. The title is the one text field a notification carries (documented exception).
- **Pins apply to For you only**; Following stays strictly chronological.
- **Urgent needs WhatsApp**: urgency only changes the WhatsApp cap, so on its own it means nothing.

**Next:** B7 (placement drives).
