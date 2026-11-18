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

`docs/build/before-3/`, captured with the audit scripts from a clean worktree at `094acfc` (`AUDIT_OUT=docs/build/before-3`): `after/` holds 1,152 screenshots (every role and screen, 360 and 1440, light and dark, DPIT and MRCE; Telugu and Hindi at 360), and `data-after/` the axe, target, overflow, journey, extras and Lighthouse results All five scripts completed (details and Lighthouse table in `before-3/README.md`): axe 598 scans with no violations; 90 targets under 44 px on 23 screens; Lighthouse home-cold LCP 3.9 s, landing 6.0 s, sign-in 4.6 s in this container.

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

## U2 · Information architecture and navigation

**Shipped.**

- **Five spaces per persona**, in `buildNav()` only (`PERSONA_SPACES`, `NavSpace`, `spaceOf()`, `landingPath()`, `sidebarEntries()` in `packages/shared/src/navigation.ts`): student Home · Learn · Mentors · Career · You; alumnus Home · Mentoring · Jobs · Community · You; staff and college admin Today · Students · Placements · Content · College; the platform and employer consoles keep theirs. Every destination and every admin section is a section of exactly one space per persona (a unit test lists the ones missing). Permissions and feature switches remove sections, and a space left with none is removed with its tab. An unverified member keeps all five spaces; what waits for verification is listed with "Opens after you verify" and opens the existing "verify first" screen.
- **Where a member starts**: final-year students in Career (on Placements), first-years in Learn, everyone else in their first space (staff in Today, on the admin overview until U9 builds the queue). Sign-in and the app's root go through `/start`, which waits for the member so it never shows the wrong first screen; a deep link still wins.
- **The lit tab is the owner**, not the last tab pressed: `useSpaceMemory` (`lib/tab-memory.ts`) asks `spaceOf()` (longest section path, then a space's own screen, then `NAV_ALSO` for screens such as a post or an interview write-up), and a screen no space owns (a legal page) keeps the last one lit without being remembered as its screen. Each space still remembers where it was left; tapping the lit tab returns to its first screen.
- **Phone**: five bottom tabs with full labels (no truncation class at all; an e2e test measures every label at 360 px in en, te and hi), the open space's sections in a scrolling row under the top bar with the current one marked, and spaces that open on a list (You, Students, Content, College) give their sections a Back to it. **Desktop**: one sidebar with Create, Search and the five spaces (seven entries at most, tested); the open space lists up to six sections, then "All in …", so it never scrolls (tested at 1440 × 900, 1280 × 720 and 1024 × 768); breadcrumbs (space › section) below a section's first screen. The admin area's second column is gone: its sections are the staff spaces' sections.
- **One inbox**: one bell in the top bar with one count (unread notifications plus unread conversations); Notifications and Messages stay two screens with a switch at the top of both.
- **Create** leaves the tab bar: the sidebar's first button on desktop, a floating button on Home only on phones, and each screen's own primary action elsewhere.
- **Search** (the command palette, still loaded after the first screen): people, companies, placement drives, roadmaps, subjects, events, jobs, posts and questions; every section of the member's spaces; what they can create; and, before anything is typed, the last six things opened from it. Recent items are kept for the browser tab only (`sessionStorage`) and cleared at sign-out, because they hold names.
- **Account**: the avatar sheet (phones) and menu (desktop) now hold only the person's own things: profile, settings, help, sign out.
- Strings: `nav.spaces.*`, the inbox, "All in …", breadcrumbs and the search groups in en, te and hi (`translation-review.md` › U2). `CLAUDE.md` › Web navigation updated.

**Decisions.**

- Nav icons: the shell draws only the five spaces' icons; the map of every destination's icon (`lib/nav-icons.ts`) loads with the account sheet, the palette and the space screens. The post menu loads on first use again (it had come back into Home with the merge of U1), which keeps Home under its 70 KB screen budget with the new shell.
- The admin overview is Today's first section until U9 replaces it with the work queue; its section list stays as the phone overview.
- "Home" appears twice on desktop when Home is open (the space and its first section, the feed). Both lead to the same screen; the section row is where "you are here" is marked.

**Numbers.**

|                                               | Before U2                                     | After U2                            |
| --------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| Top-level entries in the admin's desktop rail | 39 (and a second column)                      | 7 (Create, Search, five spaces)     |
| Bottom tabs                                   | 5 with Create in the middle, labels truncated | 5 spaces, full labels in en, te, hi |
| Initial JS (gzip)                             | 160.5 KB                                      | 161.0 KB                            |

**Gaps.** The U0.2 tap counts were not re-run for U2 (the script needs a full reseed and its paths walk the old tabs; U13 re-runs them). F6's remaining ~5 KB is not freed: the route tables for admin, platform and recruiter were not split, because U2 changed every route's place in the shell and that split is safer measured on its own.

### Gate results (U2)

| Gate                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                                                | Pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shared tests                                                                                                      | 203 passed (10 new: the spaces per persona, ownership, landing, the sidebar limit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Web tests                                                                                                         | 132 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm build` and bundle budget                                                                                    | Pass: initial 161.0 KB of 170; every screen under 70 KB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| End-to-end (local, the specs U2 touches: shell, navigation, spaces, accessibility, resilience; phone and desktop) | First run 59 passed, 11 failed: three were real (focus stayed on the main region after the start redirect; a screen-reader-only count in the section row widened the page at 320 px; the start page could render before the member loaded) and are fixed; the rest were the new tests' own mistakes (a translated navigation name, a timing race, a circle list that was empty for that member). Re-run: all of them pass; the admin and platform cases need a fresh seed for their two-factor secrets and passed in the first run. The whole suite runs in CI |
| API tests                                                                                                         | No API code changed in U2; CI runs the suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Secret scan (gitleaks v8.30.1)                                                                                    | No leaks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### U2 follow-up: CI's end-to-end run

CI cancelled the U2 push's end-to-end job at its 35-minute limit: 18 staff journeys failed (each waiting out its 30 s timeout, then retrying). The cause was the tests' sign-in helper, which taps a Home tab that staff no longer have; staff now open Home directly, students and alumni still tap their tab. Two admin tests went back to the overview through the old admin menu; they now use the Today tab. The admin overview lists every section on desktop too (the side menu it relied on is gone). A full local run then passed 239 of 264, with one Windows-only failure left (the calendar-feed test resolves `mrce.localhost` outside the browser, which Windows cannot; it passes in CI).

## U3a · Career paths, the student side

**Shipped.**

- **Career paths** (`features/roadmaps/paths.tsx`, replacing the Galaxy): Continue cards for the paths a member follows (the next step as the title, "Step 3 of 10 · about 2 weeks at your pace", a progress ring, Continue straight into that step); "For {branch}" from the member's profile (a sideways row on phones, a grid from tablet width); every path by category in list sections, with search, category chips and the branch in the Toolbar. `/me` now carries the member's branch.
- **The journey** (`roadmap-page.tsx` split into `path-header.tsx`, `journey.tsx`, `step-sheet.tsx`; the graph moved to `graph-view.tsx`, loaded only when the Map is chosen): the header has one action (Start this path, or Continue to the next step), "For roles like …" from the outcomes, progress with the next step's name, and the pace line; history, edit and stop following are in the overflow, and sources, branches, review date and the disclaimer in "About this". Steps are a `StepTrack` in 3–6 phases; finished phases fold away so the next steps are near the top on a phone.
- **Phases** (`journeyPhases()` in `packages/shared/src/constants/roadmaps.ts`, 12 unit tests): steps sorted by depth in the prerequisite graph, cut into three to six phases at the points closest to equal time (preferring cuts between depths), named by position (Foundations … Get interview-ready, or Get exam-ready). `nextStep()` (the same rule everywhere: the journey, the list, Home's weekly Next Step) and `timeAtPace()` live beside it.
- **The step sheet** (`?step=`): kind and time at the member's pace, "What and why", "How you'll know you're done" (the proof, one item per line or clause), resources and sources as link rows (site, opens in a new tab), comments for authors and reviewers, and a footer with Mark done (celebration, then an Undo toast) and Next step.
- **Pace in hours** (API): the weekly goal is hours a week (0–40) instead of steps a week; a goal saved the old way reads as the hours those steps take on average in that path (no migration needed, and a member's new pace replaces it). The weekly nudge compares the likely hours of the steps done in the last seven days with the pace. List items carry the published version's first outcome, its total hours and, for a follower, the next step and pace. Start follows without a goal, so nobody is nudged until they choose a pace.
- **Removed**: the Galaxy (`galaxy.tsx`, `galaxy-canvas.tsx`, `layoutGalaxy`) and 15 strings only it and the old goal card used. `ListRow` gained `href` for links to other sites.
- Strings: `roadmaps.*` for the index, header, pace, phases, times and the step sheet in en, te and hi ("Mark as done" is now "Mark done").

**Decisions.**

- **The Galaxy is deleted, not kept as a "Map" of paths.** It failed U1 on every count the brief lists (dark only, labels of 11–12 px cut with an ellipsis, a canvas without focusable stars on touch), and the index without it is lighter: the paths screen no longer loads the canvas code. The path's own map (the graph of its steps) stays as an option.
- **Proof is shown, not ticked.** A checklist the member ticks needs a place to store each tick; Mark done is the one stored record, so the proof items are a plain list until there is a reason to store more.
- **Start sets no pace.** Following starts with no weekly goal; times are shown at 6 h a week and say so. A member chooses a pace in one line.

**Numbers.** Initial JS stays at 161.0 KB. Tap counts: Learn → a path → Start this path = 2 taps (target ≤ 3); Home's next-step card → Mark done = 2 taps (target ≤ 2).

**Gaps (U3b, next).** The rebuilt map; the editor's outline with drag to reorder, live preview and sources check; the review's side-by-side diff; "Seniors on this path", "Drives that ask for these skills", "Practise this" and "Ask a senior" from real data; the index's people signal; e2e for the alumnus's edit and the faculty review with the diff.

### Gate results (U3a)

| Gate                                               | Result                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                                                                                                                                                    |
| Shared tests                                       | 215 passed (12 new: phases, the next step, time at a pace, old goals read as hours)                                                                                                                                                                                                                                     |
| Web tests                                          | 130 passed (the two Galaxy layout tests went with it)                                                                                                                                                                                                                                                                   |
| `pnpm build` and bundle budget                     | Pass: initial 161.0 KB, unchanged                                                                                                                                                                                                                                                                                       |
| API tests                                          | The 26 files that touch roadmaps or `/me`: 333 passed; CI runs the whole suite                                                                                                                                                                                                                                          |
| End-to-end (local)                                 | The roadmaps spec, 4 of 4 on phone and desktop (start, Mark done, Undo from the toast above the open sheet, pace, map; draft, submit, review, publish); spaces, shell, navigation, companies, core and people pass. The full suite before U3a: 239 of 264, one Windows-only failure (calendar feed). CI runs everything |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                                                                                                                                                |

### U3a follow-up: generated API docs

CI's unit tests failed on the U3a push: the weekly goal's body and summary changed, and the generated `docs/permissions.md` and `docs/api/openapi.json` were not regenerated (only the 26 API test files that touch roadmaps had been run locally, not `test/docs.test.ts`). Regenerated and pushed on their own (`f3e5c4e`).

## U3b · Career paths: the map, authoring and review

**Shipped.**

- **Review side by side** (`version-diff.tsx`, on the history page reviewers open from the queue): the path's own changed details, then each step added, removed or changed, and for every changed value the old and the new one in two columns (stacked on a phone), as a deletion and an insertion so a screen reader says which is which. Prerequisites read as step titles, time as a range, links as their titles. The "nobody approves a version they edited" rule is unchanged (API).
- **Editor**: an outline of the steps in the author's order, each with the phase it will fall in and "no source yet" when it has no citation and is not marked for review; drag a row to reorder (each step's editor keeps Move up and Move down for the keyboard); select it to go to that step's editor. Problems that name a step (an unknown prerequisite, a loop) also show on that step. Under it, "What students will see": the journey drawn live from the draft (the journey became `JourneyView`, used by both). On desktop the column beside the form scrolls on its own; on a phone it follows the form.
- **The map** (`graph-view.tsx`, still loaded only when chosen): opens fitted to the screen's width with the next step in the middle; titles wrap to three lines inside taller nodes instead of being cut at 24 characters; drag or scroll to pan, pinch, Ctrl + wheel, the + and − keys or the buttons to zoom (0 fits it again); the next step is marked; it opens at no less than three quarters of life size so titles stay readable; a small key (done, next, project, needs review) replaces the legend paragraph. Reporting a path moved from the header into its About sheet, so the header has one "…".
- Strings: `roadmaps.review.before|after|cited`, `roadmaps.editor.outline|untitled|noSource|preview|previewHint`, `roadmaps.mapKey|mapKeys` in en, te and hi; `graphLegend` removed. `ListRow` passes props to its `<li>` (drag and drop).
- e2e: the authoring test now also has the author suggest an edit and the reviewer approve it from the side-by-side diff (`del` and `ins` checked), with axe on the diff; the editor's outline and preview are checked as the step is written.

**Decisions.**

- **People and outcomes move to the phases that own their data.** "Seniors on this path" and "Ask a senior" need a query over mentors' profiles and follows (U6, mentors); "Drives that ask for these skills" and "Practise this" need matching against drives and the practice bank (U7, career). Built here they would be guesses; U3 shows nothing rather than invent a signal (X7).
- **The outline keeps the author's order.** Phases come from the prerequisites, so dragging a step past its prerequisites would not move it to another phase; the outline says which phase each step lands in and the preview shows the result.

**Gaps.** The people and outcomes signals (moved to U6 and U7, above). The index's "4 alumni from your college work as this" waits for the same matching.

### Gate results (U3b)

| Gate                                               | Result                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                         |
| Shared tests                                       | 215 passed                                                                                                                                                                                   |
| Web tests                                          | 130 passed (the diff test now checks the earlier version of a changed step)                                                                                                                  |
| `pnpm build` and bundle budget                     | Pass: initial 161.1 KB (+0.1 KB: the new English strings load with the app; the map, the diff and the editor load with their own screens)                                                    |
| API tests                                          | No API change in U3b; CI runs the suite                                                                                                                                                      |
| End-to-end (local)                                 | The roadmaps spec, 4 of 4 on phone and desktop: start, Mark done, Undo, pace, the map with axe; draft, submit, review and publish, then an edit approved from the side-by-side diff with axe |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                     |

## U4a · First run: the landing page

Design: `docs/design/v2/u4.md`. U4 ships in two parts: U4a, the landing and its speed target (this section), then U4b, the three-step sign-up and the first-run checklist on Home.

**Shipped.**

- **Above the fold**: the college's crest and name once (header; on a phone the name may take three lines beside the language names), the outcome headline "Get guidance, referrals and placement help from your college's seniors.", a sub-line naming the college, one primary button and "Already a member? Sign in" as a link. The button says "Join with your mobile number" where the college can send codes and "Join with your college email" where it cannot (`tenant.phoneSignIn`), so it never promises what the next screen does not do.
- **The product**: the demo student's Home in a phone frame (beside the headline on a wide screen; just below the first screen on a phone, with "See it with demo data ↓" at the foot of that screen), labelled "Demo data". Then three sections, each a heading, a sentence and a crop of the real screen: Find a senior (the first suggested senior), Prepare and register for drives (a drive), Follow a career path (progress and the first phase). All are screenshots of the seeded demo taken by `audit:landing-shots` (new), per theme and language: 24 webp files, 884 KB in the repository; a visitor downloads four (about 140 KB), lazily, and the service worker does not precache them.
- **The college in numbers**: placement rate for the latest batch, mentoring hours and top recruiters, only while the college publishes its outcomes page (G8). A new public route, `GET /public/outcomes`, returns the published page's aggregates (small counts already suppressed) or `null`; API test in `growth.test.ts` (null while off, also for another college; no names).
- **The privacy line** in the footer, and the language switcher top right, as before (F5).
- e2e `landing.spec.ts` (new, phone and desktop): one headline and one main after the app takes over, the college's name once, one primary action and the Sign in link, the picture's file and its "Demo data" label, the three sections, the published numbers; the headline as the LCP element on the phone project and CLS under 0.05 on both; Telugu gets the app's own landing; a member's device skips the first paint; signing in marks the device. `core.spec` and `shell.spec` follow the new headline.

**The speed target: the headline before any script.**

1. `index.html` carries the landing's frame and English headline (`#fp`, before `#root`). `public/boot.js` turns it on before the first paint for `/` in English, outside the installed app, on a device that was not signed in last time (`cl:member`, a display hint set and cleared by the session store; it holds nothing secret and decides nothing).
2. While the app starts, the frame shows instead of the launch mark; the landing renders into the frame's slots and keeps the headline the browser painted first (`lib/first-paint.ts`), and any other first screen (a redirect home, a college error) removes it. Another language, or leaving the page, gives the app's own landing. `frame.test.tsx` keeps `index.html` and the React frame identical.
3. The app's files now start from `boot.js`: the build moves the entry script, its 22 module preloads and the UI font's preload from `index.html` onto `boot.js`'s tag (`vite.config.ts`, `bootLoadsApp`, replacing `preloadUiFont`). Everywhere else they start at once, as before; under the landing's first paint they start just after it, so the stylesheet, and so the headline, no longer shares a slow connection with about 190 KB of script and font (gzip). With the frame alone the headline was the LCP element but still measured 4.0 s (first paint 3.4 s); with the scripts moved, 2.0 s (2,007 ms, 7 ms over); with the font moved too, 1.8 s.

| Page    | LCP before (F5) | LCP now              | First paint | LCP element          | CLS   |
| ------- | --------------- | -------------------- | ----------- | -------------------- | ----- |
| Landing | 4.2 s           | **1.8 s** (1,817 ms) | 1.4 s       | the headline (`h1`)  | 0.001 |
| Sign-in | 4.8 s           | 5.0 s (5,047 ms)     | 1.4 s       | a line of text (`p`) | 0     |

Measured with `LH_RUNS=landing,sign-in audit:lighthouse` (Lighthouse 12.8.2, mobile emulation, simulated throttling) on the owner's machine, the same one as F5. Unthrottled in the browser, the headline paints at 0.36–0.58 s at 360 and 412 px and stays the largest paint, with no layout shift.

**Decisions.**

- **The college's name is in the header, not the headline.** The headline is drawn before the app knows which college this is (one `index.html` serves every college), and the brief also asks for the name once.
- **On a wide screen the product picture is the largest paint.** It sits beside the headline as the brief asks and is larger than it (129,000 px² against 54,500 px² at 1440 × 900), so it becomes the LCP element at about 0.8 s unthrottled. Shrinking it until the headline wins would leave a picture too small to show the product; the 2.0 s target is measured on a phone, where the headline is the LCP element (checked by `landing.spec.ts`).
- **A display hint, not a session change.** `cl:member` only decides whether `index.html` paints the landing; the session is still checked with the server and the access token stays in memory (rule X10 untouched).

**Not met: sign-in LCP ≤ 2.0 s (5.0 s).** Its largest paint is a line of the app's own text, so it waits for the app's code, the college and the language pack. The same approach (a first paint in `index.html`) does not fit a form that depends on the college's sign-in methods; this stays with U10 (the load path), as F5 recorded.

**Gaps.** The pictures must be retaken (`audit:landing-shots`) when Home, Mentors, a drive or a path changes visibly; U4b (the checklist on Home), U5 (Home) and U6 (the mentors' card) will each need a new set.

### Gate results (U4a)

| Gate                                               | Result                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                              |
| Shared tests                                       | 215 passed                                                                                                                                                                                        |
| Web tests                                          | 133 passed (new: `frame.test.tsx`, index.html against the React frame)                                                                                                                            |
| API tests                                          | 1,362 passed, 7 skipped (the whole suite; `docs:gen` regenerated `docs/permissions.md` and `docs/api/openapi.json` for `GET /public/outcomes`)                                                    |
| `pnpm build` and bundle budget                     | Pass: initial 161.6 KB (+0.5 KB: the first paint's hand-over and the session's display hint)                                                                                                      |
| Lighthouse (`LH_RUNS=landing,sign-in`)             | Landing LCP 1.8 s (the headline), CLS 0.001; sign-in 5.0 s (open, U10)                                                                                                                            |
| End-to-end (local)                                 | `landing.spec` 8 of 8; `core`, `shell`, `navigation`, `spaces`, `phone-signup` 80 passed; 7 failed only because this machine's database was not reseeded (admins' stored 2FA secrets); CI reseeds |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                          |
| CI                                                 | Green (run 44121532713)                                                                                                                                                                           |

## U4b · First run: sign-up and the first ten minutes

Design: `docs/design/v2/u4.md` (second half).

**Shipped.**

- **Sign-up in three steps** (`features/auth/sign-up.tsx`) with "Step n of 3", a bar and Back (which keeps what was typed): (1) "I am a student / an alumnus" and the mobile number, or "Use email instead" (email and password) for staff and colleges without a phone channel; (2) "About you": name and birth month, then the consents as one sentence built from the ticked purposes ("We use your data to run your account and suggest mentors from your branch and goals. We never sell or share it…") with "Review choices" opening the full, versioned checklist, which also opens by itself when the required purpose is unticked; (3) the code, which sends itself and creates the account (or "Check your email"). Same fields, defaults, calls and errors as before; a server error about the number, the email or the password returns to step 1.
- **The minor path**: an under-18 birth month shows "What happens next" in step 2 (we find you on the college's list; your guardian reads what you are joining and enters a code; then everything opens), under a small picture of a member and their guardian. The guardian screen shows the same three steps above its own (`features/guardian/what-next.tsx`); its behaviour is unchanged.
- **"Set up your CampusLink"** on a verified student's Home (`features/home/setup-checklist.tsx`): pick your goal (opens Mentors with the goals sheet, `/mentors?goals=1`), follow a career path, find a senior, turn on WhatsApp updates (only where the college sends WhatsApp). Each is done from real data and then says what changed ("Mentors are ranked for: …", "Following …", "You asked …", "Updates go to …"); "3 of 4 done"; hide it (per device). Home's route loader brings its code, strings and data with the page, so it paints with Home rather than pushing it down.
- Strings: the new `firstRun` pack (`signup`, `setup`, `guardianNext`, loaded with sign-up, the guardian screen and the checklist), in en, te and hi. With them in the Telugu file it measured 70.7 KB against the 70 KB per-chunk budget; in the pack it is 69.9 KB.
- The landing's pictures were retaken, so the Home picture shows the checklist as a demo student sees it.
- e2e: sign-up by email through the three steps (with axe, the consent sentence and "Review choices"), Back keeping values, the required purpose; phone sign-up (adult, under-18 with "What happens next", phone sign-in, the listed minor and their guardian) through the steps; `first-run.spec.ts` (new): the checklist's done items and what changed, one tap to the goals sheet, hiding it, and no checklist for an unverified member. The tasks audit's sign-up walk taps Continue.

**Taps (acceptance: sign-up to Home ≤ 6 taps, ≤ 4 fields for an adult).** By the U0.2 hand-count rules: Join, Continue, Send code: **3 taps**; the number, the name, the birth month and the code: **4 fields** (the code box takes the phone's one-time-code autofill and sends itself). An alumnus adds one tap (the role chip). The tasks audit counts each select as two taps; U13 re-runs it, with the journeys audit's time to the first useful action, against U0.

**Decisions.**

- **The code is the last step, not the second.** The API checks the code and creates the account in one call (`/auth/phone/verify` with the sign-up fields) and uses the code up when it checks it. Asking for the code before the name would need a sign-up ticket between two calls: a session change that rule X10 leaves to the owner (in F8 below as an owner decision). The order changes nothing a member types.
- **No time limit on the checklist.** The app keeps no join date for members (`/me` has none), so it shows until every item is done or the member hides it, rather than for "the first 14 days".
- **Alumni's first steps go to U5** (the alumni Home leads with requests waiting and micro-asks).

**Gaps.** Progressive profiling moves to U7 with Companies and drives: asking for target companies when Companies first opens, and taking the CGPA from the college record (the drives' academic dialog still asks a student for it). Time to the first useful action is measured in U13. The Telugu strings file is at 69.9 of 70 KB: the next strings added to it need a pack.

### Gate results (U4b)

| Gate                                               | Result                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                                                                                                                                  |
| Web tests                                          | 135 passed (the strings parity test knows the `firstRun` pack and the screens that load it)                                                                                                                                                                                                           |
| API tests                                          | No API change in U4b; CI runs the suite                                                                                                                                                                                                                                                               |
| `pnpm build` and bundle budget                     | Pass: initial 161.8 KB (+0.2 KB: the guardian screen loads its pack); the Telugu strings 69.9 KB                                                                                                                                                                                                      |
| End-to-end (local)                                 | `landing`, `first-run`, `core`, `phone-signup`, `navigation`, `spaces`, `accessibility`: 70 passed; 6 failed only on this machine's unreseeded database (admins' stored 2FA secrets; the listed demo minor had joined in an earlier run). The student pages, the checklist included, reflow at 320 px |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                                                                                                                              |

## U5 · Home: one clear "Today"

Design: `docs/design/v2/u5.md`.

**Shipped.**

- **The Today card** (`features/home/today.tsx`, rules in `today-pick.ts` with unit tests): one large `ActionCard` for the single most urgent thing. A session within 15 minutes or under way gets **Join** and its time (Sessions opens with that session's join dialog, `/sessions?join=<id>`); else a drive closing within 48 hours that the student can still register for gets **Register** and a countdown; else this week's Next Step gets **Continue** (straight to the step). Nothing urgent: no card. Home's route loader fetches the sessions and drives with the page, so the card paints with Home (CLS 0 for a student and an alumnus).
- **Your next steps**: the Next Step's other items as `ListRow`s (at most three, titles wrap), without the one in the Today card, and "See all" (`/next-step`). The old Next Step card on Home is gone; `/next-step` keeps its page.
- **Suggested for you**: one sideways row of `PersonCard`s with the reason the suggestion is based on ("Alumnus of your branch (CSE)" or "Alumnus of your college") and one Follow at secondary weight.
- **From your college**: the feed under that heading, with the composer for those who post; the "One useful thing today" wrapper card is gone (it is a post in the feed, one card style).
- **Stories** show only with three or more active stories; otherwise "New story" sits by "From your college" for members who post, so the first stories can still be added.
- **Coming up** on wide screens: upcoming sessions, drives closing in the next 7 days the student can still register for, and upcoming events. The three promotional cards (find a mentor, Q&A, impact) are gone. Phones do not load it.
- **Alumni**: "Waiting for you" after the Today card: pending mentorship requests (**Accept** in one tap; **Decline…** opens Requests, where the reason is chosen) and micro-asks waiting for a reply (**Accept** or **Decline**, one tap each), loaded with the page. The U4 set-up checklist is now a student's only.
- Strings: the new `today` pack (loaded with Home); "Your next steps" in the `habits` pack. The landing's pictures were retaken (Home changed).
- e2e: `today.spec.ts` (new): a student's Today card has exactly one action and it goes where it says, the next steps leave its item out, people to follow say why, no "One useful thing" card, "Coming up" on desktop only, axe; an alumna accepts the seeded pending request from Home in one tap and sees no student checklist. `habits.spec` (See all) and `navigation.spec` (scrolls to the feed itself) follow the new Home.

**Not met: Home LCP ≤ 2.5 s.** Lighthouse (mobile, simulated) on this machine: **6.0 s**, against **6.2 s** for the Home before U5 measured the same way here (the before-3 figure, 3.9 s, came from a faster cloud container). The LCP element is the Today card's title. As with sign-in, what is left is the load path for signed-in screens (the session check, `/me`, then the screen's code and data, one after another), which is U10's work; U5 adds no step to it.

**Decisions.**

- **Accept is one tap; Decline is not.** Declining a mentorship request needs a reason (the API requires one of four kind replies), so Home's Decline opens Requests; micro-asks take Accept and Decline in one tap each, as the API allows.
- **"Coming up" only on wide screens.** On a phone the Today card carries what is urgent and the rest is one tap away (Sessions, Placements, Events).
- **The suggestion's reason is what the API used**: alumni of the student's branch first, then of the college. No other reasons are shown until the API computes them.

### U5 follow-up: what CI's end-to-end run found

CI's run on `c2fd8e5` (fresh seed) failed four tests that this machine's day-old database could not show. All four are fixed and pass again on a freshly reseeded local database (feed, companies, resilience, today, mentorship and shell: 56 of 56 on phone and desktop):

- **A new sign-in was routed by the previous member's profile.** After sign-in, the app marked the cached profile stale without waiting for the new one, and `/start` chose the first screen from whatever was cached: on a device whose last session expired (rather than signed out), the previous member's profile restored from the device's saved copy. The next member landed on the previous member's first screen and briefly saw their navigation. Sign-in, sign-up, invite join and single sign-on now go through `lib/start-session.ts`: the new token, then the member's own profile before anything routes by it; if the member changed, the previous member's cached data, saved copy and unsent actions are dropped.
- **Warming a link could reload the page.** Links warm their screen's code as they scroll into view; when that code was gone after a deploy, Vite's preload error reloaded the page under a member who had not opened anything. Home's "Coming up" made this visible (event links on desktop). Background warming is now quiet (`quietly` in `lib/chunk-reload.ts`); opening the screen still retries and reloads once.
- **"Coming up" stood in for the Events screen's data.** It used the Events screen's own query, so Events opened from cache even when its data could not load. It now has its own query (`comingUpEvents`).
- **The demo college had one story**, so Home's three-story rule hid the row on a fresh seed. The seed adds two DEMO stories, created 5 ms before the TPO's so hers is strictly the newest ring (on CI's second run same-millisecond inserts tied and another ring came first).
- **A practice question's code could not be scrolled from the keyboard** (axe `scrollable-region-focusable`, on the phone project only when the day's set held a long line of code): the code block is now focusable, with a focus ring. Not caused by U5; it surfaced with that day's set.

### Gate results (U5)

| Gate                                               | Result                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                                                                                                                                                                       |
| Web tests                                          | 141 passed (new: `today-pick.test.ts`, the Today card’s rules)                                                                                                                                                                                                                                                                             |
| API tests                                          | No API change in U5; CI runs the suite                                                                                                                                                                                                                                                                                                     |
| `pnpm build` and bundle budget                     | Pass: initial 162.0 KB (+0.1 KB); Home adds 54.9 KB; the Telugu strings 69.9 KB                                                                                                                                                                                                                                                            |
| Lighthouse (home-cold)                             | LCP 6.0 s (6.2 s before U5 on this machine), CLS 0; not met (U10)                                                                                                                                                                                                                                                                          |
| End-to-end (local)                                 | `today`, `habits`, `navigation`, `spaces`, `shell`, `landing`, `first-run`, `accessibility`, `mentorship`: 74 passed; 10 failed only on this machine’s day-old, unreseeded database (admins’ stored 2FA secrets; the alumna’s seeded request, accepted by an earlier run of the new test; the seeded session, now in the past). CI reseeds |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                                                                                                                                                                   |

## U6a · Mentors: finding a senior and asking

Design: `docs/design/v2/u6.md`. U6 ships in two parts: U6a (this section) and U6b (the session page, the mentor's queue, rematch and nudges).

**Shipped.**

- **The match** (`features/mentors/match.tsx`). Wide screens: the ranked list on the left with filters (company, role, branch, language, free in the next two weeks; options come from the list itself, ranking unchanged) and the selected senior on the right with one action, **Request**, which opens the request sheet in place. Phones: one compact card at a time with **Not now** and **Request** (no "Interested"; arrow keys still work; the name opens the full profile), or the same list with the filters (`?show=list`). The duplicate "Requests" button left the page header (it is in the section row and the sidebar).
- **Strength in words, reasons first** (`mentor-text.ts`, unit-tested): "Good match: same branch (CSE), helped 3 students like you reach interviews or offers and free in the next two weeks". The number shows only beside "Strong match" (60 and up) and never to a minor. The reasons are the API's own (`MatchReason`).
- **One role line**: "Data Analyst at Kestrel Analytics"; the headline only when it says something else; the seed's "DEMO:" and "(demo)" markers become one "Demo" badge (match, Browse tiles, the mentor page, seniors on a path).
- **The request sheet in three steps** (`request-form.tsx`): what you need (each session type explained in one line, with its length; résumé or practice report to share as before), your goal (two short answers with examples, "What are you working towards?" and "What would help most?"), then when (the senior's free slots) with **What {name} will see**: the session, the time and the message as the senior will read it, headed "Goal:" and "What I need:" as before, so the API and the mentor's inbox are unchanged.
- **Seniors on this path** (moved here from U3) on a career path: up to three seniors whose job title is the role the path leads to (the mentor search, checked against the job title on the device), "Works as Software Engineer at Nimbus Labs", and **Ask**, which opens that senior's request sheet (`/mentors/<id>?ask=request`).
- Strings: the new `mentoring` pack (loaded with Mentors, a mentor's page and the seniors on a path); `match.intro` no longer mentions swiping.
- e2e: `match.spec.ts` (new): on desktop the reasons panel, a filter that narrows every row and Clear; on a phone Not now and Request with no "Interested"; the three steps with the too-short message caught and the preview; Seniors on this path and Ask. `mentorship.spec` sends its request through the three steps and checks the preview; the tasks and journeys audits walk the new steps.

**Taps (U0.2 rules, a student asks for a mock interview).** Mentors tab, Request on the card, the session type, Continue, Continue, a time, Send: 7 taps and 2 fields, as before (7 and 2), without the detour through the mentor's page; the senior now reads a goal and a need instead of one free-text box.

**Decisions.**

- **Filters on the device.** The match list is the API's ranked list for this student; narrowing it on the device keeps the ranking and needs no API change. The options are taken from the list, so no filter can show nothing by itself.
- **Seniors on a path by job title.** The only true link between a path and a person today is that they work as what the path leads to; "followed this path" or "finished it" would need new data. Nothing is shown when no job title matches.

### Gate results (U6a)

| Gate                                               | Result                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                                                                      |
| Web tests                                          | 145 passed (new: `mentor-text.test.ts`, the role line, demo label and strength rules)                                                                                                                                                     |
| API tests                                          | No API change in U6a; CI runs the suite                                                                                                                                                                                                   |
| `pnpm build` and bundle budget                     | Pass: initial 162.1 KB; the Telugu strings 69.9 KB (new strings in the `mentoring` pack)                                                                                                                                                  |
| End-to-end (local, freshly reseeded)               | `mentorship`, `match`, `roadmaps`, `navigation`, `today`, `accessibility`, `people`, `core`: 70 of 70 after one fix (the long Alumni Match and dashboard journey ran out of its 30 s; it now has 90 s, like the other mentorship journey) |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                                                                  |

## U6b · Mentors: after asking

**Shipped.**

- **A session's own page** (`/sessions/:id`, `features/sessions/session-page.tsx`): the session and the other person, the same card as Sessions (Join opens 10 minutes before; move, cancel, calendar, message; after it, feedback and the public review prompt), **What it's for** (the request's message, or its older three parts), and **Shared notes** both participants read and edit (up to 4,000 characters, "Last saved by you, 2 minutes ago"; read-only once cancelled). Sessions link to it ("Open session"), an accepted request's "View session" opens it, and Home's Join goes there with its join dialog open.
- **API**: `GET /bookings/:id` now returns the agenda and the notes (`BookingDetailView`; participants only, as before); `PUT /bookings/:id/notes` saves them (participants only; 404 for anyone else and from another college; strict body). The member's data export includes the notes; erasing either participant's account clears the notes on their sessions. API tests in `mentorship-loop.test.ts` and the cross-college list in `isolation/mentorship.test.ts`; `docs:gen` regenerated.
- **The mentor's queue** leads the mentoring dashboard (`features/mentor/requests-queue.tsx`): requests waiting, each with **Accept** in one tap and **Decline** offering the four kind replies by name (Not my area, Fully booked, Ask me again later, Someone else fits better), "This week: 2 of 5 requests" against the mentor's cap, and a link to Requests for another time or a personal note. The impact card follows.
- **Rematch as a calm message** (B5): "Rahul hasn't replied yet. Here are 3 seniors who usually reply within a day.", with their faces; the button to see them is unchanged.
- e2e `session-page.spec.ts` (new): a student asks Arjun through the three steps; Arjun sees it in the queue with the week's count, checks the decline replies, accepts in one tap, opens the session from the accepted request, reads the agenda and saves notes; the student sees the same notes and who saved them. Axe on the queue and the session page.

**Decisions.**

- **Notes are cleared, not kept, when either person's account is erased**: they may hold what the erased person wrote, and a shared note cannot be split by author.
- **The agenda is the request itself**, as the mentor received it; there is no second place to write it before the session, so it never disagrees with the request.

### Gate results (U6b)

| Gate                                               | Result                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                               |
| Shared tests                                       | 215 passed                                                                                                                                         |
| Web tests                                          | 145 passed                                                                                                                                         |
| API tests                                          | 1,363 passed, 7 skipped (the whole suite; new: shared notes and the agenda, and the notes route in the cross-college list); `docs:gen` regenerated |
| `pnpm build` and bundle budget                     | Pass: initial 162.2 KB; the Telugu strings 69.9 KB (new strings in the `mentoring` pack)                                                           |
| End-to-end (local, freshly reseeded)               | `mentorship`, `session-page`, `match`, `today`, `accessibility`, `navigation`, `people`, `resilience`: 60 of 60                                    |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                           |

## U7a · Career: drives and readiness

**Shipped.**

- **Placements** (`features/placements/placements.tsx`): no intro paragraph above the drives (it is in "About this"). The academic record is one row, "CGPA 8.2 · 0 backlogs", with where it came from ("From the college", "Checked by the placement cell", "Waiting for the placement cell") and **View**, a sheet with every figure. Nothing on the screen asks a student for marks (progressive profiling, moved from U4): adding them yourself is only inside that sheet, and only where the record is not the college's. Each drive card shows the company and the drive's title (wrapping, never cut), pay, mode and date, a `Countdown` while registration is open (warm within 48 hours), one line on where the student stands ("You are eligible", the placement cell let you in, the first reason not and "+2 more", Registered with the current round, Selected), and **Register** on the card: one tap for a drive with no questions and no résumé, with **Undo** in the toast (it withdraws); otherwise the drive opens with its registration sheet (`?register=1`). The whole card opens the drive; Register sits above that link.
- **A drive** (`drive-page.tsx`): registration comes first on a phone (right after the header) and beside the content on desktop, with the countdown; the rounds are a `Timeline` (date or "Round 2", name, the kind only when it adds something, "Date to be announced", the student's result as a badge, the current round marked). Mode, venue and date are back under the title: since U1 the header's `intro` went into the "About this" sheet, which had hidden them.
- **Readiness** (`features/progress/readiness.tsx`): momentum first. The score is a large `ScoreRing` with "+6 this week" beside it when it went up; then "3 steps add 13 more" over the top three steps (each once, with its points); then what the score is made of as rows with bars, each part's own step only when it is not already in the three. No "You're at 18." headline (A17).
- **API, momentum**: `GET /me/readiness` keeps the score the student saw today (`ReadinessSnapshot`: `userId`, `day`, `score`; one per day, deleted after 35 days by a TTL index) and returns `momentum` (`delta`, `since`) against the latest one at least 7 days old, or null. The board, its export and nudges never read it. Exported (`readiness.dailyScores`) and erased with the member; tenant-scoped (isolation suite). Tests in `readiness.test.ts` and `isolation/readiness.test.ts`; `docs/specs/readiness.md` updated.
- **Drives for this role** on a career path (`features/placements/drives-on-path.tsx`, moved from U3): open drives with a role that is one the path leads to (`drivesForRoles`: one title contains the other, ignoring case and the demo marker; unit-tested), soonest closing first, at most three, with the countdown and "You are eligible". Nothing when none match. Loaded on a path only for members who see placements, with the new `drives` pack.
- Home's Today **Register** opens the drive with its sheet (`?register=1`).
- **Fixed (U12.10)**: the status inks `text-success-ink`, `text-warning-ink`, `text-danger-ink` and `text-info-ink` were used by every status badge and line since the primitives were built, but `index.css` never mapped them to colours, so Tailwind dropped the classes and the text took the surrounding colour. They are now mapped to the existing, contrast-tested `--*-ink` tokens (no token value changed). `practice/set.tsx` used `border-success-line` and `border-warning-line`, which do not exist; now `*-border`. New test `styles/theme-colors.test.ts`: every brand, status and subject colour class in the code has its `--color-` token.
- e2e: `placements.spec.ts` registers from the card (countdown, eligibility, Undo toast) and adds a test for the record row and sheet and for the drives on the software engineer path; `readiness.spec.ts` reads the ring and the steps heading and checks the deficit headline is gone.

**Tap counts.** (c) Student registers for an eligible drive: 4 → **2** (Career tab → Register on the card) for a drive without questions; 3 plus its fields for one with questions (Career tab → Register → the sheet → Register).

**Decisions.**

- **A daily score is stored for momentum.** The readiness spec said scores are never stored; "+6 this week" cannot be honest without the earlier number. One number a day, the student's own, 35 days, exported and erased, never on the board. Momentum is shown only when the score went up, as "+6 this week" when the earlier score is from the last 8 days and "+6 since 3 Nov" otherwise; there is none in the first week.
- **"3 steps add 13 more" counts only steps with a known gain**: a step whose points cannot be known in advance is listed but not added or counted.
- **Students can still add their own marks**, inside the record's sheet, where the college has not imported records: drives with CGPA rules would otherwise be closed to them. They are never asked on the screen, and the placement cell checks them as before.

### Gate results (U7a)

| Gate                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Shared tests                                       | 215 passed                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Web tests                                          | 157 passed (new: `currentRound`, `drivesForRoles`, momentum wording, theme colours)                                                                                                                                                                                                                                                                                                                                        |
| API tests                                          | 1,365 passed, 7 skipped, coverage 90.31% statements and 76.57% branches (the whole suite, 4 workers; new: momentum, daily scores in the export and erasure, and in the cross-college suite). Two runs with the default workers timed out in the route-sweeping tests (`permissions`, `minors`) with the machine at about 80% CPU from other work; those files pass alone in a third of their limits. `docs:gen`: no change |
| `pnpm build` and bundle budget                     | Pass: initial 162.3 KB; new strings in the `drives` pack and the `readiness` pack                                                                                                                                                                                                                                                                                                                                          |
| End-to-end (local, freshly reseeded)               | `placements`, `readiness`, `today`, `roadmaps`, `accessibility`, `navigation`, `people`, `practice`, `mentorship`, `match`, `session-page`, `spaces`: 80 passed, 10 skipped (phone-only and desktop-only tests)                                                                                                                                                                                                            |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Part F · The open issues (F1–F8)

Worked in a second session on the owner's machine while U0, U1 and prompt 4 were in progress on a cloud branch; its fixes were moved onto `main` after those merged, so each row says where the item was done.

| Item                         | Status                                                     | Where                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| F1 G12 governance            | Done                                                       | Prompt 4, P0: the owner accepted ADR 0014 on 11 Nov 2026; `NETWORK_ENABLED` stays as an off switch with its 404 tests                     |
| F2 Pen-test notes            | Done                                                       | Prompt 4, P0: `docs/security-review.md` › Master prompt 4                                                                                 |
| F3 Dependency advisories     | Done                                                       | Prompt 4, P0: `pnpm audit --prod` is clean (`write-excel-file` 4.1.1, `mongoose` 9.12.1, `fast-xml-parser` 5.12.0)                        |
| F4 Touch targets             | Done here (re-measure due, below)                          | This section                                                                                                                              |
| F5 Landing and sign-in fonts | Fonts done; landing 1.8 s (U4a); sign-in 5.0 s, open (U10) | This section and U4a                                                                                                                      |
| F6 Bundle headroom           | 10.1 of 15 KB                                              | U0.3 above; the rest comes with U2 (nav icons and the route split)                                                                        |
| F7 Stale records             | Done                                                       | Prompt 4, P0 (ADR, `progress.md`, `report-2.md`, README); `CLAUDE.md` › Git workflow now records the one time parallel sessions were used |
| F8 Partly met items          | Recorded                                                   | The table at the end of this section                                                                                                      |

### F4 · Touch targets

**Shipped.** Every target the before set listed under 44 × 44 px (90 on 23 screens) is raised, with no visible text enlarged:

| Target                                                            | Was     | Fix                                                                                              |
| ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| Member-name links on Home, a post, questions and a job's referrer | 24 px   | the new `hit` utility: a centred, invisible `::before` of at least 44 × 44 px around the link    |
| Job titles in the jobs list; question titles                      | 39 px   | the title's link is stretched over its card (`after:absolute after:inset-0`); Save sits above it |
| Roadmap resource links                                            | 38 px   | one link per row, 44 px tall                                                                     |
| The roadmap review queue's links                                  | 24 px   | `hit`                                                                                            |
| The college link on the sign-in pages                             | 40 px   | 44 px tall                                                                                       |
| "Show as a table" (charts) and "Text of this page" (PDFs)         | 43 px   | 44 px tall                                                                                       |
| Notification settings                                             | 35 px   | a 44 px pill                                                                                     |
| The chat's Send and Stop buttons                                  | 38 × 44 | they no longer shrink beside the text box                                                        |

The audit now fails on any target under 44 px: `audit:capture`'s summary asserts that `touch-targets-360.json` lists none. Its probe counts a hit area the way a finger meets it: an absolutely positioned `::before` with content extends the target, unless the element clips its overflow.

**Measured** on the F-phase build before it was moved onto this `main` (DPIT, every role, the platform console and the employer portal): 134 screens, 3,313 targets, none under 44 × 44 px; 288 axe scans without a violation; no sideways overflow. **Not yet measured on this `main`**, where U1 changed button and input sizes: the next capture (U2's) runs the assertion on every screen and reports here.

### F5 · Landing and sign-in fonts

**Shipped.** The language switcher's native names ("తెలుగు", "हिन्दी") use the device's fonts (`font-native`: `ui-sans-serif, system-ui`), on the landing and sign-in pages and in Settings' language chips, so an English page no longer downloads Anek Telugu (138 KB) and Anek Devanagari (253 KB) to draw two words. `unicode-range` subsetting is unchanged.

Measured with `audit:lighthouse` on the owner's machine (mobile emulation, simulated throttling, DPIT; that machine is slow, so compare only with its own before figures):

| Page    | Fonts downloaded                                                          | Page weight   | LCP before | LCP after |
| ------- | ------------------------------------------------------------------------- | ------------- | ---------- | --------- |
| Landing | Geist 30 KB, Bricolage 41 KB, Geist Mono 24 KB (no Telugu, no Devanagari) | 795 → 400 KiB | 5.9 s      | 4.2 s     |
| Sign-in | the same three                                                            | 477 → 472 KiB | 4.7 s      | 4.8 s     |

**Not met: landing LCP ≤ 2.0 s.** The fonts were the regression (3.7 s in the first audit, 5.8 s after B12), and removing them takes 1.7 s off, but the page was never at 2.0 s. What is left is the path to the first screen: the headline is drawn by the app after five requests in a row (the page, the script files, the college and the language pack, the screen, then its display font), and the simulated connection charges each step. Sign-in did not change because its largest paint is a line of small text that never used those fonts. Rule X6 sets the same target for the whole prompt, so this is carried to U4 (the landing's headline) and U10 (font preloading and the load path); F5 stays open until landing measures 2.0 s.

**Update (U4a):** landing measures 1.8 s with the headline as the LCP element (U4a, above). Sign-in is still 5.0 s and stays with U10.

### F8 · Partly met items (each waits on the owner)

| Item                                       | Where it stands                                                                                                     | What it needs from the owner                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android build and Play listing (G9)        | `apps/android/twa-manifest.json` and `docs/android.md` are ready; no app has been built or published                | A Play Console developer account, the upload keystore, the real root domain, and the Play app signing SHA-256 (then `ANDROID_CERT_SHA256` in the web build)                               |
| WhatsApp one-tap autofill                  | The template registration is documented; the app's handshake is documented, not built                               | The signed Android package (its app hash for the template) and the go-ahead to add the native handshake to the generated project                                                          |
| Employer invoicing and revenue share (G12) | Billable events are recorded; invoices to employers and payouts to colleges are hooks only                          | The commercial terms: price per posting, drive or hire, and each college's share                                                                                                          |
| NAAC definitions against the manual (R12)  | NBA and NIRF checked; NAAC unchecked because naac.gov.in serves a revoked TLS certificate (not bypassed)            | A copy of the current NAAC manual (PDF) from the owner, or the site fixed                                                                                                                 |
| Translated legal texts (R13)               | Telugu and Hindi texts are written and held back                                                                    | A native speaker's review of each (O7), after the lawyer's review of the English                                                                                                          |
| The code as sign-up's second step (U4)     | The code is the third step: the API checks it and creates the account in one call, and uses it up when it checks it | Whether to add a short-lived sign-up ticket between checking the code and creating the account (a session change, rule X10), so the code can be asked before the name as the brief orders |

### Audit scripts (for U13)

- `audit:tasks` (new) walks the seven U0.2 tasks on a 360 px phone and counts taps and fields by fixed rules (a select is two taps; a one-time code is one tap and one field), so U13 can count the same way again. Its counts on the before build are in `docs/build/before-3/data-after/tasks.json`; they are higher than the hand counts in U0.2 because of those rules, so compare script with script.
- `audit:lighthouse` runs on Windows (it starts `npx` through Node) and measures signed-in pages in a Chrome it starts itself and prepares over the debugging port; a signed-in run that ends on the sign-in screen is now a failure, not a result.

### Gate results (Part F)

| Gate                                               | Result                                                                                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                                                                                                                                                                                                   |
| Shared tests                                       | 193 passed                                                                                                                                                                                                                             |
| Web tests                                          | 132 passed (`cn.test.ts` read its folders through a URL path, which fails on Windows; it now uses `fileURLToPath`)                                                                                                                     |
| `pnpm build` and bundle budget                     | Pass                                                                                                                                                                                                                                   |
| API tests with coverage                            | No API code changes in this push. On the F-phase build before the move: 1,290 passed and one (`permissions.test.ts`, the route × role matrix) timed out at its 60 s limit under local load; it passes alone in 45 s. CI runs the suite |
| Secret scan (gitleaks v8.30.1)                     | No leaks                                                                                                                                                                                                                               |
| End-to-end                                         | Run by CI on this push                                                                                                                                                                                                                 |
