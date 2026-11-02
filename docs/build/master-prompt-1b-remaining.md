# MASTER PROMPT 1b: CampusLink — finish what prompt 1 left open

You are the principal engineer on the CampusLink monorepo. Master prompt 1 ([`master-prompt-1.md`](master-prompt-1.md), builds B1 to B15) is implemented and merged into `main` (pull request [Parthu-work/campuslink#1](https://github.com/Parthu-work/campuslink/pull/1), merge commit `1d527a1`, 2 November 2026). This prompt closes everything it left open: one small bug, an intermittent test, the checks that were never run, the parts of the decisions that were built narrower than asked, the report definitions still marked for review, and the owner's own registrations and reviews. §6 lists what prompt 1 hands to Prompt 2, so nothing is lost between the two. It does **not** start Prompt 2 (`master-prompt-2-habit-growth-moat.md`); the reserved `peerMentors` switch and the deep-model features belong there.

Read first, once: `CLAUDE.md` (authoritative for conventions), [`implementation-status.md`](implementation-status.md) (one-page status), [`report-1.md`](report-1.md) (decisions, env vars, gaps) and [`progress.md`](progress.md) (per-build record). Do not re-audit the codebase; open only the files each item lists under **Touches**.

---

## Step 0: Set up

1. **Baseline.** Work from `main` (at or after `1d527a1`). If your session imposes a branch rule, follow it and record it in the progress log. Run `git log -1 --format=%h` and record it, and confirm that the GitHub Actions run on that commit is green (verify, e2e, adapters, security).
2. **Gate first.** Run the full gate (§2). If anything is red on the baseline, fix that before any item below and record it.
3. **Progress log.** Add a section **"Prompt 1b"** to [`progress.md`](progress.md) with every item in §3 (R1 to R13) and a status. After each item, record what shipped, decisions, deviations and what comes next. A new session resumes from the first item that is not **Done**.
4. Save this prompt verbatim as `docs/build/master-prompt-1b-remaining.md` if it is not already there. Commit (`docs: add master prompt 1b and its progress section`) and push.

---

## 1. Decisions already made (do not re-open)

- **D1 to D10 of prompt 1 stand** (phone-first identity, age, WhatsApp provider, SMS, payments, AI cost, faculty never read study chats, breadth, plans, stop-and-ask).
- **D10 still applies.** Stop and ask before any change to session tokens, refresh rotation, tenancy enforcement, the encryption scheme, or anything that sends personal data to a third party prompt 1 does not list (Meta, MSG91, Razorpay; Sentry or GlitchTip only when the owner turns error reporting on).
- **E1. Owner items are prepared, never performed.** You cannot register accounts, sign agreements, approve templates or review legal texts. For each owner item (§4), produce what the owner needs (checklists, exact texts, test scripts) and stop.
- **E2. Optional items need the owner's yes.** R8 (WhatsApp digests) and R9 (Hindi invoices) start only if the owner says so in this session; otherwise record "not started: owner's call" and move on.
- **E3. No live provider calls in CI or tests.** Live checks run only from the operator's own machine with real keys (like `ai:smoke`).

---

## 2. How to work (same gate as prompt 1)

- Before every push: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, the bundle budget (`pnpm --filter @campuslink/web budget`), the API coverage gate (`pnpm --filter @campuslink/api exec vitest run --coverage`) and the gitleaks scan (pinned version, as in `CLAUDE.md`).
- After every push: the end-to-end suite and the GitHub Actions run for that commit must be green. A red run is fixed with a follow-up commit before the next item starts. CI prints Playwright's failure snapshots (`error-context.md`) in the e2e job log; read them there.
- Every new endpoint: in `docs/permissions.md` (regenerate with `docs:gen`), with authorization and negative tests, in the permission matrix, and, if it writes, either refused while read-only or added on purpose to the pinned list in `test/billing.test.ts`.
- Every new tenant collection: indexes led by `tenantId`, cross-tenant isolation tests, `exportFor`/`eraseFor` registered with `PrivacyService`, a case in `test/privacy.test.ts`. A new platform collection goes on the `PLATFORM_MODELS` allowlist with a recorded reason (the model test pins the list).
- Every new string: `en`, `te` and `hi` (`parity.test.ts`). Every new SMS or WhatsApp text: in its template file and regenerated doc (`docs/sms-templates.md`, `docs/whatsapp-templates.md`), identical character for character (a test checks it).
- Conventional commits, ending with the session's attribution lines.

---

## 3. Items (in this order)

### R1. Only sign-up and notice records count as accepting the privacy notice

**Problem.** `consentService.latestNoticeVersion()` reads the newest consent record whose purpose is `account` or `privacy_notice`, whatever its source. `consentService.set()` (a change in Settings, `POST /me/consents`) writes `noticeVersion: PRIVACY_NOTICE_VERSION`, the platform's base version, not the college's current one (`…+c<n>`). A member who accepted a college's newer notice and then re-confirms the required `account` consent is asked to accept the notice again. It is minor, but the notice gate must depend only on what the member accepted.

**Touches:** `apps/api/src/modules/consent/consent.service.ts`, `apps/api/test/legal.test.ts`.

1. `latestNoticeVersion()` counts only records with source `signup` (purpose `account`) or `notice` (purpose `privacy_notice`).
2. `set()` records `noticeVersion` from `currentNotice()` (the college's current version), so the consent log shows which notice was in force when the member changed a setting.
3. Test: publish legal details, accept the new notice, change a consent in Settings (including re-granting `account`), and `/me` still reports `accepted: true`. A member who has not accepted still sees `accepted: false` after a Settings change.

**Done when:** the new test passes and the B14 legal and privacy suites stay green.

### R2. Run the load test and record it

**Touches:** `apps/api/src/scripts/loadtest.ts` (only to fix what the run finds), `docs/performance.md`.

1. Start the dev infrastructure (`pnpm infra:up`) and run `pnpm loadtest` on a quiet machine. It builds its own database: 1,000 members, 100 with phones, three batches of 1,000 graduates with registrations and offers, and an open drive.
2. The run must report: phone sign-in (start, read the code from the dev outbox, verify) for 100 members; 500 students registering for one drive at the same moment, with **exactly 500 stored** and a second tap refused (409); and the NBA SAR, NIRF and dashboard reports over three batches. A count other than 500 is a bug in the registration path: fix it (the unique index `one_per_drive` is the guarantee) rather than the test.
3. Record a "Results (prompt 1b)" section in `docs/performance.md`, laid out like the 2026-10-16 table (scenario, req/s, p50, p90, p99, max, requests, non-2xx, errors), with the machine and the date. Compare with the earlier results and explain any scenario that is more than twice as slow.
4. If a report takes longer than 2 s at p99 with 10 connections, profile it (`compute` in `modules/reports/definitions/`), fix what is cheap (an index led by `tenantId`, a projection), and record what is left.

**Done when:** the figures are in `docs/performance.md`, the drive burst stored exactly 500, and nothing found by the run is left unexplained.

### R3. The UI checks prompt 1's definition of done asks for, on B12 to B14 screens

**Touches:** `apps/web/` audit scripts (`audit:capture`, `audit:journeys`, `audit:extras`), the screens below, `docs/accessibility.md`.

1. At 360 px and desktop width, in both themes, with reduced motion and by keyboard only, check: the language switch and a Hindi screen (B12); Settings › Preferences › Data saver, the offline pill and an offline cold start (B13); Help, a guide, Report a problem, a report thread, Admin › Support, Admin › Branding › Legal details, Platform › Support, `/legal/privacy`, `/legal/terms`, the notice gate and Settings › Privacy › Grievance officer (B14).
2. Fix what fails (contrast, focus order, target size under 44 px, horizontal scroll at 360 px, text cut off in Hindi or Telugu). Use the existing primitives and tokens only.
3. Add any journey that is not covered yet to `audit:journeys`, and record the results in `docs/accessibility.md`.

**Done when:** every listed screen passes axe in both themes and both widths, keyboard-only use reaches every control, and the results are recorded.

### R4. SMS for critical reminders (D4, built narrower in B3)

**Goal:** a member who has not opted into WhatsApp, or whose WhatsApp message failed, still hears about a session about to start or a drive about to close, by SMS, without SMS becoming a marketing channel.

**Touches:** `modules/notifications/channels/sms-templates.ts`, `channel.service.ts`, `otp-sender.ts` (only to share the SMS provider), `modules/notifications/notifications.service.ts`, `packages/shared` notification preferences, `docs/sms-templates.md`, `docs/specs/whatsapp-channel.md`, `docs/privacy.md`.

1. Add DLT templates (service-explicit category) for the critical types only: a session starting (`booking_reminder` at 1 hour) and a drive closing (`drive_reminder`). Their text carries a first name, a time and a link to the app, never message text. Add them in English, and in Hindi and Telugu as separate Unicode templates sent only once their DLT ids are configured (the `otp_hi` rule).
2. Send an SMS only when: the notification is critical; the member has a verified phone; WhatsApp is not on for that member, or its send failed; the template's DLT id is in `SMS_DLT_TEMPLATE_IDS`; the member has not turned SMS reminders off (a new switch in notification settings, default on for critical types only); and quiet hours allow it.
3. Meter every SMS in `ChannelMessage`/`ChannelUsage` (channel `sms`) against the college's allowance, alert admins at 80% and 100% as for WhatsApp, and count it in `/metrics`.
4. Tests: each condition in step 2 on and off; metering; the template doc kept identical; the allowance cap; no SMS for non-critical types, ever.

**Done when:** the tests pass, the templates are in `docs/sms-templates.md` for the owner to register, and the privacy notice and channel spec say what SMS is used for.

### R5. Credit notes (billing gap from B10)

**Goal:** correct an issued invoice the GST way, with a credit note, without ever changing the invoice.

**Touches:** `modules/billing/` (model, service, routes, PDF), `packages/shared/src/constants/plans.ts` or `schemas/billing.ts`, Platform › Billing and Admin › Billing screens, `docs/specs/billing.md`, ADR 0013 (consequences line).

1. `CreditNote` (tenant collection): the invoice it adjusts, a number from its own series taken only on issue (`InvoiceCounter` with prefix `CN`, same financial-year rule), lines, taxable value and GST split mirroring the invoice, total in whole paise, reason, PDF (file purpose `invoice`), issued by and when. A credit note never exceeds what is left of the invoice after earlier credit notes.
2. The outstanding amount of an invoice is total − payments − credit notes. Overdue, reminders and read-only use it, so a credit note that settles an invoice ends read-only like a payment does (`refreshReadOnly`).
3. Routes (platform host, `platform:billing`): draft, issue and void a draft credit note; list and download them for a college. The college's admins see and download theirs in Admin › Billing. All audited. Issue is `idempotent: true`.
4. Tests: numbering on issue only and no gaps from drafts; the cap; outstanding and read-only after a credit note; isolation; permissions; privacy (credit notes are the college's records, kept); the PDF has the credit note's number, the invoice it adjusts and the reason.

**Done when:** a platform admin can issue a credit note against an issued invoice end to end (e2e on desktop), and the spec says what a CA should check (§4).

### R6. Edit AI prices in the platform console (B11 left them in env)

**Touches:** `modules/study/ai-settings.service.ts` (or where `AI_PLATFORM_PRICE_*` is read), `modules/platform/` routes, Platform › Billing or a Platform › AI screen, `db/models.ts` allowlist, `docs/specs/ai-cost.md`.

1. A platform setting for the prices the platform pays per million tokens (input, output, embedding, currency), edited by `platform:billing`, audited with old and new values. Env values remain the default until a value is saved.
2. The per-college cost estimate reads the saved prices. Nothing is billed from them (unchanged from B11).
3. If this needs a new platform collection, add it to `PLATFORM_MODELS` with a recorded reason and update the pinned list in the model test. Prefer reusing `PlanSetting`'s pattern.
4. Tests: permission, validation (no negative prices, a currency from the list), the estimate before and after a change, the audit entry.

**Done when:** the platform owner changes a price in the console and the estimate follows, without a deploy.

### R7. Inactive-account purge, only if the owner wants it promised

B14 removed this promise from the privacy policy because it is not implemented. Ask the owner first: "Should accounts with no sign-in for N months be deleted automatically?"

If yes:

**Touches:** `modules/privacy/`, `modules/tenants/tenant.model.ts` (`retention`), the admin screen where the college sets its retention, `modules/tenants/legal-templates.ts`, `docs/privacy.md`.

1. A per-college retention setting `inactiveAccountMonths` (off by default; at least 24 months when on), set by college admins and audited.
2. The daily retention run finds members with no sign-in and no refreshed session for that long, warns them twice (60 and 14 days before) by the channels they have, then schedules erasure through `PrivacyService` with the normal grace period. Never for staff and admins (`COLLEGE_ADMIN`, `TPO`, `FACULTY`) or members with an open placement registration, offer or support report.
3. The legal template states the purge only when the college has turned it on (a new placeholder), and publishing the change bumps the notice version.
4. Tests: selection, the exceptions, warnings sent once, erasure scheduled not immediate, the template text with the setting on and off.

If no: record the decision in the progress log and in `docs/privacy.md` › Retention.

### R8. WhatsApp digests (optional: owner's call, E2)

B13 asked for "digests over WhatsApp"; no digest feature exists. Ask the owner whether a weekly digest is wanted at all. If yes: a weekly per-member digest (counts and first names only: new drives you are eligible for, unanswered requests, sessions this week) built by a gated job (`gatedJob`, feature `whatsapp`), a new utility template in three languages (owner registers it, §4), the member's weekly cap and the college's allowance applied, push and email as the fallback, and off by default in notification settings. Tests as for any channel message, plus "never when the member has nothing new".

### R9. Hindi invoices (optional: owner's call, E2)

B12 kept invoices in English because `pdf-lib` cannot shape Devanagari. Only if the owner asks: evaluate a free shaping engine (for example HarfBuzz compiled to WebAssembly) that turns Hindi text into positioned glyphs that `pdf-lib` can draw, behind the existing invoice PDF function, with English remaining the legal copy. Record the evaluation, and build it only if the result passes a native speaker's check of conjuncts and vowel signs. Otherwise record why it stays English.

### R10. Revisit `style-src 'unsafe-inline'` in the web CSP

**Touches:** `deploy/nginx/security-headers.conf` and its test, `apps/web` (only where inline styles are set), `docs/security-review.md` › Gaps.

1. List what sets inline styles today (Radix positioning, motion, the palette swap in `applyBranding()`, others).
2. Try `style-src 'self'` with `style-src-attr 'unsafe-inline'` (or nonces/hashes where the libraries allow) so `<style>` elements are locked down even if style attributes stay allowed; run the e2e suite under it (the preview serves the same file).
3. Ship it if the suite and a manual pass are clean; otherwise record precisely which library needs what, and keep the gap with that reason.

**Done when:** the CSP is tighter and green, or the gap row says exactly why it cannot be yet.

---

### R11. Find and fix the intermittent API test

On 2 November one `pnpm test` run failed on a commit that changed only a Markdown file (`2f8f71f`); the pull-request run on the same commit and every run before and after it passed. Its output could not be read at the time (the MongoDB service log buried it). `verify` now starts MongoDB as a quiet step, so a recurrence is readable.

**Touches:** whichever test it turns out to be.

1. With the dev infrastructure up, run the API suite repeatedly (`for i in $(seq 1 10); do pnpm --filter @campuslink/api test || break; done`), and watch CI for a recurrence.
2. When it fails, find the root cause. Suspects are anything that depends on the clock (day and week boundaries in insights, billing due dates in IST, OTP expiry), on test order or shared in-memory state (`eligibleCache`, `visitedToday`, the tenant cache), or on timing (rate limits, delayed jobs). Fix the code or make the test deterministic (inject the clock, isolate the state). Never skip, retry-wrap or quarantine it.
3. If ten local runs and a week of CI show no recurrence, record that in the progress log with the runs, and close the item.

**Done when:** the cause is fixed with a test that would have caught it, or the item is closed with the evidence above.

### R12. Check the report definitions against the current manuals (B8)

Every accreditation definition in `modules/reports/definitions/` is marked for review (`needsReview`) because nobody has checked it against the current NBA SAR, NAAC (SSR/DVV) and NIRF documents.

**Touches:** `modules/reports/definitions/*.ts`, `test/reports.test.ts`, `docs/specs/outcomes-reports.md`.

1. For each definition, find the current official manual or format (the accrediting body's own site), and record the document, its version or date and its URL in the definition's source note.
2. Compare every figure, column and formula with the manual. Where they agree, clear `needsReview` for that figure. Where they differ, follow the manual and update the known-answer test. Where the manual is ambiguous or not available, leave `needsReview` with a note of what is unclear. Never add a figure the manual does not define.
3. Record each check (document, date, what changed) in `docs/specs/outcomes-reports.md`.

**Done when:** every definition cites its manual, and each remaining `needsReview` says why.

### R13. Translated legal texts (after the lawyer's review)

B14's privacy policy and terms are English templates; the app tells Telugu and Hindi readers so. Start only after O6 (the lawyer's review of the English texts) and with the owner's yes.

**Touches:** `modules/tenants/legal-templates.ts`, `LegalService`, `features/legal/`, `docs/build/translation-review.md`.

1. Add `te` and `hi` versions of each template as their own reviewed versions (the English one stays the legal reference, and the page says so). A member reads the version in their language when it exists.
2. A change to any language's text bumps the notice version, so members accept again.
3. Each translation goes through O7 (the native speaker's review) before it is published; until then it stays unpublished.

**Done when:** both translations are published after review, and the notice gate works for each language.

## 4. Owner items (prepare, do not perform)

For each, produce what is listed, put it in [`report-1.md`](report-1.md) › "What the owner must register or have reviewed", and stop:

| #   | Owner item                                                                  | What you prepare                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Merge PR #1 into `main` (the prompt 1 rule is to work on `main`)            | Nothing; confirm CI is green on its head                                                                                                                                                            |
| O2  | Meta Business verification, a WhatsApp number, templates in three languages | The template list with exact texts (`docs/whatsapp-templates.md`), the webhook URL and settings, and a one-page live check script: one code, one template, one quick-reply tap, one status callback |
| O3  | DLT entity, header and templates; MSG91 account                             | The exact texts (`docs/sms-templates.md`, including R4's), the mapping to MSG91 Flow templates, and a live check: one code and one reminder                                                         |
| O4  | Razorpay account, Payment Links and the webhook                             | The webhook URL and event (`payment_link.paid`), and a live check: one test-mode payment recorded once, with the replay ignored                                                                     |
| O5  | A chartered accountant's review                                             | A sample invoice and credit note PDF from the seed, the GST split rules, the SAC code and numbering questions                                                                                       |
| O6  | A lawyer's review                                                           | The minors flow and guardian declaration, the privacy policy and terms templates, the consent texts, ADR 0012 (anonymised placement records), and R7's text if built                                |
| O7  | Native Hindi and Telugu review                                              | `docs/build/translation-review.md`, legal texts and the declaration first                                                                                                                           |
| O8  | An external penetration test                                                | The threat model, security review and a scope list (hosts, roles, demo accounts)                                                                                                                    |

---

## 5. Final report

When R1 to R13 are each **Done**, **Not started: owner's call**, or **Blocked** with a reason, update [`implementation-status.md`](implementation-status.md) and add a "Prompt 1b" section to [`report-1.md`](report-1.md): what shipped, decisions and deviations, new env vars, the load test figures, and what is still the owner's.

---

## 6. Handed to Prompt 2 (do not build here)

Prompt 1 deferred these to Prompt 2 (`master-prompt-2-habit-growth-moat.md`). They are listed so they are not lost; build them only from that prompt:

- **Peer mentors:** the `peerMentors` feature switch is reserved (B1) and does nothing yet.
- **Resume builder:** replaces the PDF résumé upload for drive registration (`placement_resume`, B7).
- **One-tap code autofill on Android:** the WhatsApp authentication template's autofill needs an Android app package (B3).
- **Alumni giving:** NAAC alumni engagement has no financial contribution yet (B8).
- **Deep-model features:** `DEEP_CHAT_MODEL` / `deepModel` is wired (B11) but no feature uses it yet.
