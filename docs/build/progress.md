# Build progress (master prompt 1)

A new session reads this file first and resumes from the first phase that is not **Done**. The prompt is [`master-prompt-1.md`](master-prompt-1.md); the codebase map is [`facts.md`](facts.md).

| Phase | Name                                                           | Status      |
| ----- | -------------------------------------------------------------- | ----------- |
| B1    | Feature switches and the cut list                              | Done        |
| B2    | Phone-first identity, age and guardian consent                 | Done        |
| B3    | WhatsApp and SMS channels                                      | Not started |
| B4    | One-tap invites and class onboarding                           | Not started |
| B5    | Mentorship loop that never dead-ends                           | Not started |
| B6    | TPO console                                                    | Not started |
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
