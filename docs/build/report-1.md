# Final report: master prompt 1 (builds B1 to B15)

**Date:** 2026-11-01. **Branch:** `claude/vigilant-cray-oelucl`, one pull request into `main`. The phase-by-phase record (what shipped, every decision, CI confirmations) is [`progress.md`](progress.md); this report summarises it for the owner.

## Acceptance for the whole prompt

| Journey                                                                           | Where it is proved                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A fresh college is created and its roster imported                                | Platform › Colleges (`test/permissions.test.ts` › super admin), Admin › Imports (`test/imports.test.ts`, `e2e/people.spec.ts`)                                           |
| Its students and alumni are invited and active by phone in about two minutes each | Invite link or class code → code to the number on record → verified member (`test/onboarding.test.ts`, `e2e/invites.spec.ts`, `e2e/phone-signup.spec.ts`)                |
| Its TPO runs a drive end to end                                                   | Create, open, register, rounds, finals, offer verified, export (`test/placements.test.ts`, `e2e/placements.spec.ts`); 500 students registering at once (`pnpm loadtest`) |
| Its principal downloads NBA and NAAC evidence                                     | Admin › Reports, summary and evidence workbook, audited (`test/reports.test.ts`, `e2e/reports.spec.ts`)                                                                  |
| The platform owner invoices it                                                    | Platform › Billing: draft, issue, PDF, bank or online payment (`test/billing.test.ts`, `e2e/billing.spec.ts`)                                                            |
| Every gate is green and the first load is at most 170 KB                          | CI on the pull request (verify, e2e, adapters, security); the first load is 162.1 KB gzipped after B15 (`pnpm --filter @campuslink/web budget`)                          |

## What shipped, per build

- **B1 Feature switches.** Eleven switches (`packages/shared/src/features.ts`) enforced by routes (`403 FEATURE_DISABLED`), jobs (`gatedJob`), navigation and screens; Admin › Features; a data-migration runner (`db/migrations.ts`). The 1 KB i18n runtime replaced i18next (first load 169.9 → 154.7 KB).
- **B2 Phone-first identity and minors.** Phone sign-up and sign-in, number change, `OtpService` and `OtpSender`; encrypted phone with a blind index; minors as `guardian_pending` with no permissions until a guardian's code to the number on the college's record; guardian consent in the consent log; adulthood job. ADR 0010.
- **B3 WhatsApp and SMS.** Meta Cloud API and MSG91 adapters; WhatsApp as a fourth notification channel behind opt-in, caps and the college's allowance; signed quick-reply actions; the webhook on the platform host. ADR 0011.
- **B4 Invites and class onboarding.** Single-use invite links (hashed tokens) by WhatsApp or CSV, class join codes with a poster and QR code; both end with a code to the contact on the college's record.
- **B5 Mentorship loop.** 24-hour nudge and 48-hour rematch jobs, alternatives, mentor stats, public reviews, reply-speed and load terms in matching.
- **B6 TPO console.** Bulk verification, class-by-class onboarding progress with nudges, targeted and pinned announcements with an optional WhatsApp send.
- **B7 Placement drives.** Companies, drives, one-tap registration, eligibility, overrides, rounds and finals from sheets, offers with proof and verification, academic records, company exports.
- **B8 Outcomes and reports.** Higher studies, exams and ventures; seven versioned report definitions (NBA SAR, NAAC, NIRF-style and internal) with suppressed summaries and audited evidence workbooks; the principal's dashboard.
- **B9 Product analytics.** First-party events after confirmed writes, the activation, weekly actives, retention, mentorship and placement tabs, and the platform's cross-college traction view.
- **B10 Plans and billing.** Pilot, Connect and Placement plans, entitlements, seat counts, GST invoices with PDFs, bank and Razorpay payments, reminders, read-only from 30 days overdue. ADR 0013.
- **B11 AI cost control.** Haiku-tier answers by default, the platform's provider metered against the plan's allowance, usage by feature, a live smoke script; D7 removed `facultySeeChats`. ADR 0009.
- **B12 Hindi.** `hi` in `SUPPORTED_LOCALES`, every locale site derived from the list, 3,563 strings, Devanagari font, Hindi notifications, declaration and an opt-in Hindi code SMS; `docs/adding-a-language.md`.
- **B13 Offline and low-data.** IndexedDB copy of the member's own reads, an offline session, an outbox for three idempotent writes, data saver with resized images.
- **B14 Help, legal and observability.** Help centre and problem reports (college and platform desks), legal pages from templates with re-consent, `ErrorReporter` and `/client-errors`, `/metrics`.
- **B15 Hardening, demo data and this report.**
  - Seed (`pnpm seed`): an in-progress drive at a new fictional company with Vikram past the first round, alongside the open and completed drives already seeded; a six-week product-event cohort; an answered demo problem report and published legal details; a WhatsApp message log (template names and statuses only, as the real log holds); a minor who has joined and is waiting for guardian consent. Everything is labelled DEMO or uses `.example` addresses and `+91 90000 …` numbers.
  - Load test (`pnpm loadtest`): phone sign-in for 100 members (code through the console provider, read back from the dev outbox), 500 students registering for one drive at the same moment with a check that exactly 500 are stored and that a second tap is refused, and NBA SAR, NIRF and dashboard reports over three batches of 1,000 graduates (registrations and offers included).
  - Docs: `architecture.md`, `data-model.md`, `threat-model.md` (phone codes, minors, the WhatsApp webhook, invite links, placements, the billing webhook, help and metrics), `security-review.md`, `CLAUDE.md`; ADRs 0012 and 0013.
  - A test fix: B14 lets members who are not yet verified ask for help (`support:create`), and the auth suite's pinned list of their permissions now includes it.
  - A bug fix in B9: erasing two members who visited on the same day failed on the one-visit-a-day index (detached visits share `userId: null`); the index now covers only visits that still have a member, with a regression test.

## Decisions and deviations

The full list is in `progress.md` under each build. The ones the owner should know:

- **ADR numbers shifted by one** (D6 asked for AI cost as 0009): 0010 phone identity, 0011 WhatsApp, 0012 placement records on erasure, 0013 plans and read-only.
- **Branch and pull request.** The prompt says to work on `main`; this session could push only to its own branch, so B12 to B15 (and B1 to B11, carried over from the earlier session's branch) reach `main` through one pull request.
- **D10 was never triggered:** no change to session tokens, refresh rotation, tenancy enforcement or the encryption scheme, and no personal data goes to a third party the prompt does not name. Two platform collections were added for billing (`InvoiceCounter`, as the prompt names, and `PlanSetting`).
- **Kept from earlier conventions:** student posting stays off for new colleges (B1); CTC and marks are access-controlled, not field-encrypted (B7: encrypting them would change the encryption scheme and block aggregates); target-company matching is not counted twice (B5).
- **Narrower than asked:** SMS carries codes only (no SMS reminders); no digests over WhatsApp (no digest feature exists); support notifications use the existing _requests_ category; invoices and legal templates are English only.
- **Demo product events (B15) against B9's "no demo events":** the prompt now asks for a six-week cohort, so the seed adds one. The 60 sign-ups are detached (`anonKey` starting `demo-`, no account) so nobody fictional appears in the directory, and the sign-ups are labelled `source: demo`.
- **Seeded WhatsApp "console log":** the console provider keeps messages in memory, so the seed writes the message log an admin sees (template names, statuses and ids, as in production). Codes sent while the app runs are read through `GET /dev/outbox`.
- **Invoices for one demo college:** DPIT is on the Placement plan with a paid and an open invoice; MRCE stays on its pilot, so both states can be shown.

## New environment variables

All are optional unless the provider that needs them is selected; `config/env.ts` refuses to boot on a missing or malformed value, and production refuses the console and stub providers. `.env.example` lists every one.

| Variable                                                                                                               | Default       | Purpose                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `SMS_PROVIDER`                                                                                                         | `disabled`    | `disabled`, `console` (dev outbox) or `msg91`                                                                                 |
| `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_DLT_ENTITY_ID`                                                                    | —             | MSG91 auth key, the six-letter DLT header, the principal entity id                                                            |
| `SMS_DLT_TEMPLATE_IDS`                                                                                                 | —             | DLT template ids per key (`otp=…,otp_hi=…`); the Hindi code SMS is used only once its id is set                               |
| `WHATSAPP_PROVIDER`                                                                                                    | `disabled`    | `disabled`, `console` (dev outbox) or `cloud` (Meta Cloud API)                                                                |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION` | —             | Cloud API access, the sending number, webhook signature secret, webhook verify token, Graph API version (for example `v21.0`) |
| `WHATSAPP_AUTH_TEMPLATE`                                                                                               | `auth_code`   | Name of the authentication (code) template                                                                                    |
| `WHATSAPP_ACTION_SECRET`                                                                                               | —             | Signs quick-reply action tokens (32+ characters; required in production with `cloud`)                                         |
| `PAYMENT_PROVIDER`                                                                                                     | `disabled`    | `disabled`, `stub` (development) or `razorpay`                                                                                |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`                                                    | —             | Razorpay Payment Links and webhook verification                                                                               |
| `BILLING_SELLER_NAME`, `BILLING_SELLER_ADDRESS`, `BILLING_SELLER_GSTIN`, `BILLING_SELLER_STATE`                        | demo seller   | The seller printed on invoices                                                                                                |
| `BILLING_GST_REGISTERED`, `BILLING_GST_RATE`                                                                           | `false`, `18` | Whether GST applies, and its rate (to be confirmed by a CA)                                                                   |
| `BILLING_SAC_CODE`                                                                                                     | empty         | Services Accounting Code; empty shows a console warning                                                                       |
| `BILLING_INVOICE_PREFIX`, `BILLING_PAYMENT_TERMS_DAYS`, `BILLING_BANK_DETAILS`                                         | `CL`, `30`, — | Invoice series prefix, due days, bank details for transfers                                                                   |
| `AI_DEFAULT_DEEP_MODEL`                                                                                                | —             | The "deep" model for heavy tasks (Prompt 2)                                                                                   |
| `AI_PLATFORM_PRICE_INPUT`, `AI_PLATFORM_PRICE_OUTPUT`, `AI_PLATFORM_PRICE_EMBEDDING`, `AI_PLATFORM_PRICE_CURRENCY`     | —, `USD`      | What the platform pays per million tokens, for the console's cost estimate                                                    |
| `ERROR_REPORTER`, `ERROR_REPORTER_DSN`                                                                                 | `disabled`    | `disabled`, `console` or `sentry` (envelope protocol; Sentry or GlitchTip DSN, https)                                         |
| `METRICS_TOKEN`                                                                                                        | —             | Bearer token for `GET /metrics` on the platform host (32+ characters); unset, the route is 404                                |

## What the owner must register or have reviewed

**Prompt 1b:** each item below, with the exact texts, settings and a one-page live check, is in [`owner-checklists.md`](owner-checklists.md) (O1 to O8). New since prompt 1: the reminder SMS templates (R4) for DLT and MSG91, the weekly digest template `cl_weekly_digest` (R8) for Meta, credit notes (R5) for the chartered accountant, the privacy policy's SMS sentence for the lawyer, and the Telugu and Hindi legal texts (R13) for the native-speaker review.

1. **Meta Business verification**, a WhatsApp Business number, and the templates in [`docs/whatsapp-templates.md`](../whatsapp-templates.md) in English, Telugu and Hindi (utility templates and the authentication template with a copy-code button). Then one live code and one template send with `WHATSAPP_PROVIDER=cloud` to confirm the Graph API version and button components (the adapter is verified against fakes only).
2. **DLT registration** (TRAI): the principal entity, a six-letter header, and the code templates in [`docs/sms-templates.md`](../sms-templates.md) (`otp` in English first; `otp_hi` when Hindi codes are wanted).
3. **MSG91**: an account with the DLT templates mapped to Flow templates; one live code with `SMS_PROVIDER=msg91` to confirm `template_id` and the `var` names.
4. **Razorpay**: an account, Payment Links enabled, the webhook (`/webhooks/razorpay` on the platform host, event `payment_link.paid`) and its secret; one test payment end to end.
5. **A chartered accountant's review** of the invoice format, the GST rate and split, the SAC code and the numbering series.
6. **A lawyer's review** of the minors flow and the guardian declaration (`docs/privacy.md` › Age and members under 18), the privacy policy and terms templates (`modules/tenants/legal-templates.ts`), the consent texts, and ADR 0012's anonymised records.
7. **A native Hindi review** (and Telugu) of the strings, notifications and, first, the legal texts and declaration (`docs/build/translation-review.md`).
8. **An error-reporting project** (Sentry or self-hosted GlitchTip) if wanted, and a Prometheus scrape of `/metrics` with `METRICS_TOKEN`.

## Known gaps

- **Not run in this build environment:** this session had no MongoDB, so the API suites, the end-to-end suite, the seed and the load test ran only in CI (the load test is not part of CI and has not been run; run `pnpm loadtest` on a machine with the dev infrastructure and record the figures in `docs/performance.md`).
- **Provider adapters** (Meta, MSG91, Razorpay) are checked against fakes only (above).
- SMS reminders (codes only today), digests over WhatsApp, credit notes, a console editor for AI prices, Hindi invoices and translated legal texts are not built.
- The WhatsApp console outbox is in memory and cannot be seeded; the seed writes the message log instead.
- Reports are marked for review until checked against the current NBA, NAAC and NIRF manuals.
- From earlier phases (`security-review.md` › Gaps): `style-src 'unsafe-inline'` in the CSP and no external penetration test yet.

## What Admin › Analytics shows for the demo cohort

Worked out from the seeded events with the dashboard's own rules (suppression under 5, ratios only from shown counts), for a seed run on Sunday 2026-11-01. A seed run on another weekday shifts which week each sign-up falls in, so the exact figures move by a few points. Placement figures come from the seeded drives and offers, not from events, and stay under 5 (suppressed) for the small demo batches.

| Tab                          | Figure                               | Value                    |
| ---------------------------- | ------------------------------------ | ------------------------ |
| Activation                   | Signed up in the last 12 weeks       | 60                       |
|                              | Verified                             | 48                       |
|                              | Signed up at least a week ago        | 50                       |
|                              | Active in their first week           | 43 (86.0%)               |
| Weekly actives (all members) | Weeks of 21 Sep to 26 Oct            | 10, 20, 22, 37, 42, 44   |
| Retention                    | Cohort of 21 Sep (10), weeks 1 to 5  | 100%, 60%, 40%, 40%, 40% |
|                              | Cohort of 28 Sep (10), weeks 1 to 4  | 60%, 40%, 40%, 20%       |
|                              | Cohort of 5 Oct (10), weeks 1 to 3   | 90%, 60%, 40%            |
|                              | Cohort of 12 Oct (10), weeks 1 and 2 | 80%, 40%                 |
|                              | Cohort of 19 Oct (10), week 1        | 100%                     |
| Mentorship                   | Requests sent / led to a session     | 36 / 18 (50.0%)          |
| Study                        | Questions / active students          | 15 / 63 (0.24 each)      |

The demo accounts (staff, alumni, two students) add visits in the last three weeks; their per-role counts are under 5 and show as "<5".

## Next

Prompt 2 (peer mentors, alumni giving, the deep-model features). Before the first real college: the registrations and reviews above, a live run of `pnpm loadtest`, and the penetration test.
