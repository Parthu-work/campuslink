# Before set for prompt 3 (U0)

Captured on 7 November 2026 from a clean worktree at `094acfc` (the tree CI ran green), before any UI change in prompt 3, with the audit scripts in `apps/web/e2e/audit/` and `AUDIT_OUT=docs/build/before-3`:

```bash
pnpm --filter @campuslink/web audit:capture
pnpm --filter @campuslink/web audit:journeys -g "journeys, throttled"
pnpm --filter @campuslink/web audit:journeys -g "journeys, unthrottled"
pnpm --filter @campuslink/web audit:extras
pnpm --filter @campuslink/web audit:lighthouse
```

Each run reseeds the end-to-end database. Screenshots are re-encoded as palette PNGs (quality 90). `extras` and `lighthouse` were run a second time after MongoDB crashed under a parallel API test run; the rows here are from the clean second run.

## What is here

- **`after/`** (the scripts' folder name): 1,152 screenshots, `<role>-<screen>-<width>-<theme>-<college>.png`, at 360 × 780 (touch, DPR 2) and 1440 × 900, light and dark, DPIT and MRCE, every role; Telugu and Hindi at 360 px (light, DPIT). Same set as `docs/build/after-2/`.
- **`data-after/`**: `axe.json` and `axe-summary.json`, `touch-targets-360.json`, `capture-failures.json`, `journeys.json` and `journeys-unthrottled.json`, `telugu.json`, `hindi.json`, `scroll-memory.json`, `offline.json`, `desktop-rail.json`, and `lighthouse/` (one gzipped report per page and `lighthouse-summary.json`).

## Headline numbers

- axe (WCAG 2.2 AA): 598 scans, no violations.
- Targets under 44 px that WCAG does not exempt: 90 on 23 of 134 measured screens (`touch-targets-360.json`; F4 raises them). No sideways overflow at 360 px.

### Lighthouse (mobile emulation, simulated throttling, DPIT)

| Page              | Performance | Accessibility |   LCP |      TBT |   CLS |
| ----------------- | ----------: | ------------: | ----: | -------: | ----: |
| home-cold         |          71 |           100 | 3.9 s |   610 ms |     0 |
| mentors-cold      |          67 |           100 | 3.2 s | 1,490 ms | 0.004 |
| jobs-cold         |          73 |           100 | 2.8 s | 1,000 ms |     0 |
| roadmaps-cold     |          85 |           100 | 2.6 s |   470 ms |     0 |
| study-cold        |          96 |           100 | 2.5 s |   140 ms |     0 |
| companies-cold    |          97 |           100 | 2.5 s |   110 ms |     0 |
| copilot-cold      |          97 |           100 | 2.4 s |   110 ms | 0.026 |
| resume-cold       |          95 |           100 | 2.3 s |   180 ms |     0 |
| practice-cold     |          93 |           100 | 2.5 s |   220 ms |     0 |
| readiness-cold    |          94 |           100 | 2.3 s |   230 ms |     0 |
| profile-edit-cold |          95 |           100 | 2.3 s |   180 ms |     0 |
| profile-view-cold |          97 |           100 | 2.4 s |   100 ms |     0 |
| home-warm         |          90 |           100 | 1.2 s |   420 ms |     0 |
| jobs-warm         |          94 |           100 | 1.1 s |   290 ms |     0 |
| landing           |          74 |           100 | 6.0 s |     0 ms |     0 |
| sign-in           |          79 |           100 | 4.6 s |    70 ms |     0 |

These were measured in a shared cloud container, so absolute times run slower than the G13 run in `after-2/` (home-cold LCP 3.9 s here against 3.2 s there, on the same code). Compare prompt 3's "after" run (U13) against this file, measured the same way, not against `after-2/`.
