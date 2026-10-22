# Revamp progress log

The plan is `master-prompt.md` §12; the requirements are `audit.md`; the Study feature is `docs/specs/ai-study-assistant.md`. A new session reads this file first and resumes from the first phase that is not **Done**.

Branch: the session branch rule applies (`claude/sleepy-euler-bi65m3`, started from the audit commit `f05e94c`). It overrides `CLAUDE.md`'s "work on `main`", as it did for the audit.

| Phase | Name                                                                        | Status                            |
| ----: | --------------------------------------------------------------------------- | --------------------------------- |
|     0 | Setup (prompt, spec, progress log)                                          | Done                              |
|     1 | Critical fixes (platform landing, desktop rail, D3, error boundaries, D1)   | Done                              |
|     2 | Quick wins (all 24)                                                         | Done                              |
|     3 | Navigation and transitions (§7a, §7b, role-aware navigation)                | Done                              |
|     4 | Performance (§7d, CI bundle budget)                                         | Done                              |
|     5 | Foundations (tokens, fonts, palette generator, contrast tests, ADR)         | Done                              |
|     6 | Living style guide (`/design`) — **stop for owner review with screenshots** | Done, awaiting the owner's review |
|     7 | Primitives (`components/ui/` rebuild, duplicates merged)                    | Not started                       |
|     8 | Showpiece screens                                                           | Not started                       |
|     9 | Study feature (spec §13 steps 1–6, each a stop-for-review point)            | Not started                       |
|    10 | Remaining screens                                                           | Not started                       |
|    11 | Polish                                                                      | Not started                       |
|    12 | Re-audit (`after/`, `summary.md`, scorecard)                                | Not started                       |

## Phase 0 · Setup

- Saved the owner's brief: `master-prompt.md` (everything above Appendix A) and `docs/specs/ai-study-assistant.md` (Appendix A).
- Both are listed in `.prettierignore` so the format check never rewrites them; they are verbatim copies.
- Next: Phase 1.

## Phase 1 · Critical fixes

What was done:

- **Platform landing (IA-10) and deep links (IA-8).** Sign-in and `PublicOnly` send members back to the page that asked for sign-in (`safeReturnPath` in `packages/shared/src/navigation.ts` accepts only same-origin app paths), otherwise to the tenant kind's home (`/platform` for the console). An e2e test per role asserts the landing route (`e2e/shell.spec.ts`).
- **Role-aware navigation (IA-1, IA-3; decisions D2, D4).** One navigation model in `packages/shared/src/navigation.ts` (`buildNav`) derives bottom tabs, the desktop rail, the avatar menu, the Create sheet and the command palette's "Go to" list from roles and permissions. Tabs per persona follow `master-prompt.md` §7 with fallbacks while Study, Subjects and Review are not shipped (student: Home, Roadmaps → Study, Create, Mentors, Jobs; alumni: Home, Requests, Create, Mentors, Jobs; staff and admin: Home, Roadmaps → Subjects, Create, Admin → Review, Jobs). Profile, Settings and Sign out live behind the avatar for every role; Messages and Notifications are top-bar icons with counts.
- **Desktop rail (IA-2).** The rail scrolls on its own, collapses to icons below 1280 px, and pins the account menu at its foot. An e2e test checks every rail item is reachable at 1440×900, 1280×720 and 1024×768.
- **Fictional alumni removed (VI-1, D3).** The landing "wall" and its strings are gone for every college; an e2e test asserts no names appear.
- **Error boundaries and stale chunks (ST-0, §7c).** Screens load through React Router `lazy` with `importWithRetry` (one retry, then one guarded reload into the screen being opened, never a loop; `vite:preloadError` handled the same way). Every screen, both layouts and the root have an error element in the design system (`components/layout/route-error.tsx`); inside the shell only the content area changes. The service worker now claims the page on first install (`clientsClaim`), and a controller change reloads only after the member accepts an update. E2e tests cover a blocked chunk (one reload at most, then a friendly state, then Reload works), and offline navigation to an unvisited screen.
- **No more full-screen spinners (TR-1, ST-1, TR-5).** Per-route Suspense wrappers are gone: the router keeps the current screen while the next one's code loads, a thin progress bar appears after 150 ms, and the first load of a screen shows a content-area skeleton that fades in only after 200 ms. While `/me` loads, a shell outline shows instead of a spinner; if it fails, a retryable, offline-aware state shows.
- **Silent sign-outs (PW-8, D1), client only.** `lib/refresh-coordinator.ts`: single-flight refresh, Web Locks across tabs (BroadcastChannel fallback), a tab that waited adopts the other tab's fresh token instead of rotating again, `keepalive` so closing a tab cannot strand a rotated cookie, and network or server errors keep the session. Sign-out is announced to other tabs. Unit tests simulate the server's reuse detection; e2e tests open three tabs at once and close a tab mid-refresh on a slow network. **PW-8 no longer reproduces**, so no server change is proposed.
- **Also fixed on the way:** sheets as history entries for the account and Create sheets, the composer (`?compose=`) and the Ask form (`?ask=`), so Back closes them (PW-2, partial); re-tapping the active tab scrolls to top, again refreshes (NB-3); the offline banner no longer covers the top bar (PW-9); `⌘K` on Apple devices (A11Y-7); `ApiError` carries the request id for error screens.

Deviations and decisions:

- TR-2 and PF-1 (Critical) are structural and are the subject of phases 3 and 4; phase 1 removed the visible symptom of TR-2 (spinner → skeleton → content) and set up the loader-ready route table.
- Docker's default file limit let Mongo crash (`Too many open files`) during the coverage gate; dockerd now runs with `--default-ulimit nofile=20000:20000` in this container. Not a code issue.
- The pinned gitleaks image could not be pulled through the proxy; the same pinned release (8.30.1, checksum verified against the release's checksums file) ran as a binary.

Next: Phase 2 (quick wins).

CI: the first Phase 1 run failed before any test because GitHub's runners moved to a Linux kernel (6.19+) that MongoDB 8.0 refuses to start on (SERVER-121912). `GLIBC_TUNABLES=glibc.pthread.rseq=1` on the Mongo containers (CI, `docker-compose.yml`, staging) fixes it; verified locally by faking a 6.19 kernel with an `LD_PRELOAD` `uname` shim. CI is green on that commit.

## Phase 2 · Quick wins

All 24 quick wins from `audit.md` §8 are in. Phase 1 already shipped 1, 2, 5, 10, 11, 12 and 17.

| #   | Quick win                            | What shipped                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | Warm tab chunks                      | `lib/preload.ts`: every bottom tab's code loads after the first idle period; rail and tab links warm their screen on hover, focus and touch. Routes carry their importer in `handle.preload`.                                                                                                               |
| 4   | Scroll restoration                   | `lib/scroll-memory.ts`: back and forward restore the exact position (re-applied while content settles, up to 1.5 s, until the member scrolls), tabs keep their own position, new screens start at the top, overlays and filters never move the page. The feed keeps measured row heights per history entry. |
| 6   | Detail screens draw from the list    | `lib/query-seed.ts` finds the tapped job, mentor or post in any list cache and passes it as `placeholderData`; post comments load alongside.                                                                                                                                                                |
| 7   | 360 px overflow                      | Shell, job page and mentoring grids use `minmax(0,1fr)` tracks; `Card` is `min-w-0`; availability rows shrink. The reflow test now covers job detail and the alumni Mentoring dashboard at 320 px.                                                                                                          |
| 8   | Profile header                       | The identity column has a real basis, so "Change photo" wraps below it.                                                                                                                                                                                                                                     |
| 9   | First paint follows the device       | `index.html` no longer forces dark; light and dark `theme-color` metas; `public/boot.js` (same origin, no CSP change) applies a saved theme, motion and language before the app loads; picking a theme updates the browser chrome.                                                                          |
| 13  | Contrast and scrollers               | `--danger-fill`/`--on-danger` (5.6:1 in dark), `fg-2` on tinted session-type cards, the analytics table scroller is a focusable, labelled region.                                                                                                                                                           |
| 14  | Focus after actions                  | `Button` stays focusable while loading (`aria-disabled`, repeat clicks and implicit submits ignored); the request confirmation takes focus.                                                                                                                                                                 |
| 15  | Bars, toasts, offline                | Bars are 93% opaque, toasts sit above the tab bar on phones, the offline notice no longer covers the top bar (phase 1).                                                                                                                                                                                     |
| 16  | Stale copy, Forbidden                | "Arrives next", "when mentorship opens" and the "Coming next" card are gone (both languages). Forbidden explains itself and offers a way home; when verification would open the page, it says so and links to Verify.                                                                                       |
| 18  | Shared side effects, lazy auth pages | `@campuslink/shared` is `sideEffects: false`; sign-in, sign-up and email-link pages load lazily.                                                                                                                                                                                                            |
| 19  | Telugu in badges                     | Noto Sans Telugu is in the mono stack; `Badge` is sans by default with a `mono` option for records.                                                                                                                                                                                                         |
| 20  | One reduced-motion source            | `useReducedMotionPref()` (in-app setting first, then the device) replaces `motion`'s hook in Mentors and Progress and the Reels autoplay check.                                                                                                                                                             |
| 21  | Story progress                       | A compositor `scaleX` animation that pauses with `animation-play-state` and advances on `animationend`.                                                                                                                                                                                                     |
| 22  | No flash of "nothing yet"            | Rewards, redemptions and event Q&A and attendees wait for data before showing an empty state.                                                                                                                                                                                                               |
| 23  | Mobile keyboards                     | `enterKeyHint` "search" on every search field and the palette, "send" in chat; numeric fields use `inputMode="numeric"`.                                                                                                                                                                                    |
| 24  | Tab rows                             | `TabNav` (used by Admin and Settings) scrolls with snap, fades at edges with more tabs, and keeps the active tab in view.                                                                                                                                                                                   |

Also: MC-4 (no exclamation marks in decline templates). New e2e tests: `e2e/navigation.spec.ts` (Home → post → back, Jobs → job → back, per-tab scroll, re-tap to top, theme first paint), verify-first on a gated page, and the reflow additions.

Decisions: a deliberate sign-out (or account deletion) never carries a "return to" page; an expired session does. Comment boxes keep the Enter key for new lines (no "send" hint) because Enter does not send there.

Next: Phase 3 (navigation and transitions).

## Phase 3 · Navigation and transitions

Role-aware navigation shipped in phase 1. This phase covers `master-prompt.md` §7a and §7b on the current screens.

§7a, scrolling:

- **Scroll-aware chrome** (`lib/use-scroll-chrome.ts`): one passive, frame-throttled listener sets `data-chrome` and `data-scrolled` on `<html>`; CSS slides the top bar and tab bar away after 56 px of downward scroll (8 px threshold) and brings them back on any upward scroll, near the end of the page, on focus (a field, or the bars themselves), on a tap at the top edge and on every new screen. The top bar is clear at the top and turns to glass with a hairline once content runs under it. Reduced motion uses a 90 ms fade. Hidden bars stay in the accessibility tree. `--chrome-top` gives sticky headers their offset. The rail never hides.
- **Tab memory** (`lib/tab-memory.ts`): each tab remembers the last screen opened from it, a detail screen keeps its tab lit, and tapping the lit tab returns to the tab's root (then scroll to top, then refresh).
- **Horizontal rows**: `TabNav` and `Segmented` have a sliding indicator (`lib/use-sliding-indicator.ts`, transform only), snap scrolling, edge fades, the active item kept in view and, on pointer devices, arrow buttons. `Segmented` scrolls instead of wrapping into a grid (DS-4).

§7b, between screens:

- **Code and data in parallel** (TR-2, PF-2): reads are defined once in `lib/queries.ts`; static route loaders prefetch the same keys for Home, post, Jobs, job, Mentors, mentor, Roadmaps, roadmap, Events, event, Sessions, Messages, conversation, Notifications and Progress, waiting at most 1.5 s and never failing the navigation. Intent prefetch now warms data too; `IntentLink` warms detail screens' code when they scroll into view and their data on hover, focus or touch. Default `staleTime` is 30 s; feeds and inboxes refresh when the app is resumed. Filtered lists keep previous data while refetching.
- **One loading state**: the current screen stays (with the progress bar) until the next one has its code and first data; the content-area skeleton only shows on a cold start or a slow read.
- **View transitions**: every cross-screen navigation is a view transition (push slides in from the right, Back reverses it, tabs crossfade, under 300 ms, scaled by `--motion-scale`, a short crossfade under reduced motion). The bars and rail are captured separately so they never move. Shared elements morph: mentor tile avatar → mentor header, job card title → job heading, feed post → post page.
- **History-aware overlays**: every `Dialog` pushes a history entry so Back closes it (`lib/use-dialog-history.ts`); the command palette and story viewer too; the roadmap step panel is `?step=` (J5). Dialogs and sheets animate in and out (sheet rises on phones, dialog scales in on wider screens).
- **Back links** (`BackLink`, IA-4): go back with filters and scroll intact, or to the parent when opened from a link or notification.
- **Optimistic updates** (ST-4): sending a message (shown as "Sending…", restored to the box on failure), accepting or declining a request (with a confirmation toast, ST-5), RSVP, and marking a roadmap step, each with rollback.
- **Focus and titles** (A11Y-6b): after navigation focus moves to the screen's heading and the document title follows it; Back returns focus to the link you followed.
- **Image stability**: chat images keep the same box while loading.

Tests: `e2e/navigation.spec.ts` adds the persistent shell, scroll-aware chrome, tab memory and Back-closes-a-sheet; the roadmap test checks Back closes the step panel.

Deferred: the remaining shared-element pairs (roadmap node, story, subject, citation, video) arrive with the screens that have them (phases 8 and 9). Data is not prefetched for every visible card, only on intent, to spare metered connections.

Next: Phase 4 (performance and the CI bundle budget).

## Phase 4 · Performance

`master-prompt.md` §7d. First-load JS went from 301 KB to **166 KB** gzipped (budget 170 KB).

**Bundle budget in CI.** `apps/web/scripts/bundle-budget.mjs` (`pnpm --filter @campuslink/web budget`, run in CI after the build) reads Vite's manifest and fails when the initial JS passes 170 KB or when any screen adds more than 70 KB on top of what is already loaded (so initial + first screen stays under 240 KB). Parts a screen loads on demand are measured against that screen. Exceptions need a reason in the script; there are none.

What left the first load, or a screen:

- **Locales**: only the active language loads (`i18n/index.ts`, `loadLanguage`); a parity test checks keys, variables and empty strings in both.
- **Socket.io**: loaded after sign-in, when the realtime bridge connects (`lib/realtime.ts`, with a generation guard so a slow load never outlives a sign-out).
- **Shell extras**: the command palette, account menu and sheet, Create sheet, the admin MFA gate and the toaster load after first render (when idle or on first use). If one cannot load (offline before it arrived), its placeholder stays and it loads when the connection returns; the shell never fails with it (`lib/lazy-part.tsx`, covered by `e2e/resilience.spec.ts`).
- **Toasts**: `lib/toast.ts` loads sonner on first use; nothing imports sonner directly (lint rule).
- **Motion**: `lib/motion.ts` (`LazyMotion` + `m`, features in their own chunk); the XP bar is a CSS animation. Direct `motion/react` imports are a lint error.
- **Zod**: off the first load and off every screen that only needs constants. Shared vocabularies (branches, job levels, session types, roadmap categories…) moved to zod-free `packages/shared/src/constants/`, and a small build plugin (`apps/web/pure-shared.ts`) marks the shared package's top-level schema builders pure so unused ones are dropped. The mentor request form (react-hook-form + Zod) loads beside the mentor header.
- **Already lazy or small**: charts and the Galaxy are their own screens, markdown is 1 KB, there is no date library (Intl), icons are per-icon imports. PDF.js, KaTeX, the video player and the study chat arrive in phase 9 and stay out of the first screen.

Cold start:

- The college lookup and session refresh start together; the screen the member opened loads its code alongside them and its data as soon as there is a session (`warmLanding`, `lib/preload.ts`), instead of after the router mounts.
- `index.html` paints the app icon before any script runs, and `Splash` keeps it in place (a spinner fades in below after 200 ms), so the first paint is no longer a blank screen.
- A second, wasted refresh rotation on every cold start is gone (`SessionBootstrap` now reads the live session state).
- Main-thread work: tab indicators, edge fades and the scroll-aware bars no longer force a layout while React is committing (measured through `ResizeObserver` or the next frame); date and number formatters are created once per language; the first render runs as a transition.

Lighthouse 12, signed in as a student, mobile, simulated throttling (the audit's settings and machine class; `data/lighthouse/` is the baseline). Cold is a first visit with no HTTP cache and no service worker (two runs); warm is the installed app:

| Screen   | Cold score (audit → now) | Cold LCP (audit → now) | Warm score (audit → now) |
| -------- | -----------------------: | ---------------------: | -----------------------: |
| Home     |               54 → 69–73 |            4.9 → 4.6 s |               72 → 89–91 |
| Jobs     |               68 → 77–78 |            4.3 → 4.4 s |                  87 → 93 |
| Mentors  |               68 → 65–74 |        4.6 → 4.4–4.8 s |                   – → 90 |
| Roadmaps |               54 → 78–81 |        4.7 → 4.2–4.4 s |                   – → 95 |
| Profile  |               70 → 73–80 |            4.1 → 3.9 s |                   – → 94 |

CLS is 0 on every screen (Home was 0.153, Roadmaps 0.189: the followed roadmaps and drafts now load with the list in the route loader). FCP is 2.3 s cold (was 3.1 s) and 0.1 s warm. TBT is 160–600 ms cold and 270–440 ms warm (Home warm was 990 ms).

**Gap: the 85 target is met for the installed app but not for a first visit on a cold cache.** Cold LCP is bound by the request chain an SPA with a refresh-token session has (HTML → JS → session refresh → data, about 0.7 s per step at the simulated latency) plus about 1.5 s of main-thread work at 4× CPU slowdown on Home. Next steps, in the phases that rebuild these surfaces: a lighter menu and sheet primitive in phase 7 (Radix dropdown and dialog are about 30 KB of Home), Home's feed render cost and the shell's first render in phase 8, and cached-first loading (audit B13: show the last-known content on cold start) in phase 11; phase 12 re-measures.

Next: Phase 5 (foundations: tokens, fonts, palette generator, contrast tests, ADR).

## Phase 5 · Foundations

`master-prompt.md` §4–§6; the decisions are in [ADR 0008](../../adr/0008-design-language.md).

- **Generated palette** (`packages/shared/src/palette.ts`, OKLCH maths in `oklch.ts`): every colour comes from the college's primary hue (fallback 275). Brand clamped to lightness 0.55–0.68 and chroma 0.12–0.20; neutrals tinted by the hue; a 50–950 ramp; inks stepped to 5.5:1 on the canvas and every text surface; white or near-black labels at 4.5:1 on fills; aurora stops at `h`, `h + 45`, `h + 100`; eight subject accents with readable inks and chips; fixed-hue status (ink, fg, surface, border), role chips and six chart colours. Everything is gamut-mapped and rounded exactly as written to CSS.
- **Contrast test** (`palette.test.ts`, 91 cases): maroon, navy, saffron, forest green, neon lime, pure red, teal and purple, each with an awkward accent, in both themes: body text, inks, labels on fills, focus ring, subject and role chips, status inks, charts, gamut, ramp order and neutral chroma.
- **Runtime**: `applyBranding()` injects the college's palette as one `<style>` element (no CSP change) and updates `theme-color`; `styles/palette.css` holds the default (generated, `pnpm --filter @campuslink/web palette`; a test fails when stale). The college's accent colour survives as `--accent`; the secondary colour now only feeds its logo.
- **Tokens** (`styles/tokens.css`): an eight-step fluid type scale (`text-caption` … `text-hero`), radii 6/10/14/20/28/full, elevation 0–4 (tinted shadows in light, inner highlights in dark), spring easings (snappy, smooth, bouncy as `linear()`, with matching presets in `lib/motion.ts`), press scale, focus ring, selection, hover and pressed overlays, scrim. Aurora utilities: `bg-aurora`, `aurora-ring`, `aurora-border`, `aurora-mesh`. Glass falls back to solid under reduced transparency and on low-end devices (`data-lowend` from `boot.js`).
- **Type**: Geist (UI), Bricolage Grotesque (display), Anek Telugu and Geist Mono, self-hosted; chosen from a side-by-side English and Telugu specimen against Figtree, Inter and Noto Sans Telugu (ADR 0008). Only Geist's Latin file is preloaded. Paragraphs wrap pretty, headings balance, Telugu gets looser lines.
- **Hero contrast**: the landing mesh paints at 16% strength in light mode (`--mesh-strength`), so its paragraph reads at about 6:1 instead of about 3:1. The landing itself is rebuilt in phase 8.

Initial JS is 168 KB (the generator ships in the first load so a college's colours apply before its first screen paints).

Fixed while verifying: tiny font subsets were being inlined as `data:` URLs, which the production CSP (`font-src 'self'`) correctly refuses, so fonts are never inlined now; a chat timestamp at 75% opacity on the brand fill fell under 4.5:1 and is now full strength.

**Open:** `navigation.spec.ts` › "a tab remembers the screen you left it on" failed in 2 of 5 full end-to-end runs since phase 4 (the tapped job link has focus, the URL stays on Jobs) and never in more than 50 targeted runs, including 25 loops under 6× CPU throttling. Causes ruled out: CSS-carrying chunks (only the entry has CSS), blockers, effects that navigate, and the screen's alert-filter rewrite. The spec now attaches the app's navigation state on failure, so the next occurrence says whether the navigation was pending or completed and came back.

Next: Phase 6 (the `/design` living style guide), then a stop for the owner's review.

## Phase 6 · Living style guide

`/design` (development builds only; production builds leave it out, checked on the build) shows every token and today's primitives side by side in light and dark for any college colour: the two demo colleges plus the eight awkward colours the palette test covers.

- **Colour:** canvas and surfaces, the three text levels with their live contrast ratios, brand and accent fills with their labels, brand and accent inks, the 50–950 ramp, the aurora (bar, story ring, featured-card border, hero mesh), the eight subject accents, status, role chips and chart colours.
- **Type, shape, depth, motion:** the eight-step scale in English and Telugu with tabular numbers, the six radii, elevation 0–4, glass over the aurora, and the three springs side by side.
- **Components (as they are before phase 7):** buttons in every variant, size and state, fields with hint and error, select, checkbox, textarea, OTP, chips, badges, segmented control, card with avatar and skeletons, empty state and a dialog.

How: each column is a `[data-palette][data-theme]` container with that college's generated tokens; `tokens.css` recomputes the derived tokens (aurora, overlays, depth) inside such containers. `parseOklch()` joins the shared colour maths so the guide can print ratios.

**Stopped here for the owner's review**, as the master prompt asks. Phase 7 (primitives) starts after it.

**Review:** the owner approved the Campus Aurora direction and the recommendations for Q7 (logo uploads), Q9 (signed media links) and Q12 (mentor request structure) on 2026-10-22 ("go ahead and complete this"); `decisions.md` records them.

## Phase 7 · Primitives

`components/ui/` rebuilt on the phase 5 tokens, and every duplicate the audit listed (DS-1, DS-3, DS-5) merged into one primitive. Each one is in `/design` in both themes.

- **New:** `Sheet` (bottom on phones with a drag handle and swipe-down to close, side sheet from the right on wider screens), `Tabs`/`TabPanel` (WAI-ARIA tabs, sliding underline, scrolling row with edge fades), `Switch`, `ChoiceGroup` (radio cards and chips, arrow keys like native radios), `PageHeader`, `ProgressBar` and `ProgressRing` (aurora for XP and coverage), `StatCard`/`StatGrid` (a description list, optional sparkline), `Table`, `AvatarStack`, `Tooltip`, `ErrorState`, and eight small aurora `Illustration`s for empty, error and success states.
- **Rebuilt:** `Button` (pill, 44/48/56 px, `outline` and `aurora` variants, spring press, tested hover fills `--brand-hover`/`--accent-hover`), fields (48 px, soft focus ring, custom checkbox, `Select` with a compact size), OTP boxes, `Chip`, `Badge` (tinted surfaces with inks), `Card` (`flat`, `raised`, `interactive`, `featured`), `Skeleton` (sheen), `EmptyState` (icon or illustration), `Avatar` (subject accents instead of raw HSL), `Dialog` (glass, scrolling body, pinned footer, swipe to close on phones), `TabNav`/`Segmented` (tinted in-page highlight), toasts (inverse, tokens).
- **Merged duplicates:** 30 page titles → `PageHeader` (plus six more hand-sized headings), with a lint rule that rejects `text-[clamp(` in features; 3 toggles → `Switch`; 6 progress bars → `ProgressBar` (the roadmap bar no longer animates `width`); 6 stat tiles → `StatCard`; 7 radio groups → `ChoiceGroup` or the shared `useRovingRadio` (star rating, story backgrounds); 8 hand-styled link cards → `Card variant="interactive"`; three more hard-coded "←" links → `BackLink`; the More and Create sheets → `Sheet` (the More sheet scrolls instead of clipping Sign out).
- **New tokens** (generated and tested in `palette.test.ts`): `--brand-hover`, `--accent-hover` (labels stay 4.5:1), `--brand-surface`, `--accent-surface` (inks stay 5.5:1 on them), `--on-aurora` (4.5:1 on every aurora stop).
- **Fix:** `cn()` now knows the type scale and elevation tokens. Before, `tailwind-merge` read `text-meta` as a colour and dropped it whenever a text colour followed (`lib/cn.test.ts`).
- **Budget:** the post composer's form loads when it opens (Home's first paint needs only the prompt bar); Home adds 68.7 KB, initial JS 168.6 KB.

## Phase 8 · Showpiece screens

The ten screens of master prompt §8, in order, on the phase 7 primitives. Every celebration below goes through one helper (`lib/celebrate.ts`): an aurora burst of at most 1.2 s from the element that caused it, never blocking, a still glow under reduced motion, a short vibration only when the member turns on Preferences › Vibrate on confirmations (off by default). Each moment is celebrated once per device (`firstSighting`). Audit MO-1.

- **Verification (onboarding):** an aurora hero with the college crest and a three-step indicator (`Stepper`), a large roll-number field, the OTP submits itself on the sixth digit (FO-6), then the "You're in!" moment (burst, focus on the heading), topics to follow as chips (follows, optimistic) and three next steps.
- **Home:** story rings in aurora until watched on this device, then quiet (seen state is a per-device convenience, like a read marker); today's One Useful Thing as the one featured surface, and no longer repeated in the feed below it (IA-12); the next session under the stories on phones (IA-6); tapping a post's text opens it (IA-9); reactions and save are 44 px (A11Y-5) and pop when switched on; double-tap a photo to mark a post helpful; polls fill with `ProgressBar`. The story viewer and composer, and the post composer, load when opened.
- **Mentors and booking:** tiles with a cover in the mentor's own accent, a large face, role and company (verified tick), batch, topics and the sessions offered with durations; Alumni Match shows the score as a ring and a word ("Strong match", MC-3). The mentor page has the same cover header and one primary action, "Request mentorship", which opens a sheet: session type and time, then one message with optional Goal / Background / What I need headings (owner decision Q12, FO-1). The API accepts the single `message` (20–1,500 characters) and still accepts the older three-part body; tests cover both and refuse a mix.
- **Requests:** the mentor's Accept celebrates; the mentee's first sight of an accepted request celebrates and the card wears the aurora hairline for three days.
- **Sessions and chat:** a date tile, a live countdown in the last 24 hours ("Starts in 2 h 15 min"), and once the room opens the card turns featured and "Join video" glows (aurora, opacity only). Chat has date separators, grouped bubbles (one time per group), sending / sent / seen ticks, a typing bubble, a 16 px composer (no iOS zoom) and, from 1024 px, the conversation list beside the thread (IA-12).
- **Career Galaxy:** a deep-space canvas in both themes (new `--space`, `--space-2`, `--on-space`, `--on-space-2` tokens, contrast-tested), a nebula per category, constellation lines, a seeded starfield with a few twinkles, stars whose aurora ring is the member's progress, two-line labels (VI-7), drag and pinch to pan and zoom once zoomed, zoom buttons and a legend. It loads only when the Galaxy view is shown; List stays the equal alternative. Roadmap steps open in a side sheet; marking a step done celebrates.
- **Progress and rewards:** XP as an aurora ring with the level inside, the streak with the last seven days lit from recent XP, badges as a collection (aurora ring when earned, a dashed silhouette and how to earn it when not; a new badge celebrates once), a podium for the top three on the leaderboard and a mosaic of faces on the Wall of Mentors.
- **Jobs and referrals:** a radar-sweep mark in the header, company monograms in the company's accent, 44 px save with a pop, a kanban "My applications" (columns scroll sideways on phones), and the referral request as a guided sheet (who you're asking, a live character count, how a referral works). An alumnus giving a referral celebrates.
- **Events:** poster cards with a date block; on the event page the RSVP and calendar come first in reading order, so they sit above the description and Q&A on phones (IA-11); answered questions turn green and pop their badge.
- **Profile:** a cover in the member's accent, a 96 px face, role chips (`RoleChip`, the four role colours), headline, branch and batch, location, whether they mentor, and About / Skills / Contact tabs; contact details say plainly when they are private, and members viewing their own profile are told this is what others see.
- **Landing:** the crest, the hero on the type scale, and three plain statements of what the network is for; still no people or numbers (D3). It now loads lazily, so signed-in members never download it.

**Not shown because the API does not provide it (§11: no API changes beyond D1, Appendix A and owner decisions):** a mentor's reply time and next free slot, mentor impact stats and reviews on the mentor page, company logos, and the faces of alumni at a company (only counts). They are listed in the final report as follow-ups.

**Budget:** initial JS 168.6 KB; Home 67.2 KB; every screen under 70 KB.

## Phase 9 · Study, step 1: data model, permissions, subjects, settings and providers

Spec §13 step 1 (`docs/phases/phase-9.md` has the step table).

- **Who reads what:** students see the subjects their branch and batch take (plus by-hand overrides; an excluded subject is a 404 even by direct link); faculty, alumni and admins see every subject. One filter decides it for every route and will scope retrieval and chat.
- **Subjects and syllabus:** faculty create subjects (and own them); owners and admins edit, archive, set owners and overrides; admins grant alumni contributors. The syllabus editor turns pasted text into a suggested Unit → Topic tree to review (every title comes from the text), then keeps ids through renames and re-orders so material tags survive.
- **AI settings (`/admin/ai`):** provider and model, a masked key (last four characters) with Save and test, embeddings with the "Anthropic has no embeddings" explanation, the versioned data notice, limits, switches and a kill switch. Keys are encrypted with `FieldCipher`, never returned, logged or audited, and scrubbed from provider errors. Tenant endpoints must be public `https`; private ones need the platform owner's allowlist.
- **Providers:** Anthropic (Messages API version 2026-10-21, no sampling parameters), OpenAI and OpenAI-compatible, Gemini (key in a header, never the URL), and a deterministic mock, behind `LLMProvider` and `EmbeddingProvider`.
- **Members:** `/study` and `/study/:id` with a calm notice when AI answers are off (and a "demo" notice for the demo responder); Study is now the students' second tab and Subjects the staff's.
- **Budget:** initial JS 169.3 KB; the forms, editors and the people sheet load when opened.

## Phase 9 · Study, step 2: material, processing pipeline, viewers and keyword search

Spec §13 step 2.

- **Upload:** PDFs, Word, PowerPoint, images, notes, video and audio files, YouTube and Vimeo links, and captions, from one sheet (several files at once with progress, suggested topics from the file name, a rights attestation). Files are sniffed, capped, cleaned, scanned (fail closed) and stored through `FilesService`; archives are refused. Contributions from alumni (and students, when a subject allows it) wait in the owners' review queue.
- **Processing:** one background job per material version, with live stages for the uploader (scanning, extracting, OCR, transcribing, chunking, embedding, indexed), three attempts, then a plain-words failure and a notification. Passages are cleaned (headers, footers, page numbers), instruction-like text is neutralised, and each passage keeps its page or moment and its syllabus topics. OCR (Tesseract), media tools (ffmpeg) and transcription (a local Whisper, or OpenAI with consent) are optional and say what is missing.
- **Viewers:** an in-app PDF viewer (page, zoom, search with highlights, `?page=` links), a media player (speed, chapters, a transcript that follows playback, `?t=` links), YouTube and Vimeo behind a click-to-load facade, and a text view for documents, slides and notes. Every file comes through a five-minute signed link that re-checks access (owner decision Q9).
- **Search:** each subject's search box finds passages in published material and opens the right page or moment.
- **CSP:** `frame-src` gains `https://www.youtube-nocookie.com` and `https://player.vimeo.com` (Appendix A requires embedded videos); `img-src` is unchanged.
- **Budget:** initial JS 169.2 KB (the material-progress store, the upload helper and notification texts moved out of the entry); the PDF viewer adds 128.8 KB only when a PDF is opened, under a recorded exception; every other screen stays under 70 KB.
