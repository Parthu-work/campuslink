# Implementation status: master prompt 1

**As of:** 2 November 2026. **Branch:** `claude/vigilant-cray-oelucl`. **Pull request:** [Parthu-work/campuslink#1](https://github.com/Parthu-work/campuslink/pull/1) into `main`.

This is a one-page status. The detailed record is [`progress.md`](progress.md) (every build, decision and CI confirmation) and [`report-1.md`](report-1.md) (the final report the prompt asks for). What is left is written up as a prompt in [`master-prompt-1b-remaining.md`](master-prompt-1b-remaining.md).

## Overall

All fifteen builds of [`master-prompt-1.md`](master-prompt-1.md) are implemented, tested and documented on the branch. The pull request merges into `main` as a fast-forward (no conflicts).

| Gate                                                                    | Status                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Format, lint, typecheck                                                 | Green (local and CI)                                                                           |
| Unit tests: shared 144, web 69                                          | Green (local and CI)                                                                           |
| API tests, tenant isolation and permission suites, coverage gate        | Green in CI (this environment has no MongoDB)                                                  |
| Build and bundle budget                                                 | Green: first load 162.1 KB of 170 KB                                                           |
| Security (dependency audit, gitleaks) and adapters (ClamAV, S3, Qdrant) | Green in CI                                                                                    |
| End-to-end (Playwright with axe, phone and desktop)                     | Two failures fixed on 2 November; CI on the fix is running. See "Fixed while getting CI green" |
| Load test (`pnpm loadtest`)                                             | Written, not run yet (needs the dev infrastructure; not part of CI)                            |

## What is implemented

| Build                          | Implemented                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 Feature switches            | Eleven per-college switches enforced by routes (`403 FEATURE_DISABLED`), jobs, navigation and screens; Admin › Features; a data-migration runner; a 1 KB i18n runtime                                                                                 |
| B2 Phone identity and minors   | Phone sign-up and sign-in, number change, `OtpService` with caps; encrypted phone with a blind index; minors held as `guardian_pending` until a guardian's code to the number on the college's record; guardian consent in the consent log (ADR 0010) |
| B3 WhatsApp and SMS            | Meta Cloud API and MSG91 adapters; WhatsApp as a notification channel with opt-in, weekly and monthly caps, signed quick replies and a signed webhook (ADR 0011)                                                                                      |
| B4 Invites                     | Single-use invite links (hashed tokens) by WhatsApp or CSV; class join codes with a poster and QR code                                                                                                                                                |
| B5 Mentorship loop             | 24-hour nudges, 48-hour rematches, alternatives, mentor stats, public reviews                                                                                                                                                                         |
| B6 TPO console                 | Bulk verification, onboarding progress by class with nudges, targeted and pinned announcements                                                                                                                                                        |
| B7 Placement drives            | Companies, drives, eligibility, one-tap registration, overrides, rounds and finals from sheets, offers with proof and verification, academic records, audited company exports                                                                         |
| B8 Outcomes and reports        | Higher studies, exams, ventures; seven versioned report definitions (NBA SAR, NAAC, NIRF-style, internal) with suppressed summaries and audited evidence workbooks; the principal's dashboard                                                         |
| B9 Product analytics           | First-party events; activation, weekly actives, retention, mentorship and placement tabs; the platform's cross-college traction view                                                                                                                  |
| B10 Plans and billing          | Pilot, Connect and Placement plans; entitlements; seat counts; GST invoices with PDFs; bank and Razorpay payments; reminders; read-only from 30 days overdue, never deletion (ADR 0013)                                                               |
| B11 AI cost                    | Haiku-tier answers by default; the platform's provider metered against the plan; usage by feature; `facultySeeChats` removed (ADR 0009)                                                                                                               |
| B12 Hindi                      | `hi` everywhere `SUPPORTED_LOCALES` reaches: 3,563 strings, notifications, the guardian declaration, an opt-in Hindi code SMS; `docs/adding-a-language.md`                                                                                            |
| B13 Offline and low data       | An IndexedDB copy of the member's own reads, an offline session, an outbox for three idempotent writes, data saver with resized images                                                                                                                |
| B14 Help, legal, observability | Help centre and problem reports (college and platform desks), legal pages with re-consent, `ErrorReporter`, `/client-errors`, `/metrics`                                                                                                              |
| B15 Hardening                  | Demo placement season, six-week analytics cohort, pending minor and WhatsApp log in the seed; load test scenarios; architecture, data model, threat model, security review, privacy and CLAUDE.md updates; ADRs 0012 and 0013; the final report       |

## Fixed while getting CI green

Five problems from earlier builds turned up only when the full suites ran. All are fixed on the branch:

1. **Seed:** demo consent records carried an old notice version, so every demo member would have met the notice gate.
2. **API test:** the auth suite pinned the permissions of unverified members without `support:create`, which B14 added on purpose.
3. **Erasure bug (B9):** erasing two members who opened the app on the same day failed on a duplicate key in the one-visit-a-day index. The index now covers only visits that still have a member; a regression test was added.
4. **Admin › Support** showed two page titles (the layout's and its own), which broke the help e2e spec on both projects.
5. **Offline cold start (B13):** the offline cache dropped reads that finished before the session check returned, so the college record was never saved and an offline start showed "Something went wrong". Reproduced locally with a slow session refresh, fixed, and the same repro now opens Home offline.

CI also prints Playwright's failure snapshots in the job log now, so an e2e failure can be read without downloading the artifact.

## Decisions to know about

- **D10 (stop and ask) was never triggered:** no change to session tokens, refresh rotation, tenancy enforcement or the encryption scheme; no personal data to an unlisted third party.
- **ADR numbers shifted by one** because D6 took 0009: 0010 phone identity, 0011 WhatsApp, 0012 anonymised placement records, 0013 plans and read-only.
- **Narrower than asked:** SMS carries codes only (D4 also mentions critical reminders); no WhatsApp digests (no digest feature exists); invoices and legal templates are English only.
- **Demo analytics** use 60 detached sign-ups with no accounts, so nobody fictional appears in the app.

## What is left

Two kinds of work remain. The details and the order are in [`master-prompt-1b-remaining.md`](master-prompt-1b-remaining.md).

**For the owner (registrations, reviews, decisions):**

- Merge the pull request.
- Register Meta Business, the WhatsApp number and templates, DLT, MSG91 and Razorpay, then send one live code, template and payment each.
- Have the invoice format reviewed by a chartered accountant.
- Have the minors flow, the legal texts and ADR 0012 reviewed by a lawyer.
- Have the Hindi and Telugu translations reviewed by native speakers.
- Commission a penetration test.

**For an engineer or agent (code):**

- **Fix (minor):** which consent records count as accepting the privacy notice. A Settings change to the `account` consent records the platform's base notice version, which can ask a member who already accepted the college's newer notice to accept again.
- **Run and record:** run the load test and record its figures.
- **Check:** do the 360 px, theme, reduced-motion and keyboard checks on the B12–B14 screens.
- **Build:** SMS for critical reminders, credit notes, a console editor for AI prices, and the inactive-account purge if the owner wants it promised.
- **Revisit:** the CSP's `style-src 'unsafe-inline'`.
- **Owner's call:** WhatsApp digests and Hindi invoices are optional and need the owner to decide.
