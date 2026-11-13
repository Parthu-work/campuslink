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

## Part F · The open issues (F1–F8)

Worked in a second session on the owner's machine while U0, U1 and prompt 4 were in progress on a cloud branch; its fixes were moved onto `main` after those merged, so each row says where the item was done.

| Item                         | Status                               | Where                                                                                                                                     |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| F1 G12 governance            | Done                                 | Prompt 4, P0: the owner accepted ADR 0014 on 11 Nov 2026; `NETWORK_ENABLED` stays as an off switch with its 404 tests                     |
| F2 Pen-test notes            | Done                                 | Prompt 4, P0: `docs/security-review.md` › Master prompt 4                                                                                 |
| F3 Dependency advisories     | Done                                 | Prompt 4, P0: `pnpm audit --prod` is clean (`write-excel-file` 4.1.1, `mongoose` 9.12.1, `fast-xml-parser` 5.12.0)                        |
| F4 Touch targets             | Done here (re-measure due, below)    | This section                                                                                                                              |
| F5 Landing and sign-in fonts | Fonts done; the 2.0 s target is open | This section                                                                                                                              |
| F6 Bundle headroom           | 10.1 of 15 KB                        | U0.3 above; the rest comes with U2 (nav icons and the route split)                                                                        |
| F7 Stale records             | Done                                 | Prompt 4, P0 (ADR, `progress.md`, `report-2.md`, README); `CLAUDE.md` › Git workflow now records the one time parallel sessions were used |
| F8 Partly met items          | Recorded                             | The table at the end of this section                                                                                                      |

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

### F8 · Partly met items (each waits on the owner)

| Item                                       | Where it stands                                                                                          | What it needs from the owner                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android build and Play listing (G9)        | `apps/android/twa-manifest.json` and `docs/android.md` are ready; no app has been built or published     | A Play Console developer account, the upload keystore, the real root domain, and the Play app signing SHA-256 (then `ANDROID_CERT_SHA256` in the web build) |
| WhatsApp one-tap autofill                  | The template registration is documented; the app's handshake is documented, not built                    | The signed Android package (its app hash for the template) and the go-ahead to add the native handshake to the generated project                            |
| Employer invoicing and revenue share (G12) | Billable events are recorded; invoices to employers and payouts to colleges are hooks only               | The commercial terms: price per posting, drive or hire, and each college's share                                                                            |
| NAAC definitions against the manual (R12)  | NBA and NIRF checked; NAAC unchecked because naac.gov.in serves a revoked TLS certificate (not bypassed) | A copy of the current NAAC manual (PDF) from the owner, or the site fixed                                                                                   |
| Translated legal texts (R13)               | Telugu and Hindi texts are written and held back                                                         | A native speaker's review of each (O7), after the lawyer's review of the English                                                                            |

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
