# Final report: master prompt 2 (phases G1 to G13)

**Date:** 2026-11-07. **Branch:** `feat/prompt-2-g13`, one pull request into `feat/prompt-2`. It carries G10 and G11 (`feat/prompt-2-g10`) and G12 (`feat/prompt-2-g12`, pull request #4) merged onto `feat/prompt-2` (which already held G1 to G9), the regenerated docs, and G13. The phase-by-phase record is [`progress.md`](progress.md); this report summarises it for the owner.

## Acceptance for the whole prompt

| Statement                                                                                                                                                                                                                   | Where it is shown, or why it is not met                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A student can go from "I don't know where to start" to a reviewed résumé, a practised interview, a registered drive and a conversation with an alumnus at the target company, in their language, mostly from WhatsApp links | **Met in the app; the WhatsApp leg is met in code, not yet live.** The weekly Next Step (`/next-step`, `e2e/habits.spec.ts`) names a roadmap step, an opportunity and an alumnus; the résumé builder and an alumnus's review (`e2e/resumes.spec.ts`, `test/resumes.test.ts`); a mock interview with scores and a human follow-up (`e2e/interviews.spec.ts`); registering for a drive (`e2e/placements.spec.ts`); the company page's "ask an alumnus there" and the Copilot's human next step (`e2e/companies.spec.ts`, `e2e/copilot.spec.ts`, `test/copilot.test.ts`). All screens exist in en, te and hi (`parity.test.ts`, the Telugu and Hindi captures in `after-2/`). The WhatsApp templates that carry members back (`cl_weekly_next_step`, `cl_drive_open`, `cl_micro_ask`, `cl_experience_prompt` and the rest, `docs/whatsapp-templates.md`) are tested against the console provider only: they are not registered with Meta yet (below), so "from WhatsApp links" is unverified on a real phone. |
| An alumnus can help in five minutes                                                                                                                                                                                         | **Met.** Micro-asks (`/alumni`, one alumnus at a time, accept and mark done in two taps; `test/alumni.test.ts`, `e2e/alumni.spec.ts`), a résumé review from a request card, a write-up for juniors (`/experiences/new`), and weekly office hours that repeat themselves. In the demo year 4 of 6 micro-asks per college were done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A TPO can see who needs help before a drive                                                                                                                                                                                 | **Met.** Admin › Readiness: eligible students for an upcoming drive below the college's threshold, with what would raise each score, and a nudge (once a week, never the score); minors are never listed (`test/readiness.test.ts`, `e2e/readiness.spec.ts`, captured as `tpo-admin-readiness-*` in `after-2/`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The college's placement history becomes a living graph                                                                                                                                                                      | **Met.** Company pages rebuilt nightly from verified offers, drive rounds, referrals with outcomes, alumni and mentors (`test/graph.test.ts`, `test/graph-compute.test.ts`); the demo year gives three companies per college every section above the five-record threshold (offers per batch with a median band, round pass rates, alumni, mentors, sessions, referral outcomes; `company` captures in `after-2/`); write-ups feed the interview and practice banks through their reviews; mentor outcomes feed matching.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| (If approved) employers reach consenting, ready students across colleges                                                                                                                                                    | **Met in code (ADR 0014 approved; G12 merged).** Recruiter portal, postings each college approves, pool counts, shared candidacies with a five-minute résumé link and readiness computed on read; cross-college alumni discovery and intros; verified credentials (`test/network.test.ts`, `test/employers.test.ts`, `test/credentials.test.ts`, `test/isolation/network.test.ts`, `e2e/network.spec.ts`, `e2e/recruiter.spec.ts`). Not yet: invoicing employers and paying colleges their share (hooks only), and a real DNS TXT lookup (stubbed in tests).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Every gate is green and the initial bundle is ≤ 170 KB                                                                                                                                                                      | See "Gates" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## What shipped, per phase

- **G1 AiTasksService.** One AI layer for every Prompt 2 feature: tasks with Zod-checked output and one repair turn, the per-member daily limit per feature, models by tier (fast, deep), member text through `redactPersonal()` and documents through `neutraliseInstructions()` inside numbered sources, usage recorded per feature, a fallback instead of any provider error. Spec `docs/specs/ai-tasks.md`.
- **G2 Résumés.** Up to five résumés per member (JSON Resume shape, prefilled), versioned saves, a one-column ATS-friendly PDF rendered by the worker, the ATS check (parseability and keywords against a job description or a drive), bullet rewrites that never add a number, section comments from reviewers; résumé reviews through mentorship requests; a résumé attached to a drive registration.
- **G3 Mock interviews.** HR, technical per branch or a drive's role, in en, te, hi or mixed, typed or spoken (Whisper first, audio deleted after transcription unless kept); scores with quotes, tips and follow-ups; a summary; a human mock with an alumnus in one tap; faculty review AI-written questions.
- **G4 Practice.** Aptitude and coding practice with spaced repetition, company sets, a code runner (self-hosted Judge0, off by default), faculty-reviewed items.
- **G5 Readiness.** A score as the sum of registered components with the college's weights, computed on read and never stored or shown to others; the TPO board and weekly nudges; minors never ranked.
- **G6 Alumni engagement.** Micro-asks, weekly office hours, certificates checked by code and revocable, alumni of the month, giving (money goes to the college directly; receipts numbered once), LinkedIn export import read in memory, batch pages.
- **G7 Habit loops.** The weekly Next Step (built once per member and week, sent once), peer mentors and the Senior Buddy for first-years, circles (members only everywhere), study groups, voice Q&A.
- **G8 Growth loops.** Batch invites and Campus Captains through the college's list, opt-in public pages (never contact details, exact CTC or a minor), the college outcomes page, referral outcomes, the parent digest (after the parent confirms a code).
- **G9 Reach.** A secret ICS calendar feed, scheduled roster sync (changes over 5% wait for an admin), single sign-on with Google Workspace and Microsoft Entra ID ending in the existing session and two-factor step, the Android app as a Trusted Web Activity.
- **G10 The moat data.** The Placement Graph (company pages), the Interview Experience Bank (verified authors, reviewed, moderated), outcome-proven matching (a bounded term in `scoreMatch()`).
- **G11 Career Copilot.** Cited answers from the college's own records, refusals for predictions and uncovered questions, commands (`/eligible`, `/prep`, `/mock`, `/resume`, `/plan`), at most two human next steps under every answer, and sources-only answers when no AI is available.
- **G12 The network (ADR 0014).** Employer tenants with TOTP roles, the kind boundary over every route, opt-in projections crossing colleges only through 17 named and audited paths, cross-college alumni intros, the recruiter portal, verified credentials (W3C VC 2.0, Ed25519, status list, a public verify page).
- **G13 This phase.**
  - **Merge.** G10/G11 and G12 merged onto `feat/prompt-2` with no conflicts (git reported none; GitHub's "unstable" on pull request #4 was its failing generated-doc checks). `docs/api/openapi.json`, `docs/permissions.md` and `docs/whatsapp-templates.md` regenerated; all 1,280 API tests passed on the merged tree before any G13 change.
  - **Slot markers removed:** 180 lines in 20 files (the prompt estimated about 285 in 36); one test's arrays, split only to hold markers, written out again.
  - **Carry-over gaps closed:** the core `content.experience` label in en, te and hi (the report menu no longer borrows it from the moat pack); production nginx and the staging edge now route `/{college}/verify/…`, `did.json` and the status list to the API (G12's gap), with the ALB rule noted in `docs/deployment.md`.
  - **A full demo year** in `pnpm seed` (`scripts/seed-year.ts`, below).
  - **The UI re-audit** into [`after-2/`](after-2/) (below).
  - **The YC metrics pack**, `pnpm --filter @campuslink/api metrics:yc`, defined in [`yc-metrics.md`](yc-metrics.md).
  - **The AI cost estimate** (below) and this report.

## The demo year (G13)

`pnpm seed` now adds, per demo college (all fictional, every text marked DEMO, `.example` addresses):

| What                                    | Per college                                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Members                                 | 86 ("Demo Student 27-04", "Demo Alumnus 26-11"): batches 2025 (20) and 2026 (24) as alumni, 2027 (30, final year) and 2028 (12) as students, on the college's list with academic records                    |
| Placement seasons                       | 9 drives at three demo companies over three seasons on the same calendar, 54 verified offers, round results for every registrant                                                                            |
| Mentoring                               | 15 mentors, 42 completed sessions (with feedback), 26 requests through the year (some declined or left to expire)                                                                                           |
| Referrals                               | 21, all with an outcome the student reported                                                                                                                                                                |
| Interview write-ups                     | 9 published, 1 waiting for review                                                                                                                                                                           |
| Career readiness (through the services) | 14 résumés with ATS checks (7 with an alumnus's comments), 12 mock interviews, 22 practice sets                                                                                                             |
| Alumni engagement                       | 6 micro-asks (4 done), weekly office hours with 8 subscribers, 3 certificates                                                                                                                               |
| Habit and growth                        | a batch circle with 18 members, Next Steps for every student this week, 3 peer mentors, member invites switched on with 4 invite links from the cell (CSV), the outcomes page and one placed page published |
| The network (ADR 0014)                  | alumni discovery on, 21 members opted in                                                                                                                                                                    |
| Product events                          | about 3,800 over 52 weeks: consenting adults only (two demo members withdrew the analytics consent and have none), no minors                                                                                |
| AI usage                                | the services' own runs plus the year's questions replayed from tokens measured on real Copilot and study questions (mock provider), so the AI cost below has a shape                                        |

Running `pnpm seed` twice gives the same counts in every collection (84 at DPIT, 82 at MRCE); only the mock interview token totals move by a few tokens, because their prompts hold run-specific ids. The graph and the Copilot index are built at the end of each college's seed, as the nightly jobs would.

## The YC metrics pack on the demo year

`pnpm --filter @campuslink/api metrics:yc --from 2025-11-08 --to 2026-11-07` on a fresh seed:

```text
Metric                           dpit       mrce
-------------------------------  ---------  ---------
Live in range                    yes        yes
Verified students                44         44
Verified alumni                  48         48
Verified faculty                 <5         <5
Verified placement cell          <5         <5
Verified admins                  <5         <5
Weekly active students (avg)     15         16
Invited                          <5         <5
Signed up                        144        144
Verified (of signed up)          132        132
Activated in 7 days              53         52
Activation %                     39.6       38.8
Week-4 retention %               32.7       40.4
Requests                         79         79
→ sessions %                     67.1       67.1
Median reply (hours)             14         14
Drives run                       5          5
Registration %                   48.9       48.9
Final-years (batch)              35 (2027)  35 (2027)
Offers per 100 final-years       51.4       51.4
Previous batch, same point       72         72
Change (points)                  -20.6      -20.6
AI questions per active student  4.34       4.55
WhatsApp read %                  –          –
```

The default 28-day window hides week-4 retention and the median reply (fewer than five behind them) and shows the season-to-date offers (51.4 per 100 final-years against 72.0 for the previous batch at the same date). Every figure describes the fictional demo year.

## AI cost per active student per month (estimate)

Measured on the seeded year's `AiUsage` (12 months, December 2025 to November 2026; about 465 active student-months per college, "active" meaning any product event that month), priced at the platform's default answer model, **Claude Haiku 5.5 at $0.10 per million input tokens and $0.50 per million output tokens** (prompts up to 100K tokens; Anthropic's list price as of October 2026).

| Feature           | Requests per student-month | Input tokens      | Output tokens | Cost per student-month |
| ----------------- | -------------------------- | ----------------- | ------------- | ---------------------- |
| Study assistant   | 0.65                       | 628               | 45            | $0.000085              |
| Career Copilot    | 0.66                       | 465               | 26            | $0.000059              |
| Mock interviews   | 0.16                       | 99                | 8             | $0.000014              |
| Résumé (ATS gaps) | 0.03                       | 10                | 2             | $0.000002              |
| **All features**  |                            | **≈1,280 tokens** |               | **≈$0.00016**          |

**This is an estimate, and a low one.** The mock provider counts four characters a token over the real prompts, and writes short replies (about 70 tokens), where a real answer may use up to the 700-token cap: with every Copilot and study answer at the cap, the month comes to about 2,100 tokens and **$0.0006 per active student** (about ₹0.05). Telugu and Hindi take more tokens per word with most tokenizers. The frequency (about 1.3 questions a student a month) is the demo's chosen shape, not a measurement: a student asking 20 questions a month at the cap costs about $0.01. Deep-tier calls (résumé rewrites, interview summaries) priced at a larger model would cost more; at Claude Sonnet 5.5 ($2 / $10) the same usage is 20 times dearer. Run `pnpm --filter @campuslink/api ai:smoke` with a real key, and the admin's AI dashboard with real prices, before quoting a figure.

## The UI re-audit (G13)

Results and every screenshot are in [`after-2/`](after-2/README.md): 1,152 screenshots (every Prompt 2 screen at 360 and 1440 px, light and dark, both colleges; Telugu and Hindi at 360 px), the platform console and the recruiter portal.

- **axe (WCAG 2.2 AA):** 598 scans, no violations.
- **Sideways overflow:** none, on all 155 measured screens and in Telugu and Hindi; no bottom-bar label cut off.
- **Targets:** none under 44 px on the 58 measured Prompt 2 screens (after the fixes below); Prompt 1's known patterns remain.
- **Journeys** J0 to J10 pass throttled and unthrottled; the Prompt 2 journey's steps are ready in 167 to 366 ms on the throttled phone.
- **Lighthouse:** accessibility 100 on every Prompt 2 page; performance 93 to 97 on them; Home 83 cold (56 in the first audit) with no layout shift; landing and sign-in slower than in the first audit because of the Hindi and Telugu fonts (below).
- **Per-screen JS** under 70 KB; **initial JS** 169.8 KiB of 170.

## Decisions and deviations

The full list is in `progress.md` under each phase and in ADR 0014's implementation notes. The ones the owner should know:

- **One pull request, not merges into `feat/prompt-2`.** The session's limits allowed pushing only `feat/prompt-2-g13`, so G10 to G12 are merged there and reach `feat/prompt-2` through this pull request; pull request #4 (G12) and `feat/prompt-2-g10` become redundant once it is merged.
- **E7 was not triggered:** no change to tokens, refresh rotation, tenancy enforcement or encryption, and no new third party holding personal data. G12's changes (employer roles, the scoped allowlist in the tenant plugin, a per-college signing key under the existing field cipher) were approved with ADR 0014.
- **The demo cohort is 86 accounts per college**, unlike B15's detached cohort: company pages need offers, round results and alumni tied to members, so these demo people appear in the directory, named "Demo Student" and "Demo Alumnus".
- **The year's AI usage is replayed**, not generated by calling the AI 900 times per college: each seeded question records the tokens measured on real runs of the same feature on the same day's data. It is labelled as such in the seed, `docs/privacy.md` and here.
- **Offers per 100 final-years counts offers**, as Admin › Analytics does (a student with two offers counts twice); the JSON also has students placed. The year-on-year change compares the previous batch at the same date, not its final figure.
- **Registration rate counts graduated batches too:** a drive held in the range was for a batch that may be alumni now.
- **End-to-end specs updated for the larger seed:** five checks assumed the small seed (the members and alumni lists fit one page; a company with one offer; member invites off). They now search by name, check that pay appears only as a band, and expect invites on.
- **The seed's demo invites are the placement cell's CSV links**, not members' WhatsApp invites: CI seeds without WhatsApp, where member invites refuse to send (the first CI run on the seed failed on exactly that).
- **Fixed what the re-audit found** (G13 owns the re-audit, so its findings were fixed here rather than listed):
  - Companies, the Career Copilot, Share and Campus Captain were never in the web's shipped destinations, so the account menu, the desktop rail and the command palette did not offer them (G8, G10, G11); they do now.
  - Home's weekly Next Step card (G7) loaded after Home painted and pushed the feed down (Lighthouse layout shift 0.309, was 0.089); Home's loader now preloads it, and `lazyPart` gained `preload()` and renders a preloaded part without suspending, so Home's layout shift is 0.
  - Targets under 44 px on Prompt 2 screens: the tag input's remove buttons and field, the checkbox label (Admin › Readiness rows), the quick-ask and practice look-back links (19 px tall, under WCAG's 24 px too), the Next Step card's link, the sign-in copy button and a write-up's options button.
  - "Updated 7 Nov" ran into the next sentence on company pages (a missing full stop, en, te, hi).
  - The résumé list's empty state was an `h3` directly under the screen's `h1` (Lighthouse heading order); `EmptyState` takes a `level`.
- **The audit scripts follow the demo student into her final year:** since June 2026 Ananya (batch 2027) has Placements in place of Jobs on her bar, so the journeys and the scroll-memory check tap Placements and open Jobs from the menu.

## New environment variables (Prompt 2)

All optional; `config/env.ts` refuses to boot on a malformed value.

| Variable                                      | Default    | Purpose                                                                                             |
| --------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `CODE_RUNNER`                                 | `disabled` | `judge0` turns on running code in coding practice (G4)                                              |
| `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN`             | —          | A self-hosted Judge0 on an isolated network (no internet from the sandboxes); never a public Judge0 |
| `JUDGE0_LANGUAGES`                            | built-in   | Judge0 language ids per language, if the instance numbers them differently                          |
| `ANDROID_PACKAGE_NAME`, `ANDROID_CERT_SHA256` | —          | Web build: writes `/.well-known/assetlinks.json` for the Android app (G9, `docs/android.md`)        |
| `ANDROID_SIGNATURE_HASH`                      | —          | Not read by the code: the app hash for WhatsApp's one-tap code template                             |
| `VITE_ROOT_DOMAIN`                            | —          | Web build: the bare domain, where the Android app shows the college picker                          |

`AI_DEFAULT_DEEP_MODEL` (the deep tier) and `WHISPER_URL` (voice answers and voice Q&A, E3) existed before Prompt 2 and are used by it. Single sign-on, roster sync and the network need no env: each college sets them up in Admin (the OIDC client secret and the network signing key are stored encrypted with the field cipher).

## External registrations and set-up

1. **Play Console** (G9): the app `in.campuslink.app` with Play App Signing, its SHA-256 fingerprint as `ANDROID_CERT_SHA256`, store listing, data safety and target audience answers, internal testing on a real phone (no address bar = asset links right). Steps in `docs/android.md`.
2. **An OIDC app per college** (G9): a Google Workspace OAuth client or a Microsoft Entra ID app registration for each college that wants single sign-on, with the redirect URI shown in Admin › Sign-in and the college's email domains. `docs/specs/reach.md`.
3. **Judge0** (G4), only if coding practice should run code: self-hosted on an isolated network; otherwise coding items show a model answer and tests.
4. **Meta WhatsApp templates**, in en, te and hi, from `docs/whatsapp-templates.md`: the Prompt 2 utility templates `cl_weekly_next_step`, `cl_micro_ask`, `cl_readiness_nudge`, `cl_parent_digest` and **`cl_experience_prompt`** (and any earlier ones not yet registered), and the authentication template's one-tap button with the package name and `ANDROID_SIGNATURE_HASH` once the Android app is live.
5. **LinkedIn export instructions for members** (G6), for your help article or an announcement: in LinkedIn, Settings & Privacy › Data privacy › Get a copy of your data, choose the Profile and Positions files (or the full archive), and wait for LinkedIn's email; then on `/alumni` › LinkedIn import, upload the ZIP or one of its CSV files. It is read in memory and never stored; only what the member confirms is saved. The screen says this briefly in three languages; check LinkedIn's menu names before sending, as they change.
6. **DNS for the network** (G12): nothing for the platform; each employer adds the TXT record its application shows. Production nginx and the staging edge already route the credential pages; an ALB needs the rule in `docs/deployment.md`.

## What you should verify yourself

- **A native-speaker review of Hindi and Telugu**: every Prompt 2 pack (`career`, `practice`, `readiness`, `alumni`, `habits`, `share`, `reach`, `moat`, `copilot`, `network`), the notification and WhatsApp texts, and the legal texts still waiting from prompt 1b (`docs/build/translation-review.md`). The Telugu and Hindi screens in `after-2/` show where long words wrap.
- **A legal review of public pages** (G8: placed, roadmap, mentored and mentor pages, the college outcomes page) and the network (G12: the employer terms, the network terms each college accepts, the consent texts, the credentials).
- **Giving** (G6): money goes to the college's own account; check the receipt wording and 80G language with the college's accountant before turning it on.
- **The network with a real employer**: a real DNS TXT check, a real posting through two colleges' approval, and invoicing (hooks only today).
- **A low-end Android phone over 3G**: install the Play internal test build and walk the student journey; the Lighthouse runs in `after-2/` simulate it (4× CPU, slow 4G) but are no substitute.
- **Real AI**: one `ai:smoke` run with the production key, then the AI cost above against the admin dashboard after a month.

## Known gaps

- **WhatsApp templates are not registered with Meta**, so every WhatsApp path (including the new `cl_experience_prompt`) is tested against the console provider only; one-tap code autofill needs the Android handshake patch (`docs/android.md`, not built).
- **Employer invoicing and colleges' revenue share** are configuration and hooks only (G12).
- **The DNS TXT lookup** for employer domains is stubbed in tests and has not been run against a real domain.
- **Translated legal texts** stay unpublished until the native-speaker review (prompt 1b R13).
- **No real AI provider** was called in Prompt 2; every AI path was tested with the mock provider and injection traps.
- **From earlier phases** (`security-review.md` › Gaps): `style-src 'unsafe-inline'` in the CSP and no external penetration test.
- **The initial bundle is at 169.8 KiB of 170 KiB**: the next screen-shell change must be paid for elsewhere.
- **Prompt 1 screens with targets under 44 px** (unchanged from the earlier audits, WCAG 2.5.8's 24 px met): member-name links on Home and a job (24 px), job titles in the jobs list (39 px), the roadmap review queue and others listed in `after-2/data-after/touch-targets-360.json`. The demo year's larger lists show more of the same links.
- **The English landing and sign-in pages download the Devanagari (253 KiB) and Telugu (138 KiB) fonts** for the language switcher's native names (since B12), so their largest paint is slower than in the first audit (landing 3.7 → 5.8 s under simulated throttling). Showing those two names in the system font would fix it.
- **`pnpm audit` (all dependencies)** reports 5 low or moderate advisories in build and export tooling (glob and minimatch through eslint, workbox and write-excel-file's archiver; deepmerge through workbox); the gate (`--prod --audit-level=high`) is clean. No dependency changed in Prompt 2's G13.

## Gates

| Gate                                                                            | Result                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                              | Pass (locally and in CI)                                                                                                                                                                      |
| `pnpm test`                                                                     | Pass: shared 180, web 97, API 1,292 (112 files, 6 skipped); the tenant-isolation and permission suites pass                                                                                   |
| API coverage gate (`vitest run --coverage`)                                     | Pass (security-critical modules at or above their thresholds)                                                                                                                                 |
| `pnpm build` and the web budget                                                 | Pass: initial JS 169.8 KiB of 170 KiB gzip; every screen under 70 KB                                                                                                                          |
| `pnpm test:e2e` (Playwright and axe, phone and desktop)                         | Pass locally on the final code: 232 passed, 16 skipped, 0 failed                                                                                                                              |
| `pnpm audit --prod --audit-level=high`                                          | Clean (5 low or moderate advisories in build and export tooling, see Known gaps)                                                                                                              |
| gitleaks v8.30.1                                                                | Clean in CI's security job (the image could not be pulled in this build environment)                                                                                                          |
| CI on the pull request ([#5](https://github.com/Parthu-work/campuslink/pull/5)) | Green on `0c6cb3f`: verify (format, lint, typecheck, tests, isolation and permission suites, coverage, build, budget), e2e, adapters and security, on both the push and the pull request runs |
| UI re-audit                                                                     | [`after-2/`](after-2/README.md): 598 axe scans with no violations, no overflow, no target under 44 px on Prompt 2 screens, journeys pass                                                      |

## Next

1. Merge this pull request into `feat/prompt-2`, then `feat/prompt-2` into `main` (and close pull request #4 and `feat/prompt-2-g10` as merged through it).
2. Register the WhatsApp templates and the Play Console app; run the live checks above.
3. Book the native-speaker and legal reviews.
4. Run a pilot with one real college and read `metrics:yc` after four weeks.
