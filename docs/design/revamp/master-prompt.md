# MASTER PROMPT: CampusLink — World-Class UI/UX Revamp, Audit Fixes and AI Study Assistant

You are a principal product designer and senior front-end engineer working inside the CampusLink monorepo. Your mission:

1. Fix every problem found in the UI/UX audit.
2. Transform `apps/web` into a world-class product: one of the most beautiful, smooth and delightful apps a college student has ever used, with refined colour, typography, motion and craft on every screen.
3. Build the new AI Study Assistant feature (Appendix A) inside that same design language.

Keep every security, privacy, tenancy and accessibility rule in this repo intact throughout.

## Step 0: Set up (do this before anything else)

1. **Branch:** start from the branch containing the audit commit (`f05e94c`, branch `claude/optimistic-hawking-t1sggg`) so `docs/design/revamp/` is present. If your session has a branch rule, follow it; otherwise follow `CLAUDE.md`.
2. **Save the feature spec:** copy Appendix A of this prompt, verbatim, into `docs/specs/ai-study-assistant.md`.
3. **Save this prompt:** copy everything in this prompt above Appendix A into `docs/design/revamp/master-prompt.md`.
4. **Create a progress log** at `docs/design/revamp/progress.md` listing every phase in section 12 with a status. After every phase, update it with what was done, decisions made, deviations and what comes next. If you are a new session picking up this work, read `progress.md` first and resume from the first unfinished phase.
5. Commit these three files (`docs: add revamp master prompt, study assistant spec and progress log`) and push.

## Decisions already made (do not re-open these)

- **D1. Silent sign-outs (audit finding PW-8):** fix on the client first.
  - Make token refresh single-flight: one refresh request at a time, with every waiting request reusing its result.
  - Coordinate refreshes across tabs with the Web Locks API (fall back to BroadcastChannel).
  - Never abort an in-flight refresh when the user navigates or a component unmounts.
  - Do NOT change server-side refresh-token rotation or reuse detection, and do not add a grace window.
  - If PW-8 still reproduces after the client fix, stop. Write up the evidence and a proposed server change, then wait for my approval. The proposal should be a grace window of at most 10 seconds that returns the same successor tokens for the same token family, with reuse after the window still revoking the family and every use audit-logged.
- **D2. Role-aware navigation:** yes (section 7).
- **D3. Landing page social proof:** remove the ten fictional "verified" alumni for every tenant. Show no testimonials or member counts until they are real; only real aggregates through `suppress()` may appear, and only when meaningful.
- **D4. Profile placement:** profile, settings and sign-out live behind the avatar in the top bar for every role, freeing a tab for each role's most-used destination.
- **D5. Remaining open questions in the audit (§10):** write your recommended answer for each into `docs/design/revamp/decisions.md` and proceed with it. The exception is anything touching security, authentication, privacy, tenancy, or what data is collected or shown: for those, stop and ask me.

## 0. Read before you touch anything

1. Read `CLAUDE.md` fully. Its priority order holds: security and privacy → correctness → speed → delight. Delight is this project's goal, never at the cost of the first three.
2. Read `docs/design/revamp/audit.md` in full, plus its evidence in `before/`, `frames-sheets/`, `clips/` and `data/`. **The audit is your requirements document.** Every Critical and High finding must be fixed, all 24 quick wins must ship, and the final summary must state how each finding was addressed (fixed, deferred with reason, or won't fix with reason).
3. Read `docs/specs/ai-study-assistant.md`, the design brief and ADRs in `docs/`, `apps/web/src/styles/tokens.css`, `index.css`, `components/ui/`, `app/`, every `features/<n>/`, `packages/shared/src/brand.ts` and `applyBranding()`.
4. Run `pnpm dev` and `pnpm seed` and use the app as every demo role on both tenants and the platform console.

## 1. What the audit found

- **Transitions score 1/5.** Every first visit to a screen shows a spinner, then a skeleton, then content. Data is fetched only after the route's code arrives, costing 0.65–0.85 s per first visit on a throttled phone.
- **No error boundaries.** A screen that can't load its code (offline, or after a deploy) replaces the whole app with React Router's raw error page.
- **Scroll position isn't managed.** Back from a post lands Home at 222 px instead of 900 px.
- **Navigation is identical for every role.** The bottom bar shows four student tabs to everyone. On a 1440×900 desktop the rail doesn't scroll, so Notifications, Profile, Settings, Search and Sign out are unreachable.
- **Performance:** first load is 301 KB of gzipped JS against a 170 KB budget. Signed-in Lighthouse mobile scores are 54–70, with LCP of 4.1–4.9 s.
- **Credibility:** platform admins land on "We couldn't find that page" after every sign-in, and the landing page shows ten fictional "verified" alumni to every college.
- **Silent sign-outs** from an aborted token refresh (PW-8).
- Design system, navigation, feedback, motion, performance and per-role experience all score 2/5. Microcopy is strongest at 4/5; keep its tone.
- `data/` holds 282 axe scans and a touch-target report. Fix every violation and every target under 44px.

## 2. Who we are designing for

- **Students (18–22, mostly Indian engineering colleges):**currently a web app but actually a  mobile-first, often mid-range Android on patchy 4G, fluent in Instagram and YouTube, anxious about careers. It must feel as fun as Instagram, as useful as LinkedIn, and as focused as a great study app. Reaching a senior must feel safe.
- **Alumni (working professionals, time-poor):** they open it from a notification, act in under 60 seconds and leave. Mentoring should feel Topmate-grade, respect their time and make their impact visible and shareable.
- **Faculty, TPO and college admins (desktop, data-heavy):** calm, legible, trustworthy screens with clear tables, filters, uploads and printable analytics. No gimmicks.
- **Platform super admin:** a clean, neutral console clearly distinct from any college's branded space.
- **Telugu readers:** every screen must look intentional in `te`, not just "not broken."

## 3. Design direction: "Campus Aurora"

**A calm, premium canvas where each college's own colour comes alive as a soft aurora at the moments that matter.**

### Principles
1. **Calm canvas, vivid moments.** About 90% of the UI is quiet tinted neutrals with excellent typography. Colour and motion are spent on progress and connection.
2. **Every college feels like its own place.** The tenant colour drives the whole palette, and every college looks equally premium.
3. **Familiar patterns, elevated craft.** Stories, bottom tabs, swipe, double-tap, pull to refresh and sheets, won on polish rather than novelty.
4. **People first.** Faces, names, branches, batches and companies are hero content.
5. **Honest delight.** Never fake numbers, activity or social proof.

Borrow interaction patterns from Instagram, LinkedIn, Topmate and modern study apps, never their visual identity, logos or signature layouts.

### Signature moments (these must be unforgettable)
- The "You're in" moment at the end of verification.
- Story rings and the full-screen story and reels viewer.
- A mentor accepting your request.
- "Join video" glowing to life when a session opens.
- The Career Galaxy.
- Finishing a roadmap step, earning a badge, a streak milestone.
- The shareable alumni impact card.
- A study answer streaming in with citations that open the exact page.
- Completing a `/quiz`.

### The world-class bar (check every screen against this)
- One clear primary action per screen; everything else is visually secondary.
- A 4px spacing grid with consistent rhythm; generous whitespace around hero content.
- At most three text sizes and two weights per card or component.
- `text-wrap: balance` on headings and `text-wrap: pretty` on paragraphs, with no orphaned words in titles.
- Icons optically aligned with text; consistent 1px hairlines; consistent radii.
- Every interactive element has designed hover, pressed, focused, disabled and loading states.
- Dark mode is designed, not inverted: check every screen in both themes.
- Reading line length around 60–75 characters for long text.
- Before finishing any screen, compare its screenshot with its audit "before" shot and ask: would this be featured on a design showcase? If not, refine it.

## 4. Colour system (OKLCH, generated from the tenant hue)

Rebuild `tokens.css` around OKLCH.
- **Input:** the tenant colour from `applyBranding()`. Extract its OKLCH hue `h`, falling back to `h = 275` (indigo-violet).
- **Clamp ugly inputs:** the generated brand primary stays within lightness 0.55–0.68 and chroma 0.12–0.20. The college's exact colour is used only for its logo.
- **Neutrals tinted by `h`** (chroma 0.004–0.014):
  - Light: canvas ≈ `oklch(0.985 0.005 h)`, surface-1 ≈ `oklch(1 0 0)`, surface-2 ≈ `oklch(0.965 0.008 h)`, borders ≈ `oklch(0.91 0.01 h)`.
  - Dark (rich, not pure black): canvas ≈ `oklch(0.16 0.012 h)`, surfaces stepping to ≈ 0.19, 0.225, 0.26, hairline borders ≈ `oklch(1 0 0 / 0.08)`.
- **Brand ramp** 50–950 from `h`, keeping `*-ink` tokens at 5.5:1 or better.
- **Aurora signature gradient** at hues `h`, `h + 45`, `h + 100`. Provide a linear variant, an animated mesh variant for heroes (static fallback), and a 1px aurora gradient border for featured cards (via mask). Use it ONLY for:
  - story rings, XP and streaks, badges;
  - the "One Useful Thing" hero and the onboarding hero;
  - celebrations and the active Career Galaxy constellation;
  - the Study "Ask" button;
  - the slow-navigation progress bar.
- **Fixed semantic colours:** success (hue ≈ 150), warning (≈ 75), danger (≈ 25), info (≈ 235), each with surface, border, fg and ink variants in both themes.
- **Role accents** (subtle chips only) for student, alumni, faculty/TPO and admin, always paired with an icon or label.
- **Subject accents:** a fixed set of 8 hue offsets from `h` with fixed lightness and chroma, so subjects are recognisable at a glance and every set stays harmonious.
- **Chart palette:** 6 categorical colours with fixed lightness and chroma for accessible analytics, distinguishable without colour alone (patterns or labels).
- **Interaction tokens:** focus ring (2px brand plus 2px canvas offset), text selection colour, scrim for sheets and modals, hover and pressed overlays.
- Add a test that generates palettes for at least 8 hues (maroon, navy, saffron, forest green, neon lime, pure red, teal, purple) and asserts contrast in both themes.

Components use tokens only (`bg-surface-1`, `text-fg-2`, `text-brand-ink`, plus new ones like `bg-aurora`). Fix every raw value in the audit's grep inventory.

## 5. Typography, shape, depth and icons

- Self-host all fonts (e.g. `@fontsource`). Never add a font CDN; it breaks the production CSP.
- Pairing (open licences):
  - a characterful display grotesque (e.g. Bricolage Grotesque or Geist);
  - a legible UI face (e.g. Inter or Geist);
  - Anek Telugu or Noto Sans Telugu, with matched weight and x-height.
  
  Test both languages side by side and record the choice in an ADR. Subset fonts and preload only what the first screen needs.
- Fluid type scale with `clamp()` (about 8 steps). Headlines may be big and confident on Home, Profile, Galaxy, Events, Study and onboarding. Use tabular numerals for stats and times, and a larger line height under `:lang(te)`.
- Radius scale 6 / 10 / 14 / 20 / 28 / full (cards ≈ 20, sheets ≈ 28, chips full).
- Depth:
  - Light mode: soft layered shadows on an elevation scale of 0–4.
  - Dark mode: lighter surfaces plus a 1px inner highlight instead of shadows.
- Glass only on floating chrome: the top bar when scrolled, the bottom tab bar, sheets, Cmd+K, the slash-command popover and story viewer controls. Provide solid fallbacks under `prefers-reduced-transparency` and on low-end devices (`navigator.hardwareConcurrency`, `deviceMemory`).
- One icon family, one stroke weight, filled variants for active tabs. Import icons individually.

## 6. Motion language

Use the existing `motion` library with `LazyMotion`. Animate transform and opacity only, and scale everything by `--motion-scale`.
- Spring presets as tokens: `snappy` (buttons, toggles), `smooth` (sheets, cards), `bouncy` (celebrations only).
- Micro-interactions:
  - reaction bursts, double-tap to react, bookmark fill;
  - pull to refresh with a branded indicator;
  - press scale 0.97;
  - list stagger on first load only.
- Celebrations (badge, request accepted, step done, referral, streak milestone, quiz complete): an aurora burst of at most 1.2 s, never blocking, replaced by a static highlight under reduced motion.
- Optional haptics via `navigator.vibrate` for confirmations only, behind a setting.

## 7. App shell and role-aware navigation

- **Derive navigation from permissions** in `packages/shared`, with one nav config per role. Never hard-code tabs per screen.
  - Student: Home, Study, Create, Mentors, Jobs.
  - Alumni: Home, Requests (badge count), Create, Mentors, Jobs.
  - Faculty and TPO: Home, Subjects (their library and uploads), Create, Review (moderation, roadmaps, contributor materials), Jobs. Admin entry points sit in the avatar menu.
  - College admin: same as faculty, plus Admin (including AI Assistant settings) in the avatar menu.
  - Platform super admin: the separate platform console, never tenant tabs.
  - Roadmaps, Events, Q&A, Progress and Sessions are reachable from Home and the avatar menu for everyone with access.
- **Fix the platform admin sign-in:** every role lands on its correct home after sign-in. Add an e2e test per role asserting the landing route.
- **Mobile:** floating glass bottom tab bar with the centre Create button (aurora) opening a composer sheet.
- **Desktop:**
  - A sticky, full-height left rail that scrolls on its own (`overflow-y: auto`), with primary destinations at the top and the avatar menu always visible. It collapses to an icon rail below 1280px wide.
  - Add an e2e test that every rail item is reachable at 1440×900, 1280×720 and 1024×768.
  - A centred content column (about 640px for feeds) and a contextual right column on wide screens: upcoming session, suggested mentors, trending jobs, streak, and the next study topic.
- **Top bar:** college logo and name, search trigger (Cmd+K), notifications with a live count, avatar menu.
- **Cmd+K:** a glass sheet with grouped results (people, jobs, roadmaps, events, subjects, materials, actions, and the Study slash commands), recent searches and keyboard hints; full-screen on mobile.

## 7a. Intuitive nav bar scrolling

- **Scroll-aware chrome:**
  - Scrolling down past about 56px collapses the top bar (large title → compact) and slides away the bottom tab bar.
  - Any upward scroll brings both back immediately. Use an 8px threshold against jitter.
  - Animate with `transform` only, from one passive scroll listener throttled to animation frames.
- **Material change:** transparent at the top, glass plus hairline border once content scrolls under it.
- **Always reachable:** chrome returns on scroll-up, near the end of a page, on input focus, and on a tap at the top edge. On desktop the rail never hides.
- **Tap the active tab to scroll to top**; tap again at the top to refresh.
- **Per-tab memory:** each tab keeps its own scroll position and last sub-route.
- **Horizontal sub-navigation** (feed filters, For you/Following, job chips, profile tabs, roadmap categories, Study units):
  - momentum scrolling with `scroll-snap`;
  - edge fade masks showing more items exist;
  - the active item auto-scrolled into view, with a sliding active indicator;
  - on desktop, arrow buttons on hover plus shift + wheel.
- **Sticky section headers** stack under the collapsed top bar without overlap.
- **Safe areas:** respect `env(safe-area-inset-*)` everywhere, especially in the installed PWA.
- **Reduced motion:** chrome still hides and shows, using a very short opacity change.
- **Accessibility:** focusing hidden chrome brings it back; nothing is trapped or removed from the accessibility tree.

## 7b. Seamless screen-to-screen navigation (fixes the 1/5 transitions score)

- **Persistent shell:** the top bar, tab bar, rail and right column live in a layout that never unmounts or re-renders on navigation. Add a test asserting the shell doesn't remount.
- **One loading state, never three:**
  - Remove the spinner → skeleton → content sequence and every full-screen spinner.
  - Each route has a single skeleton matching its final layout, inside a `Suspense` boundary in the content area only.
  - Navigations run as transitions, so the current screen stays visible and interactive until the next is ready.
- **Delayed skeletons:** show one only after about 200ms of loading, and keep it at least about 300ms once shown. For slow navigations, show a thin aurora progress bar at the top instead of clearing the screen.
- **Kill the waterfall:** code and data load in parallel.
  - With a data router: define loaders statically (not inside lazy modules) so data starts with navigation, and have them call `queryClient.ensureQueryData`.
  - Otherwise: start `queryClient.prefetchQuery` and the lazy import together from the link.
- **Prefetch likely navigations:**
  - Preload code and data on hover, focus, `touchstart`, and when links scroll into view (visible mentor, job, subject and notification cards).
  - Preload every bottom-tab chunk after the first idle period.
- **Instant detail screens:** seed detail queries from list results (`initialData` or `placeholderData`), then refresh in the background. Keep previous data while filters, tabs or pages change (`keepPreviousData`).
- **Scroll restoration (fixes "222 px instead of 900 px"):**
  - Back and forward restore exact positions; new forward navigations start at the top.
  - Use React Router's scroll restoration keyed by `location.key`.
  - Restore only once content is rendered: render from cache on back so page height exists first.
  - Virtualised lists store their own offsets per history entry.
  - Add e2e tests for Home → post → back and Jobs (scrolled) → job → back.
- **Spatial transitions** via the View Transitions API (React Router's `viewTransition` where available), with a crossfade fallback:
  - Push (list → detail) slides in from the right; back reverses it.
  - Tab switch: a quick crossfade.
  - Shared elements morph:
    - mentor card → mentor profile header;
    - job card → job header;
    - post media → full-screen viewer;
    - roadmap node → step panel;
    - story thumbnail → story viewer;
    - subject card → subject hero;
    - citation chip → source panel;
    - video card → player.
  - Sheets and modals rise from the bottom over the dimmed screen.
  - Each transition is under about 300ms, transform and opacity only, scaled by `--motion-scale`.
- **Back gesture and history:**
  - The browser back button, the Android back gesture and in-app back behave identically.
  - Opening a sheet or modal pushes a history entry, so back closes it.
  - Deep links from notifications build a sensible back stack.
- **Optimistic updates** for likes, saves, RSVPs, follows, request accept/decline, marking steps done and chat feedback, with rollback and a toast on failure.
- **Focus management:** after navigation, focus moves to the main heading and the route change is announced; focus returns to the trigger on back.
- **Image stability:** every image and avatar reserves its space (width/height or aspect-ratio), with blur-up or dominant-colour placeholders.

## 7c. Resilience: error boundaries and failed loads

- Add `errorElement` (or error boundaries) at the root, each layout and each route, so a failure replaces only the content area and the shell, navigation and sign-out keep working.
- **Stale chunks after a deploy:** handle Vite's `vite:preloadError` and failed dynamic imports by reloading once, guarded by a `sessionStorage` flag so it can never loop. Retry a failed lazy import once before showing an error.
- **Offline:** if a chunk can't load offline, show a friendly offline state with retry inside the content area. Have the service worker precache all route chunks after install.
- **Error screens:** use the design system, plain warm language in both languages, a retry action, a way home, and the request id where useful. Never show React Router's default error page anywhere.
- Add e2e tests that block a route chunk, go offline and simulate a stale deploy, asserting the shell survives and the friendly state appears.

## 7d. Performance budget

- **Initial JS at most 170 KB gzipped**, enforced by a CI check that fails the build when exceeded, plus a per-route budget.
- **Shrink the main chunk:** use the bundle data in `data/` to move everything not needed for the first screen out of it. Check at least:
  - Telugu translations (load the active language only);
  - Socket.io client (load after sign-in, when needed);
  - `motion` (via `LazyMotion`);
  - charts, the Galaxy renderer, and the reels and story viewer;
  - markdown rendering;
  - date and validation libraries;
  - icon sets.
- **Never in the first screen:** PDF.js (with its worker), KaTeX, the video player and the study chat UI.
- **Images:** LCP images get `fetchpriority="high"`, correct sizes and preloads; everything below the fold is lazy.
- **Targets on the throttled production build:**
  - Signed-in Lighthouse mobile at least 85 on Home, Study, Mentors, Jobs, Roadmaps and Profile.
  - LCP under 2.5 s, INP under 200 ms, CLS under 0.1.
  - Tab switches show cached content in under 100 ms.
  - List → detail shows meaningful content in under 300 ms.
  - Study answers start streaming in under 1.5 s with the mock provider.

## 8. Screen-by-screen direction

1. **Landing page:** an aurora hero with the college's logo and a warm promise. No fictional people or invented numbers (D3).
2. **Onboarding, sign-in and verification:**
   - a full-bleed aurora hero and a 3-step progress indicator;
   - large, friendly roll-number and auto-advancing 6-digit OTP inputs with paste support;
   - a "You're in" celebration, then branch, interests and goals as tappable chips.
3. **Home feed:**
   - stories with aurora rings (seen vs unseen) and a hero "One Useful Thing" card;
   - For you / Following as a segmented control;
   - generous post media, reaction animations and animated poll bars;
   - an immersive reels viewer, and Q&A cards clearly distinct from posts.
4. **Mentors:**
   - Topmate-grade cards: large avatar, company and role, branch and batch, reply time, session-type pills, next slot;
   - a profile with cover header, impact stats and reviews;
   - booking as a bottom sheet: session type → calendar strip with timezone-aware slots → note → confirm → celebration and add to calendar.
5. **Sessions and chat:**
   - session cards with a live countdown and a softly glowing "Join video" once open;
   - modern bubbles, typing indicator, date separators, message status and a clean composer.
6. **Alumni dashboard and Requests:**
   - the impact card as hero, a beautiful pause switch and a weekly-hours meter;
   - swipeable accept/decline request cards;
   - a story-sized (1080×1920) branded impact card to share.
7. **Jobs Radar:**
   - an animated radar-sweep header and filter chips;
   - job cards with company logos and "alumni at this company" avatars (respecting visibility);
   - save and apply states, a kanban "My applications" tracker, and a guided referral sheet.
8. **Career Galaxy:** the "wow" screen.
   - A deep-space canvas: branches as constellations, roadmaps as star clusters, completed steps lit in aurora colours.
   - Smooth pan and zoom, a List toggle and a step sheet.
   - Lazy-loaded, rendered with Canvas or SVG, within budget.
9. **Events and AMAs:**
   - poster-like cards with date blocks and RSVP with avatar stacks;
   - a live upvoted question queue with "answered" animations;
   - add to calendar.
10. **Progress and rewards:**
    - an animated XP ring and a streak flame with a weekly strip;
    - a collectible badge grid with locked silhouettes and hints;
    - an opt-in podium leaderboard and an official-feeling certificate;
    - the Wall of Mentors as a photo mosaic.
11. **Profile:** cover, avatar, role chip, headline, branch and batch, mentor availability, tabs, and clear privacy indicators on each field.
12. **Admin, TPO and analytics:**
    - quiet professional mode: dense but airy tables, sticky filters, KPI cards with sparklines;
    - accessible charts, CSV export and a print stylesheet;
    - no aurora except the college logo.
13. **Settings and "Your data":** reassuring plain-language privacy screens; the 30-day deletion grace period shown as a visual timeline.
14. **Platform console:** neutral CampusLink branding, clearly separate from tenants.
15. **Study (subject library and AI study assistant):** a showpiece; follow section 8b.

## 8b. Study: subject library and AI study assistant

The full feature spec is in `docs/specs/ai-study-assistant.md` (Appendix A). This section defines how it looks and feels. Study is likely the screen students open most, so it must be the calmest, fastest and most focused place in the app.

**Study home (student)**
- A "Continue where you left off" hero: the last material and page, or video and timestamp, resumed in one tap.
- Enrolled subjects as cards:
  - subject code in large display type and the full name;
  - the subject's accent colour (section 4);
  - a syllabus progress ring and last activity.
- Suggested questions for current topics as tappable chips.

**Subject page**
- A hero header that the subject card morphs into.
- Units as a horizontally scrolling chip row (section 7a), and a syllabus tree with collapsible units and coverage dots showing which topics have material.
- Tabs for Notes, Slides, Videos, PYQs and Other, with filters and search.
- For faculty, status chips on each material (processing, indexed, failed).
- A floating "Ask" button in the aurora gradient that opens the chat scoped to this subject.

**Chat**
- **Mobile:** full-screen, with the scope (subject) and answer mode (Simple, Detailed, Exam-style as a segmented control) in a compact header.
- **Desktop:** a split view, with chat on the left. Tapping a citation opens the source in a right-hand panel at the exact page or timestamp, so the conversation is never lost. On mobile, the source opens in a sheet.
- **Streaming:**
  - text fades in gently with no layout jumps;
  - auto-scroll follows the answer until the student scrolls up, then a "Jump to latest" pill appears;
  - the send button morphs into a stop button while streaming.
- **Citations:** small numbered markers inline, plus source chips under the answer (title, page or timestamp). Hovering or long-pressing a chip previews the passage.
- **Slash commands:** typing `/` opens a glass popover above the composer with icons, descriptions, fuzzy filtering and full keyboard control. The same commands appear in Cmd+K.
- **Command results as rich cards:**
  - `/videos`: a snap-scrolling carousel with thumbnails, duration badges, "Exact topic" and "Related" groups, and timestamp chips that open the player at that moment.
  - `/quiz`: a focused player with a progress bar, instant feedback per answer and a completion celebration (XP via `award`).
  - `/flashcards`: cards that flip with a 3D rotate, a crossfade under reduced motion.
  - `/summary`, `/explain`, `/notes`, `/syllabus` and `/important`: each with its own clear card layout.
- **AI disclosure:** a short, calm line under the composer, not an alarming banner.
- **AI not enabled yet:** this must feel intentional.
  - Show retrieved passages as "From your material" cards with page links.
  - Explain in one line that AI answers aren't switched on yet.
  - Give admins a direct link to the settings.

**Viewers**
- **PDF:** smooth page navigation, pinch zoom, text search, the cited passage highlighted in a brand tint, and "Ask about this" on text selection.
- **Video:**
  - a transcript side panel (a sheet on mobile) highlighting the current line;
  - clickable timestamps, chapters and playback speed;
  - YouTube behind a click-to-load facade.

**Faculty and admin**
- **Upload:**
  - drag and drop on desktop; camera capture on mobile (handwritten notes go through OCR);
  - a live pipeline stepper per file (uploaded → scanning → extracting → chunking → embedding → indexed) with an aurora progress bar;
  - failures explain what went wrong and offer a retry.
- **Analytics:** faculty analytics and the admin AI dashboard follow the quiet professional style of section 8, item 12.
- **AI Assistant settings:**
  - the first-run checklist as a visual progress tracker;
  - a masked key field showing only the last 4 characters, and "Test connection" with clear feedback;
  - the consent notice as a readable, plain-language step, not small print.

**Performance:** prefetch the Study chunk after the first idle period for students, and lazy-load everything heavy (section 7d).

## 9. Empty, loading and error states

Every list and screen has three designed states:
- **Empty:** a small original illustration in the aurora palette, one encouraging line, one clear action, and never fake data.
- **Loading:** one skeleton (section 7b).
- **Error and offline:** section 7c.

## 10. Microcopy

Keep the warm, senior-to-junior tone the audit rated 4/5. Add or update every string in both `en.json` and `te.json`. No hard-coded strings.

## 11. Non-negotiable quality bars

- **Accessibility:**
  - WCAG 2.2 AA, with zero axe violations across the audit's screen set and all new screens;
  - visible, beautiful focus rings and all touch targets at least 44px;
  - full keyboard paths, including the chat, slash menu, viewers and upload flow.
- **Security:**
  - No changes to API behaviour, auth or tenancy except as allowed in D1 and Appendix A.
  - New external origins only where Appendix A requires them, added in `security-headers.conf` with its test.
  - No trackers.
- **Themes:** light, dark and system, with no flash on load.
- **Responsive:** 360, 390, 768, 1024, 1280 and 1440px.
- **Data honesty:** follow "never invent data" everywhere, including landing pages, illustrations, empty states and seed content.

## 12. How to execute

At the end of each phase:
- run the full gate from `CLAUDE.md` (format, lint, typecheck, tests, build, API coverage, secret scan);
- commit with conventional commits, push, run e2e and confirm CI is green;
- update `progress.md`.

If Docker or Mongo die mid-gate, restart them and re-run rather than treating it as a code failure.

0. **Setup** (Step 0 above).
1. **Critical fixes:**
   - the platform admin landing route and the desktop rail (§7);
   - removal of the fictional alumni (D3);
   - error boundaries and stale-chunk handling (§7c);
   - the client-side refresh fix (D1);
   - every Critical finding in the audit.
2. **Quick wins:** all 24 from the audit.
3. **Navigation and transitions:** sections 7a and 7b, plus role-aware navigation, on the current screens.
4. **Performance:** section 7d, with the CI bundle budget check.
5. **Foundations:** tokens, fonts, palette generator and contrast tests, design-language ADR.
6. **Living style guide:** a dev-only `/design` route showing every token and primitive in both themes and both tenants. **Stop here and send me a summary with screenshots before continuing.**
7. **Primitives:** rebuild `components/ui/`, merging every duplicate the audit listed. Include:
   - button, input, OTP input, select, chip;
   - avatar and stack, card, sheet, dialog;
   - tabs, segmented control, toast, tooltip, skeleton;
   - empty state, error state, badge, progress ring, stat card, table.
8. **Showpiece screens:** onboarding and verification → Home → Mentors and booking → Sessions and chat → Career Galaxy → Progress and rewards → Jobs and referrals → Events → Profile → landing page.
9. **Study feature:** build `docs/specs/ai-study-assistant.md` following its own delivery order and stop-for-review points, using the new primitives and section 8b. Run the full gate and CI after each of its steps.
10. **Remaining screens:** settings, admin, analytics, moderation, imports, sources, platform console.
11. **Polish:** motion tuning, celebrations, haptics, dark mode, Telugu review, accessibility and touch targets, and a world-class bar review (section 3) of every screen.
12. **Re-audit:**
    - Re-run the audit scripts in `apps/web/e2e/audit/`. If they aren't in the repo, recreate them from the methodology in `audit.md` and commit them, excluded from the normal e2e run.
    - Produce `docs/design/revamp/after/` matching `before/`, plus new journey timings, axe, Lighthouse and bundle data, covering Study too.
    - Write `docs/design/revamp/summary.md` with a before/after scorecard.
    - Targets: transitions at least 4/5, and every area at least 4/5.
    - Update docs and the conventions in `CLAUDE.md`.

## 13. Final report

At the end, give me:
- a summary of what was built and the before/after scorecard;
- how every audit finding was addressed;
- the exact steps for a college admin to attach an LLM API key;
- assumptions and known gaps;
- anything I should verify myself (provider terms and pricing, legal review of the consent text and uploaded content, real-device and screen-reader testing).

When unsure between two design choices, pick the one that is more legible on a 360px screen in bright sunlight, then make it beautiful.
