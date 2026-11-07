# UI re-audit after Prompt 2 (G13)

Every screen captured on a freshly seeded demo year (`pnpm seed`, both demo colleges), with the audit scripts in `apps/web/e2e/audit/` run with `AUDIT_OUT=../../docs/build/after-2`:

```bash
pnpm --filter @campuslink/web audit:capture
pnpm --filter @campuslink/web audit:journeys -g "journeys, throttled"
pnpm --filter @campuslink/web audit:journeys -g "journeys, unthrottled"
pnpm --filter @campuslink/web audit:extras
pnpm --filter @campuslink/web audit:lighthouse
```

(set `PW_CHROMIUM_PATH` to use a preinstalled Chromium; each run reseeds the end-to-end database, so the two journey runs go one at a time). Screenshots are re-encoded as palette PNGs (quality 90) to keep the folder small.

## What was captured

- **`after/`**: 1,152 screenshots, `<role>-<screen>-<width>-<theme>-<college>.png`, at 360 × 780 (touch, DPR 2) and 1440 × 900, in light and dark, on DPIT and MRCE, for the public pages, a student (Ananya, batch 2027), a demo final-year with a résumé, a mock interview, a practice set, a circle and Copilot history (`finalyear`), an alumnus, a contributor, faculty, the placement cell, the college admin, an unverified member, the platform console and the demo employer's recruiter portal. Every Prompt 2 screen is in it: `/placements`, `/resume` and the editor, `/interviews` and a session, `/practice`, `/readiness`, `/next-step`, `/peers`, `/circles` and a circle, `/study-groups`, `/share`, `/companies` and a company page, `/experiences` and `/experiences/new`, `/copilot`, `/network`, `/alumni`, a batch page, Admin › Interview questions, Practice bank, Readiness, Interview write-ups, Circles, Peers, Recognition, Giving, Growth, Onboarding, Sign-in, Network, Placement drives and Offers, Platform › Employers and Traction, and `/recruiter`.
- **Telugu and Hindi**: 18 screens each at 360 px (light, DPIT), `student-<screen>-te-360-light-dpit.png` and `-hi-`.
- **`data-after/`**: `axe.json` and `axe-summary.json` (every 360 px screen and both languages), `touch-targets-360.json` (targets under 44 px that WCAG does not exempt, type sizes and sideways overflow, DPIT light), `capture-failures.json`, `journeys.json` and `journeys-unthrottled.json`, `telugu.json` and `hindi.json`, `scroll-memory.json`, `offline.json`, `desktop-rail.json`, and `lighthouse/` (one gzipped report per run and `lighthouse-summary.json`).

## Results

| Check                                             | Result                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe (WCAG 2.2 AA), every 360 px screen, te, hi    | 598 scans, no violations                                                                                                                                                                                                                                                                                                                        |
| Sideways overflow (360 px)                        | None on any of the 155 measured screens; none in Telugu or Hindi either, and no bottom-bar label cut off                                                                                                                                                                                                                                        |
| Targets under 44 px on Prompt 2 screens           | None (58 screens measured) after the fixes below                                                                                                                                                                                                                                                                                                |
| Targets under 44 px elsewhere                     | Unchanged Prompt 1 patterns, all at least 24 px (WCAG 2.5.8): member-name links on Home and a job, job titles in the jobs list (39 px), the roadmap review queue, the auth pages' text links and others listed in `touch-targets-360.json`; the demo year's longer lists show more of the same links                                            |
| Per-screen JS (≤ 70 KB) and initial JS (≤ 170 KB) | Initial 169.8 KiB gzip; the largest screens are under 70 KB (`pnpm --filter @campuslink/web budget`)                                                                                                                                                                                                                                            |
| Journeys (throttled 4× CPU, 1.6 Mbps)             | J0 to J10 pass with no step errors and no shell remount after the cold start; the Prompt 2 journey (J10: Companies, Career Copilot, Résumé, Practice from the menu, a company page and Back) is ready in 167 to 366 ms per step (25 to 74 ms unthrottled); the only spinner frames are the "send request" button's own, as in the earlier audit |
| Scroll memory and bars                            | Home's position comes back exactly after a tab round trip; Placements remembers its detail page; tapping the active tab goes to the top                                                                                                                                                                                                         |
| Offline, desktop rail                             | The service worker controls the page and an unvisited screen says it is offline; every rail item is reachable at 1440 × 900 and 1280 × 720                                                                                                                                                                                                      |

### Lighthouse (mobile emulation, simulated throttling, DPIT)

| Page              | Performance (first audit → now) | Accessibility | Best practices | CLS   | LCP   | TBT    |
| ----------------- | ------------------------------- | ------------- | -------------- | ----- | ----- | ------ |
| home-cold         | 56 → 83                         | 100           | 100            | 0     | 3.2 s | 420 ms |
| mentors-cold      | 62 → 89                         | 100           | 100            | 0.004 | 2.9 s | 290 ms |
| jobs-cold         | 58 → 87                         | 100           | 100            | 0     | 2.8 s | 350 ms |
| roadmaps-cold     | 68 → 95                         | 100           | 100            | 0     | 2.6 s | 140 ms |
| study-cold        | 70 → 94                         | 100           | 100            | 0     | 2.3 s | 220 ms |
| companies-cold    | 94                              | 100           | 100            | 0     | 2.4 s | 190 ms |
| copilot-cold      | 96                              | 100           | 100            | 0     | 2.4 s | 150 ms |
| resume-cold       | 97                              | 100           | 96             | 0     | 2.3 s | 140 ms |
| practice-cold     | 96                              | 100           | 100            | 0     | 2.4 s | 160 ms |
| readiness-cold    | 93                              | 100           | 96             | 0     | 2.3 s | 250 ms |
| profile-edit-cold | 74 → 93                         | 100           | 100            | 0     | 2.3 s | 240 ms |
| profile-view-cold | 63 → 95                         | 100           | 96             | 0     | 2.4 s | 190 ms |
| home-warm         | 81 → 93                         | 100           | 100            | 0     | 1.1 s | 310 ms |
| jobs-warm         | 93 → 86                         | 100           | 100            | 0     | 1.2 s | 550 ms |
| landing           | 87 → 75                         | 100           | 100            | 0     | 5.8 s | 30 ms  |
| sign-in           | 86 → 79                         | 100           | 96             | 0     | 4.6 s | 50 ms  |

Best practices 96 on a few pages: a Content Security Policy issue (the `style-src` gap recorded in prompt 1b, R10) and a 404 on the profile view. The first audit's figures are in `docs/design/revamp/data-after/lighthouse/`.

## Fixed because of this audit

- Companies, the Career Copilot, Share and Campus Captain were missing from the account menu, the desktop rail and the command palette (their ids were never in the web's shipped destinations).
- Home's weekly Next Step card arrived after Home painted and pushed the feed down (Lighthouse layout shift 0.309). Home's loader now preloads it and `lazyPart` renders a preloaded part without suspending.
- 44 px targets: the tag input's remove buttons and field, checkbox labels whose text is for screen readers only (Admin › Readiness), the quick-ask and practice look-back links and the Next Step card's link (all 19 px tall before), the sign-in copy button and a write-up's options button.
- The résumé list's empty state was an `h3` directly under the screen's `h1` (heading order).
- "Updated 7 Nov" ran into the next sentence on company pages (en, te, hi).

## Not fixed here

- **The English landing and sign-in pages download the Devanagari (253 KiB) and Telugu (138 KiB) fonts** for the language switcher's native names, so their largest paint is slower than in the first audit (landing 3.7 s then, 5.8 s now, under simulated throttling). This came with Hindi (prompt 1, B12), not Prompt 2. A fix: show those two names in the system font, or load the scripts' fonts only once that language is chosen.
- The Prompt 1 target patterns above.
