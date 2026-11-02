# Build progress (master prompt 1)

A new session reads this file first and resumes from the first phase that is not **Done**. The prompt is [`master-prompt-1.md`](master-prompt-1.md); the codebase map is [`facts.md`](facts.md).

| Phase | Name                                                           | Status |
| ----- | -------------------------------------------------------------- | ------ |
| B1    | Feature switches and the cut list                              | Done   |
| B2    | Phone-first identity, age and guardian consent                 | Done   |
| B3    | WhatsApp and SMS channels                                      | Done   |
| B4    | One-tap invites and class onboarding                           | Done   |
| B5    | Mentorship loop that never dead-ends                           | Done   |
| B6    | TPO console                                                    | Done   |
| B7    | Placement drives                                               | Done   |
| B8    | Placement outcomes and accreditation reports                   | Done   |
| B9    | Product analytics                                              | Done   |
| B10   | Plans, entitlements and billing                                | Done   |
| B11   | AI cost control                                                | Done   |
| B12   | Hindi and the language framework                               | Done   |
| B13   | Offline and low-data mode                                      | Done   |
| B14   | In-app help, feedback, legal pages and app-level observability | Done   |
| B15   | Hardening, demo data and final report                          | Done   |

## Step 0 · Set up

- **Baseline:** `main` is at `35fc3e4`; `claude/sleepy-euler-bi65m3` is at `df83e3c` (six commits past `cc965b1`: revamp phases 12 and 13), a straight continuation of `main`. The gate is green on `df83e3c` (format, lint, typecheck, 120 shared + 55 web + 758 API tests, build, bundle budget 169.5 KB, gitleaks).
- **Branch rule (deviation from Step 0.1):** this session must develop and push on `claude/keen-babbage-ts0wgj` and may not push to any other branch, so `main` was **not** fast-forwarded. The working branch was fast-forwarded to `df83e3c` and every phase is pushed there. Fast-forwarding `main` to it is left to the owner.
- **ADR numbering (conflict inside the prompt):** D6 asks for the AI-cost override to be ADR 0009, and B15 lists 0009 to 0012 for phone identity, WhatsApp, placements and plans. Decisions in §1 win, so the numbers shift by one: **0009** AI cost and model tiers (D6), **0010** phone-first identity and minors, **0011** WhatsApp channel and action tokens, **0012** placement records survive erasure in anonymised form, **0013** plans, entitlements and read-only on non-payment.
- **Session handover (B12 onwards):** the session that built B1 to B11 stopped before pushing B12. A new session took over on its own required branch, `claude/vigilant-cray-oelucl`, starting from `4a15de8` (B11), redid B12 there and carries on from B13. The owner asked for the work to reach `main` through one pull request from that branch.
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

## B7 · Placement drives (Done)

**Shipped**

- Module `placements` with five tenant collections (companies, academic records, drives, registrations, offers), each with isolation tests, export and erasure, and indexes led by `tenantId`.
- Shared eligibility (`checkEligibility`, with all unmet rules listed) and constants (`constants/placements.ts`: modes, statuses, rounds, results, CTC bands, export columns, `inFinalYears`).
- Drives: create (optionally with a linked `drive` event), edit until started, open (eligible students told, WhatsApp **Register** button), a reminder 24 hours before close (critical, versioned), close, start, complete, cancel. One-tap registration, or questions and a PDF résumé. Withdraw. Overrides by roll number with a reason (audited).
- Round results per student or from a CSV or Excel sheet keyed by roll number (unknown rolls listed back). Final results: a selection records a verified offer and congratulates the student.
- Offers: reported with proof (PDF or photo, rebuilt), verified or rejected with a reason by `outcomes:verify`; proof deleted 30 days after verification; declined by the student.
- Academic records: an "Academic records" type in the imports wizard; self-reported marks verified by the cell when the college has none.
- Export for a company: ticked columns only, CSV (BOM, formula-safe) or Excel, audited with columns, format and rows.
- Admin overview cards "Drives closing soon" and "Offers to verify"; notification category `placements`; job tracker link to report an offer.
- Web: Placements (For you, All drives, Registered, Offers, academic record), the drive page, Admin › Placement drives (drives, marks to verify, companies), the drive console (status, registrants, rounds, finals, let in, export), the drive editor, and Admin › Offers. Strings in en and te.
- Seed: DEMO drives at fictional companies (one Ananya can register for, one she cannot and why, one completed with Vikram's verified offer) and fictional marks.
- Tests: `test/placements.test.ts`, `test/isolation/placements.test.ts`, privacy cases for registrations, offers and academic records, `eligibility.test.ts` (shared), and e2e `e2e/placements.spec.ts`. Spec: `docs/specs/placements.md`.

**Decisions**

- **Overrides take a roll number**, which is what the placement cell has, as well as a member id.
- **Academic imports have no rollback.** They overwrite figures in place and keep no undo log, so a corrected file is the fix. The roster's "undo the latest import" skips them, so they never block it.
- **The academics import runs from Admin › Imports**, so it needs `imports:manage` (college admins). The TPO verifies self-reported marks instead. Granting the TPO imports would also give them roster imports.
- **Self-reports are refused once the college has a record** for that roll number: the college's figures win, and corrections go through the cell.
- **CTC and marks are not field-encrypted.** They are access-controlled (member and cell only) and shown elsewhere only as bands and suppressed counts. Encrypting them would block the aggregates B8 needs and would change the encryption scheme, which D10 reserves.
- **Erasure anonymises offers and registrations** (member, exact CTC, answers and proof removed; company, band, branch and batch kept), so the college's placement record does not shift when someone leaves. Self-reported marks are deleted; college marks are unlinked.
- **A diploma stands in for the 12th** (lateral entry), as colleges accept it.
- **The linked event is in person** at the venue (or "Placement cell") for four hours from the drive time; online drives can edit the event afterwards.
- **Alumni do not get `placements:view`** (campus drives are for current students; their outcomes come in B8). Faculty and staff can view drives but not register.
- **Being selected and a verified offer are celebration moments** (ADR 0008 amended, CLAUDE.md updated), once per device.
- **Final-year students get Placements as a main tab** in place of Jobs (`inFinalYears`: from 24 months before graduation, taken as June, to 6 months after). Jobs stays in the menu.

**Confirmed.** The full local e2e run on `b6862d2` passed 152 (12 skipped) and failed 6 phone-tab specs: since B7, Ananya (graduating 2027) has Placements as her last tab, and the specs still tapped Jobs. `532fec7` moves them to the Placements tab (22 passed locally) and its CI run is green. CI on `b6862d2` also failed the desktop "minor and guardian" spec: both demo colleges share the fictional minor and guardian numbers, so the second project could read the first project's code from the dev outbox before its own arrived. `c18be25` counts the outbox before each send and waits for one more (8 passed locally on both projects).

**Next:** B8 (outcomes and accreditation reports).

## B8 · Placement outcomes and accreditation reports (Done)

**Shipped**

- Outcome collections `HigherStudy`, `ExamQualification` and `Venture`: reported by students and alumni (`/me/outcomes`), verified or rejected with a reason by the placement cell (`/admin/outcomes/:kind`), or imported from the college's CSV or Excel sheet keyed by roll number (verified; unknown rolls listed back). Notifications `outcome_verified` and `outcome_rejected` (title only). Isolation, export and erasure.
- `modules/reports`: seven versioned definitions (internal placement by branch; NBA SAR placement, higher studies and entrepreneurship; NAAC placement, higher education, exams and alumni engagement; NIRF-style median salary), each with a source note, a review flag, a suppressed `compute` and a student-level `evidence`. Routes under `/admin/outcome-reports`: definitions, dashboard, a report, CSV/Excel summary and the evidence workbook (both audited).
- `anonKey` on offers and registrations (and outcomes), set once per erased member, so reports count people once after erasure.
- Web: Your outcomes (`/outcomes`, also Placements › Offers for students), Admin › Offers and outcomes (offers, higher studies, exams, ventures), Admin › Reports (dashboard with stat cards, trend chart and top recruiters; report pages with downloads). Strings in en and te.
- Seed: a DEMO higher study (Fatima) and GATE (Arjun), verified, and a waiting GATE for Vikram.
- Tests: `test/reports.test.ts` (known answers for every definition, suppression, downloads and audit, permissions), `test/outcomes.test.ts`, `test/isolation/outcomes.test.ts`, privacy cases, e2e `e2e/reports.spec.ts`. Spec: `docs/specs/outcomes-reports.md`.

**Decisions**

- **`/admin/outcome-reports`, not `/admin/reports`:** moderation already serves content reports at `/admin/reports`. The web screen is still Admin › Reports.
- **Reports need `analytics:tenant`** (TPO, college admin) and downloads `reports:export`. Faculty keep the cohort analytics they had.
- **Ratios hide with their counts.** A ratio or percentage built on a suppressed count is left out, otherwise "<5" could be worked back from it. The exact figures are in the evidence workbook, which is audited.
- **Every accreditation definition is marked for review** until someone checks it against the current manual; the NBA "30 × average" line is labelled "per the SAR format". The internal report is not.
- **Placed means a verified job offer** (internships excluded; PPO-type offers included). **Seeking placement** means registered for a drive or placed off campus.
- **NIRF median from exact figures only**, five or more; anonymised offers (band only) are left out.
- **NAAC exams count by the year qualified**; every other report counts by graduating batch.
- **Alumni engagement is not split by programme** and has no financial contribution yet (that is alumni giving, in Prompt 2).
- **Outcomes need no proof file.** The cell checks them against what it knows; a rejection's reason asks for documents if needed. This keeps uploads, and their retention, to offers.
- **Imports apply only to members.** Students not yet on the platform are listed back; their outcomes can be imported again once they join.
- **Report content is English** (titles, headings, notes), as accreditation bodies take it and as it downloads; the screens around it are translated.
- **Erasure keeps verified outcomes anonymised** (like offers): they are the college's record. Unverified ones are deleted.

**Confirmed.** Gate green; CI green on `ca925a5`; full local e2e 162 passed, 12 skipped, none failed.

**Next:** B9 (product analytics, first party).

## B9 · Product analytics, first party (Done)

**Shipped**

- `ProductEvent` (closed list of names, a day, ids and enum values only) recorded through a `track` callback after confirmed writes: visits (once a day), sign-ups, invites accepted, verification, mentorship requests and replies, completed sessions, drive registrations, verified offers, study questions and roadmap steps. Only active adults with the `analytics_aggregate` consent; withdrawing it stops recording and detaches past events.
- `InsightsService`: activation funnel, weekly actives by role, signup-week retention, request-to-session conversion with median reply time, drive registration rate, offers per 100 final-years, study questions per active student. Every count through `suppress()`; ratios only from shown counts.
- Retention: events past 13 months roll up into `ProductEventDaily` (no member in it) on the retention timer, then are deleted.
- Admin › Analytics tabs Activation, Retention, Mentorship and Placements (`analytics:tenant`). Platform › Traction: every college's counts side by side through `withPlatformScope('insights:platform-aggregates', …)`, counts only, audit-logged.
- Tests: `test/insights.test.ts` (fixture maths, minors, consent, roll-up, isolation, the platform path), e2e `e2e/insights.spec.ts`. Spec: `docs/specs/product-analytics.md`.

**Decisions**

- **A `visited` event** stands in for "active": the closed list in the prompt has no event for opening the app, and weekly actives and retention need one. It is written at most once a day per member (memory, then a partial unique index).
- **`request_sent`, not `first_request`:** conversion needs every request; "first" is worked out when counting.
- **No tenancy change.** `withPlatformScope` already accepts any `area:reason`; the platform view adds a name, not a rule (D10 did not apply). Its pipeline sizes member sets inside the database and returns counts per college.
- **The cross-college view is its own screen** (Platform › Traction), so the audited read happens only when someone opens it, not on every visit to the colleges list.
- **Eligibility is cached for 10 minutes** and cleared when a member changes a consent in Settings, so a withdrawal stops recording at once.
- **Withdrawal and erasure detach** (random `anonKey`) rather than delete, so past counts do not shift; the events never held text.
- **No backfill and no demo events.** Numbers start when B9 ships, and the seed does not invent usage.
- **Product tabs need `analytics:tenant`** (college-wide); faculty keep the cohort overview.

**Confirmed.** Gate green; CI green on `efae9b1`; full local e2e 165 passed, 13 skipped, none failed.

**Next:** B10 (plans, entitlements and billing).

## B10 · Plans, entitlements and billing (Done)

**Shipped**

- Plans as config (`constants/plans.ts`): Pilot (free, 90 days), Connect (₹40 per student per year, minimum ₹60,000, no placement drives) and Placement (₹75, minimum ₹1,20,000), each with features, WhatsApp and AI allowances per student per month. The platform owner edits a plan's terms (`PlanSetting`) and gives a college a custom deal; `mergeTerms()` layers them.
- Entitlements: feature switches are plan ∧ college choice, resolved in the tenant cache, so routes, jobs, navigation and permissions agree; Admin › Features shows switches outside the plan as unavailable. The WhatsApp allowance (B3) now comes from the plan. Nightly seat count (verified students + alumni active in 12 months) with a banner to admins when over, never blocking.
- Invoices: drafts, issue with the next number from `InvoiceCounter` (`CL/2026-27/0001`, unique index, retried race), GST (CGST + SGST/UTGST or IGST, none when unregistered), total in words, a PDF with Noto Sans for ₹ stored as file purpose `invoice`; void without payments.
- Payments: bank transfers recorded by the platform (amount, date, UTR; once per UTR; audited); online through `PaymentProvider` (`stub`, `razorpay` Payment Links) with the webhook verified by HMAC SHA256 and recorded once per payment id.
- Daily billing run per college: overdue marking, reminders 7 days before, on and 7 days after the due date (each once), and read-only from 30 days overdue until paid. Read-only refuses writes in the pipeline except an allowlist; nothing is deleted.
- Screens: Admin › Billing (plan, seats, usage, invoices to pay and download), an admin billing banner, a member notice while read-only, Platform › Billing (colleges, plans, a college's subscription, invoices and payments). Plan migration `b10-plans`; demo data: DPIT on Placement with a paid and an open invoice, MRCE on its pilot.
- Tests: `test/billing.test.ts` (19), a phone sign-up case in `test/phone-auth.test.ts`, a privacy case, e2e `e2e/billing.spec.ts`. Spec: `docs/specs/billing.md`.

**Decisions**

- **D10 check.** No change to session tokens, refresh rotation or the encryption scheme. Tenancy enforcement is unchanged: the plugin, the throw without context and `withPlatformScope` work as before. Two platform collections were added to the allowlist the prompt names for this purpose: `InvoiceCounter` (named in the prompt) and `PlanSetting` (the plan terms the console edits, D9 "can be edited in the platform console"); both are the seller's, not any college's, and the allowlist test pins the exact list. Razorpay is the provider D5 names; only the college's legal name, the invoice number and the amount go to it.
- **Allowances per student,** not flat per plan: a flat AI or WhatsApp allowance would be generous for 500 students and useless for 5,000. They are sized to the contracted seats, or to the minimum's worth when that is more.
- **Plan migration:** `trial` → Pilot, `standard` → Connect, `premium` → Placement, `seatLimit` → `seats`. `standard` becomes Connect (no drives) safely: drives arrived in B7, so no college had them before.
- **A new college starts on the Pilot** with its start date set, so it keeps every feature its switches allow until the platform moves it to a paid plan. Nothing locks when a pilot ends; the admin banner shows the date.
- **Numbers on issue, not on draft,** so a discarded draft never leaves a gap in the GST series. Issue claims the draft first, then takes the number (reverted to draft if numbering fails).
- **One invoice series for all colleges:** the seller issues every invoice, so the sequence is the seller's (per prefix and financial year).
- **Void only without payments;** credit notes are out of scope for this build.
- **Read-only refuses writes before authentication,** so every caller gets the same answer and the test can walk every write route. The allowlist (46 existing routes, plus paying and the Razorpay webhook) is account, privacy, safety, sessions already booked, provider webhooks and paying; a phone code during read-only signs members in but creates no account (`assertWritable`). Moderation stays open: removing harmful content is not adding content.
- **Seat activity** counts alumni who signed in within 12 months or kept a session going (a refreshed session), since `lastLoginAt` changes only at sign-in.
- **Webhook idempotency** rests on the unique payment reference per college and a check that the link was made for that invoice (`payLinkIds`), rather than `WebhookReceipt` (the channels module's model).
- **Razorpay docs:** razorpay.com was not reachable from the build environment; the adapter follows the official Node SDK source (`razorpay/razorpay-node`: payment link fields, `validateWebhookSignature`). Deployment lists a live test event as a gap before launch.
- **SAC code empty by default** with a console warning, and the GST rate in env, both to be confirmed by a chartered accountant.
- **Phone tabs** now light the most specific root (`/platform/billing/…` lights Billing, not Colleges); the same bug lit Colleges on Traction.

**Confirmed.** Gate green; CI green on `cb82c8a`; full local e2e 168 passed, 16 skipped, none failed.

**Next:** B11 (AI cost control), including D7 (remove `facultySeeChats`), which no earlier phase covered.

## B11 · AI cost control (Done)

**Shipped**

- Answers default to `claude-haiku-5-5` (`DEFAULT_CHAT_MODEL.anthropic`); `claude-sonnet-5-5` is the "deep" model (`DEEP_CHAT_MODEL`, `ActiveChat.deepModel`) for Prompt 2's heavy tasks; Opus only when an admin picks it. Other providers keep no default. ADR 0009 records the override of two Phase 9 decisions, and `docs/design/revamp/decisions.md` points to it.
- A college with no key answers on the platform's provider with the plan's allowance as its monthly budget; admins can lower it, never raise it (refused on save); only platform-key tokens count; a plan with no AI tokens leaves the college not configured. Colleges with their own key keep their own budget.
- Usage counters record `feature` and `platform` (migration for older counters). Admin › Billing shows platform tokens against the allowance, own-key tokens, and tokens by feature; the platform console estimates each college's AI cost from `AI_PLATFORM_PRICE_*`.
- `pnpm --filter @campuslink/api ai:smoke`: one answer, one embedding and `/quiz` per configured provider, with token counts (not in CI).
- D7: `facultySeeChats` removed everywhere (model, service, shared schema, admin screen, strings, six test files), a `$unset` migration, and a test that an old settings document loads before and loads and saves after it. `docs/privacy.md` says faculty never read study chats.
- Tests: `test/ai-cost.test.ts` (10). Spec: `docs/specs/ai-cost.md`.

**Decisions**

- **Whose key served a call is recorded** (`platform` on usage counters), so the allowance counts only the platform's tokens and the cost estimate prices only what the platform pays. Counters from before B11 count as the college's own (whose key served them was not recorded), so they are never billed as platform usage.
- **0 means "all of the allowance"** on the platform's provider (as 0 meant "no budget" before), so existing colleges with no budget set get their plan's allowance without anyone editing settings.
- **The allowance check happens on save (400 with the allowance in the message)** rather than silently clamping, so an admin sees why the number was not taken; the runtime also caps it, in case a plan is lowered after a budget was set.
- **Platform prices live in env** (`AI_PLATFORM_PRICE_*`, per million tokens), entered once by the platform owner; a console editor can come later. The estimate sums this month's platform tokens at those prices; nothing is billed from it.
- **The smoke script reads extra provider keys straight from the process env** (`ANTHROPIC_API_KEY` and so on), not from the app's validated env, because they are for the operator's one-off run only; the app never reads them.
- **No usage from a college's own key is billed or capped by the plan;** the plan only pays for the platform's provider.
- **D7 found six test files, not four** (also `study.test.ts` and `study-index.test.ts`); all were cleaned.

**Confirmed.** CI green on `4a15de8` (verify, e2e, adapters and security).

**Next:** B12 (Hindi and the language framework).

## B12 · Hindi and the language framework (Done)

**Shipped**

- `hi` in `SUPPORTED_LOCALES`, with `LOCALE_NAMES`, `LOCALE_TAGS`, `LOCALE_ENGLISH_NAMES`, `toLocale()` and `nextLocale()` in `packages/shared/src/locales.ts`. Every `'en' | 'te'` site now derives from the list: the Zod schemas (auth, users, onboarding, guardian), the Mongoose enums (users, study chats), the web's formatters (`lib/format.ts`, `lib/jobs.ts`, phone and mentor date pickers), the language pickers (Settings, the landing page, the guardian declaration) and the command palette, which now cycles through every language.
- `apps/web/src/i18n/hi.json`: all 3,563 strings, same keys and placeholders as English, loaded lazily like Telugu (the first load is unchanged at 158.5 KB). `parity.test.ts` now covers every supported locale (a file per locale, same keys, same placeholders, no empty strings).
- Anek Devanagari (self-hosted, `unicode-range`, nothing preloaded) next to Anek Telugu; Hindi gets Telugu's looser line height.
- Server texts: Hindi for every email and push notification (`templates.ts`, with a test that every language uses the English placeholders), the guardian declaration (`declaration.ts`), and a Hindi code SMS `otp_hi` used only once its DLT id is configured (English until then; `docs/sms-templates.md`). WhatsApp templates already had Hindi from B3.
- The study assistant recognises Devanagari (`detectLanguage()`) and answers in Hindi; teachers can tag material as Hindi (`MATERIAL_LANGUAGES`).
- Docs: `docs/adding-a-language.md` (Tamil or Kannada in five steps), `docs/build/translation-review.md` (what a native speaker must check, legal texts first). E2E: switching to Hindi and back (`core.spec.ts`).

**Decisions**

- **Invoices stay in English.** GST invoices are commonly issued in English, and `pdf-lib` cannot shape Devanagari (vowel signs and conjuncts would render broken). Recorded in `docs/adding-a-language.md`.
- **The Hindi code SMS is opt-in by registration:** a carrier silently drops an unregistered text, so `otp_hi` is sent only when `SMS_DLT_TEMPLATE_IDS` has its id.
- **Everyday Hindi** with the English loanwords students use (मेंटर, प्लेसमेंट, ड्राइव), `आप` throughout; product, brand and exam names untranslated. A native speaker and, for the declaration and consents, a lawyer must review it (`translation-review.md`).

**Next:** B13 (offline and low-data mode).

## B13 · Offline and low-data mode (Done)

**Shipped**

- A hand-written IndexedDB persister (`lib/offline-cache.ts`, its own chunk loaded at boot; rules in `lib/offline-rules.ts`) for the member's own reads: profile, sessions, conversations and their last 50 messages, job tracker, followed roadmaps, registered drives, opened study material and the first feed page. Contact fields are stripped from everything but the member's own profile; other members' profiles are never kept. Wiped on sign-out, on a dead session and when another member signs in; dropped after 7 days.
- Cold start shows the last-known content at once (the first render waits at most 400 ms for it) with a quiet "Updated N min ago"; offline the pill says "You're offline · saved N min ago".
- An offline session: when the session cannot be checked because the network is down and the device holds a saved copy, the app opens read-only from it and checks the session again on reconnect.
- Offline writes for RSVP, saving a job and marking a roadmap step wait in an outbox and are replayed with their Idempotency-Key (the three PUT routes are now `idempotent: true`); everything else still says "you're offline".
- Data saver (Settings › Preferences: Automatic, On, Off; automatic on Save-Data or 2G): images at the width shown (`GET /files/:id?w=160|320|640`), no stories on Home, no video preloading.
- Strings in en, te and hi. Spec: `docs/specs/offline.md`; privacy: `docs/privacy.md` › The offline copy on the device. Tests: `offline-rules.test.ts`, `test/offline.test.ts`, `e2e/offline.spec.ts`.

**Decisions**

- **An `offline` session status** rather than treating a network failure as "signed out", so a member on a dead connection still sees their saved copy. It changes only client-side gating; tokens, refresh rotation and `refresh-coordinator.ts` are untouched (D10 did not apply). No token exists while offline, so nothing can be written to the API.
- **Only state-setting PUTs are queued** (they are safe to replay and now idempotent); unsaving a job, messages, posts and requests need a connection.
- **Image variants are made on request and kept in memory** (300 at most) rather than stored as files: they are small, derived and access-checked like the original.
- **No digests over WhatsApp:** no digest feature exists yet (deviation; recorded in the spec).

**Fixes after CI (shipped with B14).** B13's first e2e run failed in its own offline specs and in three older specs. Reproduced locally against a mock API: (1) restored reads kept their saved time and counted as fresh, so a page loaded seconds later showed data from before a booking (now restored reads are marked stale and refetch on mount); (2) TanStack Query pauses mutations offline by default, so the outbox never ran (the three queued writes use `networkMode: 'always'`); (3) the college record, fetched at boot before the cache listened, was never saved, so an offline cold start had no college (reads that finished earlier are now swept in, and the app opens offline when the college comes from the saved copy).

**Next:** B14 (in-app help, feedback, legal pages and observability).

## B14 · In-app help, feedback, legal pages and app-level observability (Done)

**Shipped**

- Help centre (`/help`): seven guides in en, te and hi; **Report a problem** with an optional screenshot; the member's reports as threads. Admin › Support (college matters, overview count) and Platform › Support (bugs from every college, audited).
- Legal pages: privacy policy and terms from versioned templates filled with the college's details (Admin › Branding › Legal details), public at `/legal/privacy` and `/legal/terms`; a new version asks members to accept again (notice gate; `POST /me/notice`); the grievance officer in Settings › Privacy.
- `ErrorReporter` (`disabled`, `console`, `sentry` via the envelope protocol, no SDK) for unhandled API errors, failed jobs and browser errors relayed through `POST /client-errors`; `scrub()` keeps personal data out.
- `GET /metrics` (platform host, bearer `METRICS_TOKEN`): requests, jobs, OTP sends, WhatsApp failures, AI tokens, client and server errors.
- New permissions `support:create`, `support:manage`, `platform:support`; notification types `support_reply`, `support_ticket` (category _requests_); env `ERROR_REPORTER`, `ERROR_REPORTER_DSN`, `METRICS_TOKEN`.
- Spec: `docs/specs/help-support-legal.md`. Tests: `support.test.ts`, `legal.test.ts`, `observability.test.ts`, a privacy case, `e2e/help.spec.ts`.

**Decisions**

- **Browser errors go through the college's own API**, not straight to Sentry: no DSN in the browser and no CSP change (the prompt suggested adding the DSN host to the CSP when configured).
- **No Sentry SDK:** the envelope protocol is a few lines over `safeFetch` and works with GlitchTip too.
- **Support notifications use the existing _requests_ category** rather than a new one in everyone's settings.
- **Legal templates are English only** and need legal review; a translation is a new, reviewed version (the page says so in the member's language). The policy promises only what the product does (the inactive-account purge is not implemented, so it is not promised).
- **Re-consent compares notice versions:** `PRIVACY_NOTICE_VERSION` plus the college's published version. Accounts with no consent record at all count as accepted (they predate consent records).
- **Read-only colleges** can still accept a notice, report errors and ask for help (create, reply, close a report); the pinned list in the billing test records it.
- **Bug reports are read college by college** (`runInTenant` per college), not through a new platform scope.

**Next:** B15 (hardening, demo data and final report).

## B15 · Hardening, demo data and final report (Done)

**Shipped**

- Seed: an in-progress drive (`Associate engineer drive (DEMO)` at `Brightwave Systems (demo)`, Vikram past round one) next to the open and completed drives; a six-week product-event cohort (60 detached demo sign-ups, ten a week, plus the demo accounts' visits); an answered demo problem report and published legal details; a WhatsApp message log (template names and statuses only); `Demo Pending Minor`, who joined by phone and waits for the guardian's code (`+91 90000 001x9`, guardian `+91 90000 002x9`).
- Load test: phone sign-in for 100 members through the console SMS provider and the dev outbox; 500 students registering for one drive at the same moment, with a check that exactly 500 are stored and that a second tap is refused (409); NBA SAR, NIRF and dashboard reports over three batches of 1,000 graduates with registrations and offers.
- Docs: `architecture.md`, `data-model.md` (every B1–B14 collection), `threat-model.md` (phone codes, minors, the WhatsApp webhook and action tokens, invite links, placements, the billing webhook, help and metrics), `security-review.md` (master prompt review, two new gaps), `privacy.md` (demo data), `CLAUDE.md` (product events, phone identity, channels, placements, the offline copy, `ErrorReporter`); ADR 0012 and ADR 0013; the final report [`report-1.md`](report-1.md).
- Fix: B14 gave members who are not yet verified `support:create`; `test/auth.test.ts` pinned their permission list without it (CI on `e528c01` failed there).
- Fix (found while seeding the cohort): B9's one-visit-a-day unique index also covered detached visits (`userId: null`), so erasing or withdrawing consent for a second member who visited on the same day as an already-detached one failed with a duplicate key. The index now applies only to visits that still have a member (`test/insights.test.ts`).

**Decisions**

- **Demo product events are detached sign-ups** (`anonKey` `demo-…`, no account), so the directory and the e2e specs see no fictional people; B9's "no demo events" gives way to B15's explicit ask. The cohort's shape is chosen and documented in the seed and the report, not measured.
- **The WhatsApp "console log" is the message log**, since the console outbox lives in memory.
- **The load test is not in CI** (it needs its own database and takes minutes); this environment had no MongoDB, so its figures are still to be recorded in `docs/performance.md`.

**Next:** none in this prompt. The owner's registrations and reviews are listed in [`report-1.md`](report-1.md).

## Prompt 1b · Finish what prompt 1 left open

[`master-prompt-1b-remaining.md`](master-prompt-1b-remaining.md). A new session resumes from the first item that is not **Done**.

**Baseline.** `main` at `1d527a1` (merge of [Parthu-work/campuslink#1](https://github.com/Parthu-work/campuslink/pull/1)); CI green on it (verify, e2e, adapters, security). Work starts from `a471e43` (`claude/vigilant-cray-oelucl`, `main` plus this prompt's file; CI green).

**Branch rule.** The owner asked for a new branch from the most recently updated branch, so this work is on `feat/prompt-1b-remaining` (from `a471e43`), not on `main`, and reaches `main` through a pull request.

**Gate on the baseline.** Green, once the checkout uses LF line endings: a Windows checkout with `core.autocrlf=true` fails `format:check` on every file (Prettier expects LF). Set `core.autocrlf false` for the checkout (`git config --worktree core.autocrlf false`) and check it out again. No code change was needed.

**Owner's answers (this session, 2 November 2026).** R7: no answer given, so not built (the purge is not promised). R8: yes, build the weekly WhatsApp digest. R9: yes, evaluate Hindi invoices. R13: the lawyer's review of the English texts (O6) is done; start the translations.

| Item | What                                               | Status      |
| ---- | -------------------------------------------------- | ----------- |
| R1   | Only sign-up and notice records count as accepting | Done        |
| R2   | Run the load test and record it                    | Not started |
| R3   | UI checks on the B12 to B14 screens                | Not started |
| R4   | SMS for critical reminders                         | Done        |
| R5   | Credit notes                                       | Done        |
| R6   | Edit AI prices in the platform console             | Done        |
| R7   | Inactive-account purge                             | Not started |
| R8   | WhatsApp digests (owner: yes)                      | Not started |
| R9   | Hindi invoices (owner: evaluate)                   | Not started |
| R10  | Revisit `style-src 'unsafe-inline'`                | Not started |
| R11  | Find and fix the intermittent API test             | Not started |
| R12  | Check the report definitions against the manuals   | Not started |
| R13  | Translated legal texts (owner: O6 done, start)     | Not started |

### R1 · Only sign-up and notice records count as accepting (Done)

**Shipped.** `consentService.latestNoticeVersion()` reads only the `account` record from sign-up and `privacy_notice` records from the notice gate. `consentService.set()` (Settings) records the college's current notice (`currentNotice()`), so the log shows which notice was in force. Test in `legal.test.ts`: after accepting `+c1`, Settings changes (re-granting `account` too) keep `accepted: true`; a member who has not accepted still sees `accepted: false` after a Settings change. The test fails on the old code.

**Next:** R4, built before R2 and R3 (those need a quiet machine and the browser).

### R4 · SMS for critical reminders (Done)

**Shipped.**

- Templates `session_reminder` and `drive_reminder` (service-explicit) with separate Unicode `_te` and `_hi` versions, in `sms-templates.ts` and `docs/sms-templates.md` (identical; `channel-templates.test.ts`). Variables: first name, time, link.
- `ChannelService.sendSms()`: a verified number, a registered template (the member's language when registered, else English), the college's allowance. `NotificationsService` sends it when WhatsApp did not deliver (off, not opted in, or failed) and the member has **SMS reminders** on. Only `booking_reminder` at 1 hour and `drive_reminder` qualify (`smsReminderKey()`).
- Settings › Notifications: an **SMS reminders** switch (`smsReminders`, on by default; en, te, hi).
- Metering: `ChannelMessage`/`ChannelUsage` with channel `sms`; `/metrics` `campuslink_sms_reminders_total{template,outcome}`.
- Docs: `docs/sms-templates.md`, `docs/specs/whatsapp-channel.md`, `docs/privacy.md`, the privacy policy template, `translation-review.md`.
- Tests: `sms-reminders.test.ts` (each condition on and off, language, quiet hours, metering, the allowance cap, no SMS for other types).

**Decisions.**

- **SMS reminders count against the college's monthly allowance, shared with WhatsApp, and stop at it.** Critical WhatsApp messages are exempt from the allowance, but an SMS costs several times more, so a reminder SMS never exceeds it. Codes by SMS are metered but not counted (they are needed to sign in). The admin usage card now counts both.
- **Session reminders ignore quiet hours on SMS too**, as on every other channel (the member chose the time); drive reminders wait for quiet hours to end.
- **The privacy policy now says what SMS is used for**, so `PRIVACY_NOTICE_VERSION` moves from `2026-10-draft` to `2026-11-draft` and members accept again. The new sentence needs the lawyer's look (O6).
- The link is the third variable. DLT platforms limit a plain variable to 30 characters, so it must be registered as a URL variable with the college domains whitelisted (written in the doc for the owner).

### R5 · Credit notes (Done)

**Shipped.**

- `CreditNote` (tenant collection, indexes led by `tenantId`): the invoice it adjusts, lines, taxable value, GST split mirroring the invoice (same rate and kind), total in paise, reason, PDF, created and issued by. The invoice gains a running `creditedPaise` and nothing else changes on it.
- Numbers from their own series (`InvoiceCounter`, prefix `CN`, same financial-year rule), taken only on issue; a voided draft never takes one.
- Issue is atomic against the cap: a conditional update keeps the credited total at or under the invoice total, even with two issued at once (tested). Issuing an issued credit note is a no-op.
- Outstanding is total − payments − credit notes everywhere (overview, bank payments, the pay link, reminders, read-only). A credit note that leaves nothing owed marks the invoice `paid` and ends read-only.
- Routes (platform host, `platform:billing`): draft, issue, void a draft, download; the college's admins download theirs (`tenant:settings`). Audited in both logs. Platform › Billing › college: a **Credit note** action on issued invoices and a credit notes table; Admin › Billing lists issued credit notes (en, te, hi).
- The PDF says "Credit Note", the invoice it adjusts and its date, and the reason (also in the PDF's title and subject).
- Docs: `docs/specs/billing.md` (with what a CA should check), ADR 0013's consequences line, `docs/permissions.md`.
- Tests: `credit-notes.test.ts`, a privacy case (no member data; kept), and the e2e billing spec on desktop.

**Decisions.**

- **A credit note may follow full payment** (the college is then owed a refund, made outside the platform and not recorded here). Without that, a wrongly paid invoice could not be corrected the GST way.
- **Void applies to drafts only.** An issued credit note is final; a second credit note or a new invoice corrects it.
- **A settled invoice shows as `paid`** whether payments or credit notes settled it; the view shows `creditedPaise` beside `paidPaise`.
- No new notification type for the college's admins: the credit note appears in Admin › Billing.

### R6 · Edit AI prices in the platform console (Done)

**Shipped.** `PlatformSetting` (a new platform collection, key `ai_prices`, on the `PLATFORM_MODELS` allowlist with its reason; the pinned list in `billing.test.ts` updated), following `PlanSetting`'s pattern. `GET`/`PUT /platform/ai-prices` (`platform:billing`, platform host): prices per million tokens for input, output and embeddings (each may be empty) and a currency from `PRICE_CURRENCIES`; audited as `platform.ai_prices_changed` with each value before and after. The per-college estimate reads the saved prices; env stays the default until a value is saved. Platform › Billing › Plans has an **AI prices** card (en, te, hi). Tests in `ai-cost.test.ts`: permission (401, and 404 on a college host), validation (negative, unknown currency, missing and extra fields), the estimate before and after a change and with a cleared price, and the audit entries. Spec: `docs/specs/ai-cost.md`.

**Decision.** A new platform collection rather than reusing `PlanSetting` itself: its `plan` key is an enum of plan ids, and AI prices are not a plan's terms. The pattern (one document per key, `updatedBy`, upsert) is the same.
