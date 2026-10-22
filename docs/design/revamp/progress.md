# Revamp progress log

The plan is `master-prompt.md` §12; the requirements are `audit.md`; the Study feature is `docs/specs/ai-study-assistant.md`. A new session reads this file first and resumes from the first phase that is not **Done**.

Branch: the session branch rule applies (`claude/sleepy-euler-bi65m3`, started from the audit commit `f05e94c`). It overrides `CLAUDE.md`'s "work on `main`", as it did for the audit.

| Phase | Name                                                                        | Status      |
| ----: | --------------------------------------------------------------------------- | ----------- |
|     0 | Setup (prompt, spec, progress log)                                          | Done        |
|     1 | Critical fixes (platform landing, desktop rail, D3, error boundaries, D1)   | Done        |
|     2 | Quick wins (all 24)                                                         | Done        |
|     3 | Navigation and transitions (§7a, §7b, role-aware navigation)                | Done        |
|     4 | Performance (§7d, CI bundle budget)                                         | Not started |
|     5 | Foundations (tokens, fonts, palette generator, contrast tests, ADR)         | Not started |
|     6 | Living style guide (`/design`) — **stop for owner review with screenshots** | Not started |
|     7 | Primitives (`components/ui/` rebuild, duplicates merged)                    | Not started |
|     8 | Showpiece screens                                                           | Not started |
|     9 | Study feature (spec §13 steps 1–6, each a stop-for-review point)            | Not started |
|    10 | Remaining screens                                                           | Not started |
|    11 | Polish                                                                      | Not started |
|    12 | Re-audit (`after/`, `summary.md`, scorecard)                                | Not started |

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
