# Progress: prompt 3 (fix the open issues, rebuild the user experience)

One section per phase: what shipped, decisions, gaps and gate results. The brief is `master-prompt-3.md`; current facts are in `facts-3.md`.

## Step 0 · Set up

**Shipped.** CI on `feat/prompt-2` at `094acfc` was green (run [42376797059](https://github.com/Parthu-work/campuslink/actions/runs/42376797059)). The session's working branch `claude/vigilant-lamport-rdkzex` was fast-forwarded from `0083f90` to `094acfc` and every commit of this prompt is pushed there. The prompt is saved verbatim in `master-prompt-3.md` (kept out of Prettier); this file and `facts-3.md` exist; the "before" set was captured from a separate worktree at `094acfc` before any UI changed (U0).

**Decisions.**

- **Branch.** The brief says to work on `main` without pull requests; this cloud session is restricted to its designated branch, so the work is on `claude/vigilant-lamport-rdkzex` and `main` is untouched (still `0083f90`). Fast-forwarding `main` to this branch is the owner's call (it is a fast-forward of `094acfc` plus this prompt's commits).
- **Order.** The owner asked to start with U0 and U1. Part F (F1–F8) is not done yet; the one overlap, F6 (bundle headroom), is U0.3 and is reported there.

**Gaps.** Step 0.2 (ADR 0014 approval) is asked of the owner and not yet answered; nothing in U0 or U1 touches network, employer or credential code, so nothing waits on it yet.

## U0 · Baseline and headroom

### 1. Before set

`docs/build/before-3/`, captured with the audit scripts from a clean worktree at `094acfc` (`AUDIT_OUT=docs/build/before-3`): `after/` holds 1,152 screenshots (every role and screen, 360 and 1440, light and dark, DPIT and MRCE; Telugu and Hindi at 360), and `data-after/` the axe, target, overflow, journey, extras and Lighthouse results (see the run log at the end of this section for which scripts completed).

### 2. Tap counts (before)

Counted by walking each task through the current screens (code and the before set), from a cold start of the installed app, a phone, English. Typing into a field counts as one field, not as taps; a tap that only focuses a field is not counted. These are walk-through counts; U13 measures the same tasks in the browser with the journeys audit.

| Task                                              | Taps | Fields | Path today                                                                                                                                                                                    |
| ------------------------------------------------- | ---: | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) New student signs up and is verified          |    7 |      8 | Landing "Join with your college email" → sign-up (method, role, name, phone, birth month and year, consents pre-ticked) → code → Verify (roll number, batch) → code from the college's record |
| (b) Student asks an alumnus for a mock interview  |    7 |      2 | Mentors tab → card → profile → Request → session type → goal → slot → Send                                                                                                                    |
| (c) Student registers for an eligible drive       |    4 |      0 | Placements tab (final years) → drive → Register → confirm in the sheet (drives with questions add their fields)                                                                               |
| (d) Student marks the next roadmap step done      |    4 |      0 | Roadmaps tab → followed roadmap → step → Mark done                                                                                                                                            |
| (e) Student asks the assistant and opens a source |    5 |      1 | Menu or palette → Study assistant → subject → question → Send → citation                                                                                                                      |
| (f) TPO sees who has not joined and nudges them   |    4 |      0 | Admin tab → "Not joined yet" tile → select → Nudge                                                                                                                                            |
| (g) Alumnus accepts a request from WhatsApp       |    1 |      0 | The template's Accept quick reply (a verified token from the member's own number); 3 taps when it opens the app instead                                                                       |

### 3. Initial JS (F6)

|                                                                       |       Initial JS (gzip) |
| --------------------------------------------------------------------- | ----------------------: |
| Before (`094acfc`)                                                    |                169.8 KB |
| After U0's changes                                                    | 159.7 KB (**−10.1 KB**) |
| After U1 (primitives added, `PageHeader` moved into the initial load) |                160.5 KB |

What moved, measured with the build's source maps (gzip of each module's code in the entry chunk):

- **tailwind-merge (8.6 KB) → `lib/cn.ts`** (−5.7 KB net). An in-house merge that knows our groups and the type scale. `cn.test.ts` checks it against tailwind-merge (kept as a dev dependency) over every pair of real classes in `src/` (tokens Tailwind's own compiler turns into rules): identical results, with one documented deliberate difference (`bg-gradient-to-*` is an image in Tailwind 4, so it no longer drops a background colour). A class it does not know is never dropped.
- **Palette generator (2.5 KB) → the API** (−2.3 KB). `PublicTenant.palette` carries the college's tokens, computed once per colour pair (`tenantPalette()`, memoised); `applyBranding()` only writes them. The branding screen still previews locally. A tenant saved by an older version (the offline copy) has no palette; the default stays until the next read. New test `apps/api/test/tenant-palette.test.ts`.
- **lucide runtime and keys → `lib/icon-factory.ts`** (−2.1 KB, and every screen's icons shrink too). The Vite plugin `lucide-icons.ts` points lucide's icon modules at our factory and removes the random React key from each path; the factory draws ADR 0015's 1.75 stroke by default.

Per file:

| File                  | Before (KB) | After (KB) |
| --------------------- | ----------: | ---------: |
| index (entry)         |       125.1 |      116.7 |
| hooks                 |        23.0 |       23.0 |
| useQuery              |         3.0 |        3.0 |
| react (react package) |         3.0 |        3.0 |
| removable             |         2.7 |        2.7 |
| query                 |         2.7 |        2.7 |
| api                   |         2.3 |        2.3 |
| createLucideIcon      |         1.5 |          – |
| i18n                  |         1.1 |        1.2 |
| preferences           |         0.8 |        0.8 |
| preload-helper        |         0.8 |        0.8 |
| offline-rules         |         0.7 |        0.7 |
| core                  |         0.6 |        0.6 |
| react (shim)          |         0.4 |        0.4 |
| rolldown-runtime      |         0.4 |        0.4 |
| jsx-runtime           |         0.3 |        0.3 |
| QueryClientProvider   |         0.3 |        0.3 |
| clsx                  |         0.3 |        0.3 |
| locales               |         0.3 |        0.3 |
| storage               |         0.2 |        0.2 |
| bot-check-config      |         0.2 |        0.2 |
| queryOptions          |         0.1 |        0.1 |
| offline               |         0.1 |        0.1 |
| icon-factory          |           – |        0.5 |
| **Total**             |   **169.8** |  **160.5** |

**Measured and not taken.** `cmdk`, `sonner`, `motion`, Radix and the locale packs were already outside the initial load. The admin, platform-console and recruiter route tables would save 1.3 KB through `patchRoutesOnNavigation` but put deep links and intent preloading at risk the week U2 rebuilds navigation; deferred to U2. The nav icon map (about 4 KB of icons, 44 destinations) is needed by today's desktop rail, which is icon-only below 1280 px; U2's five-space sidebar needs about ten.

**Gap.** U0.3 asks for at least 15 KB before Part U; U0 freed **10.1 KB**. The remaining ~5 KB comes with U2 (nav icons and route split, both measured above); U2 reports it. The budget stays honest: nothing moved into a chunk that every screen loads, and `PageHeader` moved _into_ the initial load (it is on every screen), which raised the initial figure by its own size.

### Gate results

See the end of this file (one run for U0 and U1, which ship together).

## U1 · Design language v2 and primitives

**Shipped.**

- ADR 0015 (`docs/adr/0015-design-language-v2.md`) with the token table and five before/after pairs (`docs/design/v2/u1/`); design doc `docs/design/v2/u1.md`.
- Tokens: six fluid type steps (12.5 px floor, +15% by 1280, +2 px line height for Telugu and Devanagari), 4 px space with 16/24/32 gutters and reading/content widths, three radii, flat cards (shadows only on floating layers), a sunken surface and a truer dark, press/enter/sheet durations with standard and emphasised easing, compact density. The old type names were renamed in one codemod across 181 files and are now rejected by lint.
- `eyebrow` is sentence case in the UI face (A5, everywhere at once); `table-label` keeps tiny capitals for staff tables.
- Status inks hold 5.5:1 on every college's surfaces (generated against the hue wheel; tested with the eight awkward colleges).
- Primitives: `Button` v2, `ListRow`/`ListSection`, `PageHeader` v2 (about sheet, overflow, compact bar; A6 fixed on every screen that passed `intro`), `Toolbar`, `OverflowMenu`, `EmptyState` v2, skeleton variants, `ActionCard`, `PersonCard`, `Countdown`, `StepTrack`, `ScoreRing` v2, `Timeline`, `Kbd`, `toast.undo()`. All in the style guide (both themes, Telugu and Hindi, compact density) and in `primitives.a11y.test.tsx`.
- Strings: `ui.*` in en, te and hi (`translation-review.md`); the style guide's strings moved to a `design` pack so they no longer ship in every language.
- CLAUDE.md › Coding conventions updated.

**Decisions.**

- Old radius names stay and map onto the three values, so their 288 usages did not need a codemod; new code uses sm (8), md (12), xl (20).
- `PageHeader` keeps `intro` and `icon` as deprecated props (intro goes to the sheet, icon is not drawn), so every screen adopts v2 without edits; screens move to `about`, `primary` and `overflow` as they are rebuilt.
- The sheets behind "About this" and "More actions", and the phone compact bar, load on first use (they kept Home and Settings within the 70 KB per-screen budget).
- The not-found screen now has a real h1 (`PageHeader`) and a primary "Go home".

**Gaps.** Screens are not rebuilt yet (U2–U9); they use the new tokens with their old layouts, so A1–A4, A7 and the rest remain until their phases. Per-phase screenshots at 360/1440 × themes × languages for U1 are of the style guide only (screens are captured in their own phases). Before/after pairs come from the style guide, not from live screens.

## Gate results (U0 and U1)

Local, on this branch's head (interim; updated when the remaining runs finish):

| Gate                                                     | Result                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| \`pnpm format:check\`, \`pnpm lint\`, \`pnpm typecheck\` | Pass                                                                                      |
| Shared tests                                             | 191 passed (was 180)                                                                      |
| Web tests                                                | 132 passed (was 97): \`cn.test.ts\`, \`tokens.test.ts\`, \`primitives.a11y.test.tsx\` new |
| \`pnpm build\` and bundle budget                         | Pass: initial 160.5 KB of 170; largest screens Settings 69.0, Home 68.4                   |
| Secret scan (gitleaks v8.30.1)                           | No leaks                                                                                  |
| API tests with coverage                                  | Running                                                                                   |
| End-to-end                                               | Not yet run (the ports were busy with the before-set capture)                             |
