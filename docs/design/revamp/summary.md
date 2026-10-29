# CampusLink revamp: before and after

Status: **re-audit of the revamped app** (master prompt §12), measured the way `audit.md` measured the app on 21 October 2026, on the production build at the end of phase 12. The screenshots are in `after/` (named as in `before/`), the raw measurements in `data-after/` (as `data/`), and the work behind each change in `progress.md`.

## 1. Summary

The audit found an app that worked but did not feel finished: one flat navigation list for every role, a spinner on every first visit, data that waited for code, scroll positions lost on Back, errors that looked like empty screens, 301 KB of JavaScript before anything showed, a dark first paint for light-mode members and nothing ever celebrated. The revamp rebuilt the web app as **Campus Aurora**: a palette generated from each college's own colour (contrast-tested for any colour), a fluid type scale, Geist and Anek Telugu, one set of primitives with lint rules that keep screens on them, role-aware navigation from one model, a shell that never unmounts, screens whose code and data load together, scroll-aware bars, Back that closes sheets and restores the exact scroll, celebrations for the moments that matter, and the AI Study Assistant (Appendix A).

What the numbers say:

- **No spinners, no blank screens, no waterfalls.** In the ten journeys, spinner frames went from 19 per first visit to 0, frames with an empty content area from up to 31 to at most 5 (outside the cold start), and "data waited for code" from 14 steps to 2.
- **Back is exact.** Home comes back at 900 px (it came back at 222), Jobs at the position it was left (it jumped to 1,898).
- **Taps are as quick or quicker on a throttled mid-range phone** for most steps (opening a post 847 → 709 ms, a first visit to Events 781 → 571 ms, profile 826 → 430 ms, a notification's item 745 → 116 ms), and rapid tab taps no longer queue (3.5 s → instant). Back to Home and Jobs, and Roadmaps from the menu, are slower (Home and Jobs render more than they did; see §5).
- **Accessibility:** 330 of 330 axe scans clean (270 of 282 before); no page wider than the screen on any of 78 screens at 360 px; on the screens both audits measured, targets under 24 px that WCAG does not exempt went from 81 to 0.
- **Performance:** initial JavaScript 301 → 169 KB gzipped; the installed app scores 81 (Home) and 93 (Jobs) with a 1.1–1.2 s LCP; the public pages 87 and 86; layout shift is under 0.1 on every page (Home and Roadmaps were 0.15–0.19). A first visit on a cold cache still takes 4–5 s to its largest paint at simulated 4× CPU: the one area below the target.

## 2. Scorecard

Same scale as the audit (1 broken or absent, 2 works but unfinished, 3 solid with clear gaps, 4 good, 5 premium), judged against the brief's own targets. The brief's targets were transitions at least 4 and every area at least 4: **transitions is 4; performance is 3**, for the reason in its row.

|   # | Area                         | Before | After | Why                                                                                                                                                                                                                                                                                                                                       |
| --: | ---------------------------- | :----: | :---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Visual identity              |   3    | **4** | A palette generated from each college's colour in both themes (91 contrast cases), the aurora reserved for real moments, college logos, showpiece screens and the Galaxy rebuilt; no invented people. Short of 5 until the owner and real devices have judged it.                                                                         |
|   2 | Design system consistency    |   2    | **5** | Tokens for colour, type, radius, elevation and motion; one primitive per job with the duplicates merged; lint rules reject off-scale type and hand-sized titles; a living style guide in both themes.                                                                                                                                     |
|   3 | Typography                   |   3    | **4** | A fluid eight-step scale with 12 px as the floor (the lint rule enforces it), Geist with Anek Telugu, balanced headings, no crushed names at 360 px; only the crest's monogram (a logo) and small avatars' initials (10 px) are smaller.                                                                                                  |
|   4 | Navigation and IA            |   2    | **4** | Role-aware tabs and menus from one model, a grouped rail reachable at every size, an admin overview, deep links that survive sign-in, Back that goes back, notifications that open the item.                                                                                                                                              |
|   5 | Nav bar scroll behaviour     |   2    | **4** | Bars that get out of the way while reading and come back when wanted (never on a restored position), tab memory and reselect, pull to refresh, rows that show there is more. Pull to refresh still needs a real phone.                                                                                                                    |
|   6 | Screen-to-screen transitions |   1    | **4** | No spinners or blank frames, code and data in parallel, exact scroll and focus, view transitions where the device can afford them. Not 5: Back to Home and Jobs costs 0.6–0.7 s on a throttled mid-range phone, because those screens render more than before.                                                                            |
|   7 | Feedback and states          |   2    | **4** | Failed reads show an error with Retry instead of emptiness (35 screens), optimistic updates with rollback, confirmations and celebrations; a few placeholders are still plain blocks.                                                                                                                                                     |
|   8 | Motion                       |   2    | **4** | Springs and press scale, sheets that rise and close by swipe, celebrations once per device, one reduced-motion source, compositor-only animation; transitions skipped where they would cost frames.                                                                                                                                       |
|   9 | Forms and input              |   3    | **4** | One-message mentor requests, sticky actions above the tab bar, validation on leaving a field, drafts that survive, codes that send themselves, keyboards that say "Search" and "Send".                                                                                                                                                    |
|  10 | Accessibility                |   3    | **4** | 330 of 330 axe scans clean, no screen wider than a 360 px phone (and the 320 px reflow test), focus and titles on navigation, contrast tested for any college colour, 44 px targets on the main actions. Not 5 until real screen readers, Telugu speech and 200% zoom have been tried.                                                    |
|  11 | Performance as experienced   |   2    | **3** | Initial JS 301 → 169 KB, layout shift under 0.1 everywhere (0.15–0.19 before), the installed app at 81–93 with a 1.2 s LCP, public pages at 86–87. A first visit on a cold cache still has an LCP of 4.1–5.3 s and 0.4–1.0 s of blocking time at simulated 4× CPU (richer screens, an SPA's session chain); §3 lists what would close it. |
|  12 | Mobile and PWA feel          |   2    | **4** | First paint follows the device, Back closes sheets, each college installs as itself, no silent sign-outs, offline shows a friendly state inside a working shell, pull to refresh, reels stream. Offline copies of data await the owner's decision (PW-5).                                                                                 |
|  13 | Microcopy and tone           |   4    | **5** | Every stale or vague string fixed, courtesy titles handled ("Hi, Haritha"), validation in plain words, error and empty states that say what to do next, all of it in Telugu too. The Telugu still wants a native speaker's review.                                                                                                        |
|  14 | Per-role experience          |   2    | **4** | Each role has its own tabs and home: alumni see requests waiting, staff see their queues, admins an overview, the platform admin the console (§6).                                                                                                                                                                                        |

## 3. Measurements

### Bundle (`data-after/bundle.json`, `route-chunks.json`, `bundle-budget.json`)

| Measure                                       |                    Before |                                                                  After |
| --------------------------------------------- | ------------------------: | ---------------------------------------------------------------------: |
| Initial JS (gzip)                             |         301 KB (11 files) |                                                      169 KB (14 files) |
| Initial JS (raw)                              |                    998 KB |                                                                 519 KB |
| Initial JS plus Home, a member's first screen |               301 + 50 KB |                                                            169 + 68 KB |
| Largest addition per screen                   | 53 KB (Mentors, `motion`) | 68 KB (Home, Settings); the PDF viewer and KaTeX load only when opened |
| Total JS, every screen and feature            |         524 KB, 101 files |                    869 KB, 207 files (Study added PDF.js, KaTeX, chat) |
| CI budget (170 KB initial, 70 KB per screen)  |                   not met |                                                                    met |

### Lighthouse (`data-after/lighthouse/`)

Lighthouse 12.8.2, mobile preset with simulated throttling, signed in as the demo student; "first visit" clears the service worker, Cache Storage and HTTP cache; "installed app" is a profile whose service worker has installed and that has visited the page once. The host's CPU benchmark was comparable to the audit's (1,546–2,104 against 1,723–2,072). Accessibility scored 100 on every page before and after.

| Page                           | Performance |           FCP |           LCP |               TBT |           CLS |   Transferred |
| ------------------------------ | ----------: | ------------: | ------------: | ----------------: | ------------: | ------------: |
| Home, first visit              |     54 → 56 | 3.1 s → 2.5 s | 4.9 s → 5.3 s |   630 ms → 830 ms | 0.153 → 0.089 | 497 → 608 KiB |
| Jobs, first visit              |     68 → 58 | 3.0 s → 2.4 s | 4.3 s → 4.6 s | 470 ms → 1,000 ms |         0 → 0 | 460 → 591 KiB |
| Mentors, first visit           |     68 → 62 | 3.1 s → 2.3 s | 4.6 s → 4.8 s |   410 ms → 760 ms |         0 → 0 | 480 → 602 KiB |
| Roadmaps, first visit          |     54 → 68 | 3.1 s → 2.4 s | 4.7 s → 4.4 s |   560 ms → 540 ms |     0.189 → 0 | 448 → 592 KiB |
| Profile (edit), first visit    |     70 → 74 | 3.2 s → 2.5 s | 4.1 s → 4.1 s |   420 ms → 380 ms |         0 → 0 | 413 → 566 KiB |
| Someone's profile, first visit |     67 → 63 | 2.9 s → 2.4 s | 4.7 s → 4.4 s |   440 ms → 770 ms |         0 → 0 | 449 → 566 KiB |
| Study, first visit (new)       |      – → 70 |     – → 2.4 s |     – → 4.4 s |        – → 470 ms |         – → 0 |   – → 604 KiB |
| Home, installed app            |     72 → 81 | 0.1 s → 0.1 s | 1.2 s → 1.2 s |   990 ms → 710 ms | 0.155 → 0.089 |   16 → 17 KiB |
| Jobs, installed app            |     87 → 93 | 0.1 s → 0.2 s | 1.0 s → 1.1 s |   500 ms → 340 ms |         0 → 0 |   32 → 36 KiB |
| Landing, signed out            |     76 → 87 | 3.0 s → 2.3 s | 4.2 s → 3.7 s |    250 ms → 10 ms |         0 → 0 | 533 → 509 KiB |
| Sign in, signed out            |     79 → 86 | 3.1 s → 2.4 s | 3.6 s → 3.8 s |    260 ms → 40 ms |         0 → 0 | 396 → 396 KiB |

What would close the first-visit gap, in order of effect: showing the last-known screen on a cold start (that keeps members' data on the device, an owner decision with PW-5), making Home and Jobs render less on first paint (fewer cards above the fold, the feed's first page smaller), and server-side rendering of the first screen (a larger architectural change than this revamp).

### Accessibility, targets, type and reflow at 360 px (`data-after/axe*.json`, `touch-targets-360.json`)

| Measure                                            | Before (32 student screens) |                                     After (78 screens, every role) | Same 23 screens, before → after |
| -------------------------------------------------- | --------------------------: | -----------------------------------------------------------------: | ------------------------------: |
| axe scans without violations (360 px, both themes) |                  270 of 282 |                                                         330 of 330 |                               – |
| Screens wider than the viewport                    |                           1 |                                                                  0 |                           0 → 0 |
| Interactive targets                                |                         619 |                                                              1,987 |                       464 → 545 |
| Targets under 44 px (not exempt)                   |                   275 (275) |                                                           216 (82) |                   228 → 41 (17) |
| Targets under 24 px (not exempt)                   |                   103 (103) |                                                            106 (0) |                     81 → 24 (0) |
| Text runs under 12 px                              |                         240 | 76 (the crest's monogram, a logo, and two sets of avatar initials) |                               – |

Exempt targets follow WCAG 2.5.8: links inside running text, skip links, chart columns (the chart's table view is the equivalent control) and focusable panels that are not pointer targets. Both raw and non-exempt counts are reported.

### Other measurements (`data-after/`)

| Measure                                    | Before                                                                                     | After                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop rail (`desktop-rail.json`)         | 5 items unreachable at 1440 × 900, 8 at 1280 × 720 (the rail did not scroll)               | All 26 (25) items reachable at both sizes: the rail scrolls on its own                                                                                  |
| Offline, unvisited screen (`offline.json`) | "Unexpected Application Error!" replaced the whole app, with or without the worker         | With the service worker the screen opens offline; without it, "You're offline" inside a working shell                                                   |
| Scroll memory (`scroll-memory.json`)       | Home came back at 0 after a tab round trip; re-tapping a tab did nothing; bars never moved | Home comes back exactly where it was left; re-tapping goes to the top; the Jobs tab remembers the job; bars hide on scroll down and return on scroll up |
| Telugu (`telugu.json`)                     | Figtree with Noto Sans Telugu; mono badges fell back to a system font                      | Geist with Anek Telugu in every stack, looser Telugu lines, no horizontal overflow on any screen measured                                               |
| Horizontal rows (`scroll-memory.json`)     | Three rows on Home with more content and no sign of it                                     | None on Home overflows without a cue (rows that scroll fade at the edge with more)                                                                      |

## 4. Every finding, and what happened to it

Status: **Fixed** (the finding no longer reproduces), **Partly fixed** (what remains and why), **Deferred** (not done, with the reason), **Owner** (needs the owner or real devices). "Done well" rows from the audit are kept as they were. The phase is where the fix is described in `progress.md`.

### 4.1 Visual identity

| ID   | Sev    | Status | How                                                                                                                                                                                                                                                       |
| ---- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VI-1 | High   | Fixed  | Phase 1: the fictional alumni wall is gone for every college, with an e2e test that no names appear (D3). Phase 8 rebuilt the landing with three plain statements and no people or numbers.                                                               |
| VI-2 | Medium | Fixed  | Phase 5: elevation 0–4 (tinted shadows in light, inner highlights in dark). Phase 7: `Card` variants `flat`, `raised`, `interactive`, `featured`; phase 8 built the showpiece screens on them.                                                            |
| VI-3 | Medium | Fixed  | Logo upload (phase 10, decision 7) shown in the rail, top bar, sign-in, landing and verification; a per-college manifest with its name, short name, canvas colour and logo icon (phase 11); runtime `theme-color` (phase 5). iOS splash images: see PW-4. |
| VI-4 | Medium | Fixed  | Phase 5 palette: status, role chips and charts are fixed-hue tokens, so a coral accent no longer colours badges; match reasons use the brand ink. Contrast tests cover awkward accents (neon lime, pure red, saffron…).                                   |
| VI-5 | Low    | Fixed  | Phase 7: avatars use the eight subject accents, which are hue offsets of the college's own hue (`palette.ts`), instead of a hash gradient.                                                                                                                |
| VI-6 | Medium | Fixed  | Phase 5: OKLCH aurora stops (no brown midpoint), light-mode mesh at 16% so the hero paragraph reads at about 6:1; phase 8 rebuilt the landing.                                                                                                            |
| VI-7 | Low    | Fixed  | Phase 8: the Career Galaxy is a deep-space canvas with nebulae, constellation lines, progress rings, two-line labels and pan and zoom.                                                                                                                    |

### 4.2 Design system consistency

| ID   | Sev    | Status | How                                                                                                                                                                                                                                                    |
| ---- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DS-1 | High   | Fixed  | Phase 7: `PageHeader`; 30 pasted titles and six hand-sized headings replaced; a lint rule rejects `text-[clamp(` in features.                                                                                                                          |
| DS-2 | High   | Fixed  | Phase 5 tokens: an eight-step fluid type scale, radii, elevation, springs and overlays. Phase 11 moved every off-scale text size (237 lines) onto the scale, and a lint rule rejects `text-xs`…`text-xl` anywhere. Spacing uses Tailwind's 4 px scale. |
| DS-3 | Medium | Fixed  | Phase 7 merged them: 3 toggles → `Switch`, 6 bars → `ProgressBar`, 6 tiles → `StatCard`, 7 radio groups → `ChoiceGroup`/`useRovingRadio`, 8 link cards → `Card variant="interactive"`, hard-coded "←" links → `BackLink`. `TabNav` is used everywhere. |
| DS-4 | Medium | Fixed  | Phase 3: sliding indicators, snap scrolling and edge fades on `TabNav` and `Segmented` (which scrolls instead of wrapping into a grid). Phase 10: the admin tabs became a grouped side menu.                                                           |
| DS-5 | Medium | Fixed  | Phase 7: `Sheet` (bottom on phones with a drag handle and swipe to close, side sheet on wider screens) separate from `Dialog`; both animate in and out (phase 3).                                                                                      |
| DS-6 | Low    | Fixed  | Avatars and switches use tokens (phase 7). The hex values left are data, not styling: the colours a platform admin starts a new college with, and the contrast check in Branding. The story viewer stays a documented photographic exception.          |
| DS-7 | Medium | Fixed  | Phase 10: Suspend college sits apart with danger weight. Phase 11: Suspend and Revoke verification in Members are danger-toned and confirmed in a dialog that says what they do.                                                                       |

### 4.3 Typography

| ID   | Sev    | Status | How                                                                                                                                                                                   |
| ---- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TY-1 | High   | Fixed  | Phase 2 (quick win 8) gave the identity column a real basis; phase 8 rebuilt the profile header with a cover and a 96 px face.                                                        |
| TY-2 | Medium | Fixed  | Phase 2: `Badge` is sans by default with a `mono` option for records (batch, roll number, durations, scores).                                                                         |
| TY-3 | Medium | Fixed  | The smallest step is `text-caption` (12 px); bottom-bar labels are 12 px; the lint rule keeps it that way. The 360 px histogram is in §3.                                             |
| TY-4 | Low    | Fixed  | Phase 11: the job title has the full width (save and the menu moved beside Apply); the verification stepper names only the current step on phones; headings use `text-wrap: balance`. |
| TY-5 | High   | Fixed  | Phase 2 put Noto Sans Telugu in the mono stack; phase 5 chose Anek Telugu for every stack (ADR 0008) with looser Telugu line heights.                                                 |

### 4.4 Navigation and information architecture

| ID    | Sev      | Status | How                                                                                                                                                                                                                                                        |
| ----- | -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IA-1  | Critical | Fixed  | Phase 1: role-aware tabs from one model (`buildNav`): students Home, Study, Create, Mentors, Jobs; alumni get Requests; staff get Subjects and Review. Messages and Notifications are top-bar icons with counts.                                           |
| IA-2  | High     | Fixed  | Phase 1: the rail scrolls on its own, groups its sections, collapses to icons below 1280 px and pins the account menu; e2e checks every item at 1440×900, 1280×720 and 1024×768.                                                                           |
| IA-3  | High     | Fixed  | One model for every surface: tabs, rail, avatar menu, Create sheet, the palette's "Go to", the admin side menu and overview (phase 10) and the settings tabs (phase 11) all come from `buildNav()`.                                                        |
| IA-4  | High     | Fixed  | Phase 3: `BackLink` goes back with filters and scroll intact, or to the parent when opened from a link or notification.                                                                                                                                    |
| IA-5  | Medium   | Fixed  | Notifications open the item: posts, questions, events, roadmaps and materials did already; phase 11 added the request and the booked session (scrolled into view and outlined). A job alert opens its results; a badge opens the badge collection.         |
| IA-6  | Medium   | Fixed  | Phase 8: the next session sits under the stories on phones, with today's One Useful Thing as the one featured surface.                                                                                                                                     |
| IA-7  | Medium   | Fixed  | Phase 2: Forbidden explains itself and, when verification would open the page, says so and links to Verify.                                                                                                                                                |
| IA-8  | Medium   | Fixed  | Phase 1: sign-in returns to the page that asked for it (`safeReturnPath`, same-origin app paths only), with an e2e test.                                                                                                                                   |
| IA-9  | Low      | Fixed  | Phase 8: tapping a post's text opens it.                                                                                                                                                                                                                   |
| IA-10 | High     | Fixed  | Phase 1: each role lands on its home (the console for the platform admin); an e2e test per role.                                                                                                                                                           |
| IA-11 | Medium   | Fixed  | Event RSVP and calendar come first (phase 8); the roadmap's next steps open above the fold; Job Radar's level, type, branch and place sit behind a Filters button on phones (phase 11), so openings show on the first screen; the bars hide while reading. |
| IA-12 | Low      | Fixed  | Phase 8: from 1024 px the conversation list sits beside the thread; One Useful Thing is no longer repeated in the feed.                                                                                                                                    |

### 4.5 Nav bar scroll behaviour

| ID   | Sev    | Status | How                                                                                                                                                                                                                                                                                     |
| ---- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NB-1 | High   | Fixed  | Phase 3: both bars slide away while reading and return on any upward scroll, at the end of the page, on focus and on every new screen; reduced motion fades them. Phase 12: only the member's own scrolling hides them, so restoring a position on Back keeps the tab bar there to tap. |
| NB-2 | High   | Fixed  | Phase 2: bars are 93% opaque with 12 px labels; phase 3: the top bar is clear at the top and turns to glass with a hairline only once content runs under it.                                                                                                                            |
| NB-3 | Medium | Fixed  | Phase 1: re-tapping the active tab scrolls to the top, then refreshes; phase 3: tabs remember their screen; phase 11: pull to refresh.                                                                                                                                                  |
| NB-4 | Medium | Fixed  | Phase 2 and 3: rows fade at an edge with more, keep the active item in view (without scrolling the page, phase 11) and show arrows on pointer devices; phase 10 replaced the admin pill bar.                                                                                            |
| NB-5 | Medium | Fixed  | Phase 2: toasts sit above the tab bar on phones.                                                                                                                                                                                                                                        |
| NB-6 | Low    | Fixed  | The one gap (the offline banner) is PW-9.                                                                                                                                                                                                                                               |

### 4.6 Screen-to-screen transitions

| ID   | Sev      | Status | How                                                                                                                                                                                                                                                                                                     |
| ---- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR-1 | Critical | Fixed  | Phase 1: no per-route spinners; the current screen stays with a thin progress bar after 150 ms; a content-area skeleton only on a cold start or a slow read. §5 shows no spinner frames in any journey.                                                                                                 |
| TR-2 | Critical | Fixed  | Phase 3: route loaders start data with code; intent prefetch warms code and data; detail screens seed from the list row. §5 shows the data-waited-for-code pattern gone.                                                                                                                                |
| TR-3 | High     | Fixed  | Phase 2: exact scroll restoration on Back, per-tab positions, new screens at the top; phase 11 stopped tab rows from scrolling the page to themselves. e2e tests cover each case.                                                                                                                       |
| TR-4 | High     | Fixed  | Phase 3: view transitions: push slides in, Back reverses, tabs crossfade, shared elements morph (avatar, job title, post); a short crossfade under reduced motion. Phase 12: skipped on devices too slow to animate them smoothly (low-end, or three 200 ms tasks), where they cost 300–500 ms per tap. |
| TR-5 | High     | Fixed  | Phase 1: the progress bar acknowledges every navigation that takes longer than 150 ms.                                                                                                                                                                                                                  |
| TR-6 | Medium   | Fixed  | Phases 1 and 3: every sheet and dialog is a history entry, so Back closes it.                                                                                                                                                                                                                           |

### 4.7 Feedback and states

| ID   | Sev      | Status       | How                                                                                                                                                                                                                                                                                                         |
| ---- | -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ST-0 | Critical | Fixed        | Phase 1: `importWithRetry`, one guarded reload, error elements at every level; e2e tests block a chunk, go offline and simulate a stale deploy.                                                                                                                                                             |
| ST-1 | Critical | Fixed        | Phase 1: no viewport-height fallbacks inside the shell.                                                                                                                                                                                                                                                     |
| ST-2 | High     | Fixed        | Phase 10 (moderation, analytics, imports, sources) and phase 11: 35 screens mark their main read, so a failure shows the error screen inside the shell with Retry, and a deleted item reads "We couldn't find that page"; e2e tests for both.                                                               |
| ST-3 | Medium   | Fixed        | Phase 2: Rewards, redemptions, event Q&A and attendees wait for data before an empty state.                                                                                                                                                                                                                 |
| ST-4 | High     | Fixed        | Phase 3: sending a message, accepting or declining, RSVP and marking a step are optimistic with rollback; follows (phase 8).                                                                                                                                                                                |
| ST-5 | Medium   | Fixed        | Confirmation toasts (phase 3) and the ADR 0008 celebrations (phase 8) for accepted requests, steps, badges and referrals.                                                                                                                                                                                   |
| ST-6 | Medium   | Partly fixed | The feed, lists, and the content-area skeleton follow the layout they stand for (`PostSkeleton`, `PageSkeleton`); because route loaders now hold the previous screen until data arrives, most skeletons never show. A few form and panel placeholders are still plain blocks; they show only on slow reads. |
| ST-7 | —        | Kept         | Still true, and extended.                                                                                                                                                                                                                                                                                   |

### 4.8 Motion

| ID   | Sev    | Status | How                                                                                                                                                               |
| ---- | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MO-1 | High   | Fixed  | Phase 8: one `celebrate()` helper (aurora burst ≤ 1.2 s, still glow under reduced motion, once per device) for the ADR 0008 moments; haptics only when turned on. |
| MO-2 | High   | Fixed  | Phase 3: view transitions on every navigation.                                                                                                                    |
| MO-3 | Medium | Fixed  | Phase 2: one reduced-motion source (`useReducedMotionPref`, the in-app setting first).                                                                            |
| MO-4 | Medium | Fixed  | Phase 2: story progress is a compositor `scaleX` animation.                                                                                                       |
| MO-5 | Low    | Fixed  | Phase 7: the roadmap bar no longer animates `width`; motion animates transform and opacity only. Hover colour changes remain, as the audit noted they are cheap.  |
| MO-6 | Low    | Fixed  | Phase 3: sheets rise and dialogs scale in and out.                                                                                                                |
| MO-7 | Low    | Fixed  | Phase 4: `LazyMotion` with features in their own chunk; direct `motion/react` imports are a lint error.                                                           |

### 4.9 Forms and input

| ID   | Sev    | Status | How                                                                                                                                                                                                                   |
| ---- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FO-1 | High   | Fixed  | Phase 8 (owner decision Q12): session type and time, then one message with optional Goal / Background / What I need headings; the API accepts both shapes.                                                            |
| FO-2 | Medium | Fixed  | Phase 11: `FormFooter` keeps the actions of the profile, post-an-opening, event and roadmap-editor forms above the tab bar on phones and sticky on desktop. The mentor dashboard keeps a short Save inside each card. |
| FO-3 | Medium | Fixed  | Phase 11: every form validates a field when it is left (`onTouched`).                                                                                                                                                 |
| FO-4 | Medium | Fixed  | Phase 2: `enterKeyHint` on search, the palette and chat; numeric fields use `inputMode="numeric"`.                                                                                                                    |
| FO-5 | Medium | Fixed  | Phase 11: `useDraft()` keeps composer and comment text across closing and navigating (memory only, cleared on sign-out).                                                                                              |
| FO-6 | Low    | Fixed  | The verification code (phase 8) and the two-factor codes at sign-in and setup (phase 11) send themselves on the sixth digit.                                                                                          |
| FO-7 | —      | Kept   | Still true.                                                                                                                                                                                                           |

### 4.10 Accessibility

| ID      | Sev    | Status | How                                                                                                                                                                                                                          |
| ------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11Y-1  | High   | Fixed  | Phase 2: `--danger-fill`/`--on-danger`; phase 5: every label on a fill is contrast-tested at 4.5:1 for any college colour (`palette.test.ts`).                                                                               |
| A11Y-2  | Medium | Fixed  | Phase 2, then the phase 7 `ChoiceGroup` with tested inks on brand surfaces.                                                                                                                                                  |
| A11Y-3  | Medium | Fixed  | Phase 2, then the `Table` primitive: a focusable, labelled region that contains its own width.                                                                                                                               |
| A11Y-4  | High   | Fixed  | Phases 2 and 11 (`.grid` gets one shrinkable column) and 12 (table scrollers are positioned, so hidden labels cannot widen the page); the 360 px re-audit finds no overflow on any of 78 screens (§3).                       |
| A11Y-5  | Medium | Fixed  | Reactions and save are 44 px (phase 8); phases 11 and 12 raised checkboxes, links and toggles. On the 23 screens both audits measured, targets under 44 px fell from 228 to 41 and under 24 px from 81 to 0 not exempt (§3). |
| A11Y-6  | High   | Fixed  | Phase 2: `Button` stays focusable while loading; the request confirmation takes focus.                                                                                                                                       |
| A11Y-6b | Medium | Fixed  | Phase 3: focus moves to the screen's heading and the document title follows it; Back returns focus to the link you followed.                                                                                                 |
| A11Y-7  | Low    | Fixed  | Phase 1: ⌘K on Apple devices.                                                                                                                                                                                                |
| A11Y-8  | —      | Owner  | Still not verified with NVDA, VoiceOver or TalkBack, Telugu speech or 200% zoom on real devices; listed for the owner in the final report.                                                                                   |

### 4.11 Performance as experienced

| ID   | Sev      | Status       | How                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PF-1 | Critical | Partly fixed | Initial JS 301 → 169 KB gzipped (phase 4, held since), enforced in CI; the college lookup, session refresh, screen code and first data start together. The installed app and the public pages now score 81–93; a first visit on a cold cache still has an LCP of 4–5 s at simulated 4× CPU (§3).                                                                                  |
| PF-2 | High     | Fixed        | Phase 3: route loaders and intent prefetch.                                                                                                                                                                                                                                                                                                                                       |
| PF-3 | High     | Fixed        | Phase 2: detail screens seed from the list row (`query-seed.ts`).                                                                                                                                                                                                                                                                                                                 |
| PF-4 | Medium   | Fixed        | `staleTime` 30 s; feeds and inboxes refresh when the app is resumed; tab reselect and pull to refresh refresh on demand.                                                                                                                                                                                                                                                          |
| PF-5 | Medium   | Partly fixed | Videos now stream from five-minute signed links with range requests (phase 11, owner decision Q9). Images keep the authenticated download, cached for the session: a signed link per image would add a request per image and still not survive a relaunch, because every link is unique. Caching images across launches needs a decision on how private media may be cached (D5). |
| PF-6 | Low      | Fixed        | See MO-7.                                                                                                                                                                                                                                                                                                                                                                         |

### 4.12 Mobile and PWA feel

| ID   | Sev    | Status       | How                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PW-1 | High   | Fixed        | Phase 2: first paint follows the device; `boot.js` applies a saved theme before the app loads; light and dark `theme-color`.                                                                                                                                                                                                                                     |
| PW-2 | High   | Fixed        | Phases 1 and 3: sheets and dialogs are history entries.                                                                                                                                                                                                                                                                                                          |
| PW-3 | Medium | Fixed        | Phase 11: the API serves a manifest per college (its name, short name, canvas colour and logo icon).                                                                                                                                                                                                                                                             |
| PW-4 | Medium | Partly fixed | Phase 11: pull to refresh with an aurora indicator, no tap flash, no rubber-banding or browser reload on pull. Not done: iOS splash images (one image per device size per college, generated from each college's logo) and an iOS status-bar style (`black-translucent` would put a white clock over the light theme); both need checking on real iPhones first. |
| PW-5 | Medium | Deferred     | Keeping copies of the feed, sessions and messages on the device for offline use would store members' private data in the browser beyond the session; that is a privacy decision for the owner (D5). Offline today: code is precached, visited screens keep working, and unvisited ones show a friendly offline state.                                            |
| PW-6 | Medium | Partly fixed | See PF-5.                                                                                                                                                                                                                                                                                                                                                        |
| PW-7 | —      | Kept         | Still true.                                                                                                                                                                                                                                                                                                                                                      |
| PW-8 | High   | Fixed        | Phase 1, client only: single-flight refresh across tabs (Web Locks), adoption of another tab's token, `keepalive`; the finding no longer reproduces, so no server change was needed (D1).                                                                                                                                                                        |
| PW-9 | Medium | Fixed        | Phase 1: the offline notice is a pill above the tab bar and never covers the top bar.                                                                                                                                                                                                                                                                            |

### 4.13 Microcopy and tone

| ID   | Sev    | Status | How                                                                                  |
| ---- | ------ | ------ | ------------------------------------------------------------------------------------ |
| MC-1 | Medium | Fixed  | Phase 2: stale phase copy removed in both languages.                                 |
| MC-2 | Low    | Fixed  | Phase 11: "Search people, posts, jobs and more, or type a command…".                 |
| MC-3 | Low    | Fixed  | Phase 8: the score is a ring and a word ("Strong match") with the reasons.           |
| MC-4 | Low    | Fixed  | Phase 2: no exclamation marks in decline templates.                                  |
| MC-5 | Low    | Fixed  | Phase 2 (Forbidden) and phase 11 ("You're all caught up" offers a way back to Home). |

## 5. Navigation seamlessness: the journeys again

Same ten journeys as audit §5, on a 360 × 780 phone, dark, as Ananya (and Sneha for J6), each run on fresh demo data. Times are from the tap (a finger down, or Back and Forward) to the first frame where the destination's loaded state is visible with no skeleton in the content area and no navigation in progress. "Throttled" is Lighthouse's mobile profile (4× CPU, 150 ms, 1.6 Mbps down, 750 kbps up); "unthrottled" is this container at full speed. Raw data: `data-after/journeys.json` and `journeys-unthrottled.json`.

| Journey                         | Step                             |     Throttled | Unthrottled | Spinner frames | Empty `main` frames | Data waited for code | Scroll after |
| ------------------------------- | -------------------------------- | ------------: | ----------: | :------------: | :-----------------: | :------------------: | -----------: |
| J0 Cold start                   | reload home                      | 2,893 → 3,915 | 659 → 1,075 |     77 → 0     |       82 → 73       |       yes → no       |        0 → 0 |
| J1 Home → post → back           | open post                        |     847 → 709 |   422 → 218 |     19 → 0     |       30 → 0        |       yes → no       |        0 → 0 |
|                                 | back home                        |     556 → 731 |   101 → 146 |     0 → 0      |        0 → 0        |       no → no        |    222 → 900 |
| J2 Mentors → request            | tab mentors                      |     726 → 762 |   553 → 198 |     19 → 0     |       19 → 0        |       yes → no       |        0 → 0 |
|                                 | browse                           |     508 → 474 |   124 → 111 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
|                                 | open mentor                      |     739 → 465 |   151 → 103 |     0 → 0      |       12 → 0        |       yes → no       |        0 → 0 |
|                                 | send request ¹                   |     466 → 319 |   120 → 166 |     0 → 12     |        0 → 0        |       no → no        |     23 → 177 |
|                                 | back after booking               |      90 → 447 |     21 → 83 |     0 → 0      |        0 → 0        |       no → no        |    137 → 911 |
| J3 Tab switching                | r0 home                          |     525 → 664 |   150 → 113 |     0 → 0      |        0 → 0        |       no → no        |    137 → 900 |
|                                 | r0 jobs                          |     764 → 691 |   430 → 184 |     18 → 0     |       18 → 0        |       yes → no       |        0 → 0 |
|                                 | r0 study (was r0 roadmaps)       |     696 → 381 |    130 → 44 |     0 → 0      |        0 → 0        |       yes → no       |        0 → 0 |
|                                 | r0 mentors                       |     322 → 286 |     70 → 44 |     0 → 0      |        0 → 0        |       no → no        |      0 → 911 |
|                                 | r1 home                          |     541 → 667 |    117 → 95 |     0 → 0      |        0 → 0        |       no → no        |      0 → 900 |
|                                 | r1 jobs                          |     464 → 466 |     83 → 89 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
|                                 | r1 study (was r1 roadmaps)       |      293 → 20 |     100 → 9 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
|                                 | r1 mentors                       |     204 → 296 |     73 → 40 |     0 → 0      |        0 → 0        |       no → no        |      0 → 911 |
|                                 | rapid fire ¹                     |     3,533 → 4 |  2,444 → 14 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
| J4 Jobs → job → back            | open job                         |     647 → 906 |   133 → 119 |     0 → 0      |       13 → 0        |       yes → no       |        0 → 0 |
|                                 | back to list                     |     223 → 639 |    42 → 108 |     0 → 0      |        0 → 0        |       no → no        |  1898 → 1400 |
| J5 Roadmap → step → back        | open roadmaps (was tab roadmaps) |   416 → 1,274 |    84 → 240 |     0 → 0      |        0 → 0        |       no → no        |     1898 → 0 |
|                                 | open roadmap                     |     758 → 681 |   160 → 109 |     0 → 0      |       15 → 0        |       yes → no       |        0 → 0 |
|                                 | open step                        |     395 → 284 |    164 → 65 |     0 → 0      |        0 → 0        |       no → no        |      325 → 0 |
|                                 | back gesture with panel open ¹   |         – → 9 |     – → 125 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
| J7 Profile → save               | open profile                     |     826 → 430 |    431 → 88 |     14 → 0     |       25 → 5        |      yes → yes       |        0 → 0 |
|                                 | save ¹                           |       337 → 4 |      92 → 6 |     0 → 0      |        0 → 0        |       no → no        |     1480 → 0 |
| J8 First visits                 | events first visit               |     781 → 571 |   410 → 142 |     18 → 0     |       18 → 0        |       yes → no       |        0 → 0 |
|                                 | progress first visit             |     800 → 824 |   413 → 157 |     20 → 0     |       31 → 0        |       yes → no       |        0 → 0 |
|                                 | people first visit               |     769 → 661 |   455 → 125 |     19 → 0     |       19 → 0        |      yes → yes       |        0 → 0 |
| J9 Back and forward             | back to progress                 |     133 → 244 |     38 → 40 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
|                                 | back to events                   |      57 → 198 |     21 → 28 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
|                                 | forward to progress              |     152 → 190 |     23 → 43 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |
| J6 Notification → item (mentor) | open notifications               |     810 → 520 |   155 → 200 |     0 → 0      |        0 → 0        |       yes → no       |        0 → 0 |
|                                 | open item                        |     745 → 116 |   402 → 142 |     17 → 0     |       17 → 0        |       yes → no       |        0 → 0 |
|                                 | accept request ¹                 |     482 → 131 |     163 → 1 |     0 → 0      |        0 → 0        |       no → no        |        0 → 0 |

¹ An acknowledgement on the same screen (a confirmation, a toast, a sheet closing) or four taps in a row, not a new screen: the destination is on screen almost at once now, where before the app re-rendered or queued.

Reading the table:

- **Spinners and blank screens are gone.** Every first visit used to show about 0.3 s of a viewport-tall spinner and then skeletons; now the current screen stays (with a thin progress bar after 150 ms) until the next one has its code and first data.
- **Data no longer waits for code** except on two screens (Profile, People), whose first read depends on the member's own record.
- **Most taps are as quick or quicker**, throttled and unthrottled. The exceptions are Back to Home and to Jobs (0.6–0.7 s throttled, against 0.2–0.6 s) and Roadmaps opened from the account menu (1.3 s, against 0.4 s as a bottom tab): those screens render far more than they did (stories, the next session, today's One Useful Thing, richer cards; the Galaxy), and on a 4× slower CPU that rendering is most of the time. Unthrottled, every one of them is under 0.25 s.
- **Scroll after Back is exact** (900 px on Home, the 1,400 px Jobs was left at), and focus moves to the new screen's heading.
- **View transitions are adaptive.** In this container both runs took the no-animation path (the main thread had shown three 200 ms tasks); with transitions forced on, the same throttled steps took 300–500 ms longer (Back to Events 750 against 432 ms, the Home tab 1,252 against 731 ms), which is why devices that cannot afford them skip them. A phone that can animates every screen change.
- **J0, the cold start,** is measured to a fully loaded Home (feed, stories and today's card with no skeleton left), stricter than the audit's first post on screen; Lighthouse's first-visit rows in §3 are the better comparison.

## 6. Per-role experience (audit §7)

| Role                       | Then                                                                                                               | Now                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Student                    | Sessions and Messages hidden in More; no "today" on a phone; nothing celebrated; deep links lost at sign-in.       | Home, Study, Create, Mentors, Jobs; Messages and Notifications in the top bar with counts; the next session under the stories with a live countdown and a glowing Join; celebrations for an accepted request, a step done and a badge; deep links survive sign-in. |
| Alumni                     | The student's tabs; Requests and Mentoring 9th and 10th in More; the Mentoring dashboard overflowed at 360 px.     | Home, Requests (with a count), Create, Mentors, Jobs; Home leads with the mentor card ("2 requests are waiting for your reply") and the next session; Accept celebrates; the dashboard fits at 320 px.                                                             |
| Faculty and TPO            | The student feed and tabs; Admin last of 21 items; moderation as a 2 × 2 grid; failed queues looked empty.         | Home, Subjects, Create, Review, Jobs; the admin overview shows "What's waiting" with a count per queue; moderation queues are tabs with counts and error states; Study gives them subjects, uploads and insights.                                                  |
| College admin              | Thirteen admin tabs in one row with the active one off screen; Users as the admin home; three colours of branding. | An overview with queue counts, members, activity and the AI assistant's state; a grouped side menu on desktop; logo upload; each college installs as itself; the AI assistant's set-up checklist.                                                                  |
| Platform admin             | "We couldn't find that page." after every sign-in; Suspend college a plain text button.                            | Lands on the console; Suspend college sits apart with danger weight and a confirmation; monograms readable on any colour.                                                                                                                                          |
| Unverified and contributor | Stale "arrives next" copy; gated pages said only "You don't have access".                                          | The verification flow is a three-step hero with the code sending itself; gated pages say verification opens them and link to it.                                                                                                                                   |

## 7. What is left

Everything here is either a decision for the owner, something only real devices or people can verify, or a gap stated above. The final report repeats it with what to do.

- **Performance on a cold first visit** (§3): an LCP of 4–5 s at simulated 4× CPU. The installed app and the public pages are inside the brief's budget.
- **Owner decisions:** keeping copies of members' data on the device for offline use and a faster cold start (PW-5); how private media may be cached across launches (PF-5, PW-6); whether the read-only `GET /admin/overview` (phase 10) may stay; whether faculty may ever read students' conversations (`facultySeeChats`, stored but inert).
- **Real devices:** iOS splash images and status-bar style (PW-4), pull to refresh, the installed app's name and icon per college, the back gesture, low-end Android.
- **People:** screen readers (NVDA, VoiceOver, TalkBack), Telugu speech, 200% zoom, and a native speaker's review of the Telugu.
- **Shaped skeletons** for the few forms and panels that still show plain blocks on slow reads (ST-6).

## 8. Method, coverage and limits

The audit's method (`audit.md` Appendix A), re-run on the revamped production build with the scripts in `apps/web/e2e/audit/`, which the audit deleted and the revamp recreated from its description. They run against `vite build` + `vite preview` (production CSP) and the API with the seeded demo data, in the same container class, Chromium and throttling as the audit, so the numbers compare before and after rather than against field data (±15% between runs).

| Script                | What it does                                                                                                                                                                                                                                                                                            | Writes                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `capture.audit.ts`    | Signs in as every demo role (TOTP for admins), visits every main screen at 360 × 780 (DPR 2, touch) and 1440 × 900 in both themes on both colleges and the platform console, with Telugu variants; runs axe on every 360 px screen in both themes; measures targets, type sizes and overflow at 360 px. | `after/`, `data-after/axe*.json`, `touch-targets-360.json`, `capture-failures.json` |
| `extras.audit.ts`     | Desktop rail reach at 1440 × 900, 1280 × 720 and 1024 × 768; offline navigation to an unvisited screen; Telugu fonts and line heights; scroll memory and the scroll-aware bars.                                                                                                                         | `desktop-rail.json`, `offline.json`, `telugu.json`, `scroll-memory.json`            |
| `journeys.audit.ts`   | Journeys J0–J9 on a 360 × 780 phone, dark, throttled (4× CPU, 150 ms, 1.6 Mbps / 750 kbps) and unthrottled, with a per-frame probe from the tap.                                                                                                                                                        | `journeys.json`, `journeys-unthrottled.json`                                        |
| `lighthouse.audit.ts` | Lighthouse 12.8.2, mobile preset, signed in through a persistent profile; cold runs clear the service worker, Cache Storage and HTTP cache, warm runs visit once first. Adds Study.                                                                                                                     | `lighthouse/*.json.gz`, `lighthouse-summary.json`                                   |
| bundle (from `dist/`) | Initial and per-screen chunk sizes from Vite's manifest, gzip level 9 as the audit measured (CI's budget script uses level 6).                                                                                                                                                                          | `bundle.json`, `route-chunks.json`, `bundle-budget.json`                            |

In-app screenshots are colour-quantised to 256 colours, as in `before/`; public pages are lossless. No two-factor set-up screen is captured, so no QR code or key appears.

**Changes to the probes, all stated:** a checkbox or radio inside its label is measured by the label; a link stretched over its card is measured by the card; links in running text, skip links, chart columns (the chart's table is the equivalent control) and focusable panels that are not pointer targets are listed as exempt (WCAG 2.5.8), and both the raw and the non-exempt counts are reported. The overflow check stops at `body`, which clips sideways.

**Still not verified** (and on the owner's list in the final report): real iOS and Android devices (the installed app, the notch, the real back gesture, pull to refresh on glass), screen readers (NVDA, VoiceOver, TalkBack) and Telugu speech, 200% text zoom, push notifications, and a native speaker's review of the Telugu.
