Master prompt 3: fix every open issue and rebuild the user experience
You are the engineering and design lead for CampusLink, a multi-tenant alumni, placement and study network for Tier-3 Indian colleges. Prompts 1, 1b and 2 built every feature. The code is correct but the product looks and feels like a college project. This prompt has two jobs, in this order:

1. Fix every open issue found by the conformance audit of 7 November 2026 (Part F).
2. Rebuild the user experience so a student, an alumnus, a placement officer and a principal each feel they are using a polished, fast, calm, modern product they would pay for and recommend (Part U). Roadmaps get the deepest rebuild.

This is a redesign, not a repaint. Change layouts, flows, information architecture and copy wherever the end user is better served. Do not add new product features beyond what this prompt names; the product already has too many surfaces.
Step 0: Set up (before anything else)

1. Branch state. `main` is at `0083f90` (Prompt 2 up to G9). Everything else is on `feat/prompt-2` at `094acfc` (G10 to G13, merged through pull request #5). If CI on `feat/prompt-2`'s head is green, fast-forward or merge it into `main` and push. If it is red, fix it first on `feat/prompt-2`, then merge. All work in this prompt happens on `main`, following `CLAUDE.md` › Git workflow (no feature branches, no pull requests).
2. G12 approval (blocking question for the owner). `docs/adr/0014-cross-college-network-and-employer-access.md` line 3 says `Status: proposed … waiting for the owner's approval`, but `docs/build/progress.md` line 554 and `docs/build/report-2.md` line 13 say "approved". Ask the owner once: "Did you approve ADR 0014?"
   * Yes: set the ADR status to `accepted (owner, <date>)` and continue.
   * No, or no answer: do not change, extend or restyle any network, employer or credentials code. Keep `Tenant.network.*` defaulting to `false` (it already does), hide the network and recruiter destinations behind a platform flag `NETWORK_ENABLED=false` (new env, default false), and add an entry to `docs/build/progress.md`. Continue with everything else.
3. Save this prompt verbatim to `docs/build/master-prompt-3.md`. Create `docs/build/progress-3.md` (one section per phase: shipped, decisions, gaps, gate results) and `docs/build/facts-3.md` (copy §2 and keep it current).
4. Capture the "before" set (phase U0) before changing any UI.

1. Decisions already made (do not re-open)

* X1. Users first. The order of priorities stays: security and privacy, correctness, speed, then delight. Within UX, the order is: clarity of the next action, speed (perceived and real), trust, then beauty.
* X2. One design language, version 2. Write ADR 0015 "Design language v2", which supersedes the visual parts of ADR 0008. It keeps: each college's hue generating the palette (`packages/shared/src/palette.ts`, contrast-tested `*-ink` tokens), Telugu and Devanagari support, `prefers-reduced-motion`, and celebrations only at the ADR 0008 moments. It replaces: the type scale, spacing, radii, elevation, surface colours, density, iconography rules, motion durations and component anatomy (§U1).
* X3. Calm by default. Every screen has exactly one primary action. Secondary actions live in a toolbar or an overflow menu. No promotional cards inside the product. Nothing appears at equal visual weight unless it has equal importance; empty or zero items are hidden or collapsed, not shown as zero.
* X4. Phone first, desktop proper. Design at 360 px first, then give desktop a real layout (list and detail side by side, tables, keyboard). A single centred card on a 1440 px screen is not a desktop layout.
* X5. No truncation of meaning. Titles, names, companies and roles never end in an ellipsis at 360 px in English, Telugu or Hindi. Wrap to two lines, or reorganise. Ellipsis is allowed only for long free text (post bodies, summaries) with an obvious way to read more.
* X6. Performance is UX. The initial JavaScript budget stays at 170 KB gzip; this prompt must also free at least 15 KB of it (U0). Per-screen budget stays at 70 KB. Targets on a mid-range Android over simulated Fast 3G/4G (the existing `audit:lighthouse` throttling): LCP ≤ 2.5 s on every member screen and ≤ 2.0 s on landing and sign-in, INP ≤ 200 ms, CLS ≤ 0.05.
* X7. Honest UI. Never invent data, testimonials, logos, counts or people. Marketing surfaces show the real product with demo data visibly labelled as demo, or the college's own suppressed outcomes. Internal states that mean nothing to a member (for example "needs review" on a roadmap step) are never shown to students; staff see them.
* X8. One assistant. "Study assistant" and "Career Copilot" become one assistant, Ask, with scopes (Study, Career). Server code, rules and budgets stay separate (`ChatService` and the Copilot through `AiTasksService.stream`); only the entry point, chat UI and history merge.
* X9. Same rules, new look. Every rule in `CLAUDE.md` still binds. In particular: navigation only from `buildNav()`; screens only through `screen()`/`layout()`; primitives only from `components/ui/`; strings only through `t()` in en, te and hi; tokens only, no raw colours; toasts through `lib/toast.ts`; animation through `lib/motion.ts`.
* X10. Stop and ask before changing tokens or sessions, tenancy enforcement, encryption, or anything a pen test would treat as a security boundary. UI work never needs those.

2. Verified facts (commit `094acfc`; re-check anything that moved)
Gates and numbers. CI green on the identical tree `bdb93e2` (run `42371983872`): API 1,291 passed and 7 skipped; shared 180, web 97; end-to-end 232 passed and 16 skipped; coverage 90.05% statements, 76.36% branches; initial JS 169.8 KB of 170 KB (23 files). `pnpm audit --prod --audit-level=high` clean; 2 moderate production advisories (`glob`, `minimatch` via `write-excel-file` → `archiver`), 5 low or moderate overall.
Web stack. React 19, React Router 8 (`app/router.tsx`, `screen()`/`layout()`), TanStack Query 5 (+ `@tanstack/react-virtual`), Tailwind 4 with CSS-variable tokens (`styles/tokens.css` 200 lines, `styles/index.css` 893, generated `styles/palette.css` 321), Radix (`radix-ui`), cmdk, lucide-react, motion via `lib/motion.ts`, sonner via `lib/toast.ts`. Fonts via `@fontsource-variable`: Bricolage Grotesque (display), Geist (body), Geist Mono, Anek Telugu, Anek Devanagari.
Primitives (`apps/web/src/components/ui/`): avatar-stack, back-link, burst, button (+ button-variants), choice-group, column-chart, dialog (`Dialog`, `Sheet`), error-state, field (`Input`, `Select`, `Textarea`), form-footer, illustration, intent-link, mesh, misc (`Chip`, `Badge`, `Card`, `Skeleton`, `EmptyState`, `Avatar`, `VerifiedTick`, `Crest`), otp, page-header, person-avatar, progress, radar-sweep, rich-text, role-chip, slot-picker, stat-card, stepper, switch, tab-nav (`Segmented`), table, tabs, tag-input, tooltip.
Shell. `components/layout/app-shell.tsx` (377 lines): desktop rail from `nav.tabs` plus the menu groups, phone bottom bar from `nav.tabs` with Create in the middle; tab highlighting uses `useTabMemory` (`tabMemory.active`), so a destination that is not a tab keeps the previous tab lit. `command-palette.tsx`, `create-sheet.tsx`, `account-menu.tsx`, `pull-to-refresh.tsx`, `skeletons.tsx`.
Navigation. `packages/shared/src/navigation.ts`: `NavId` has 55 destinations. `PERSONA_TABS`: student `home | study/roadmaps | create | mentors/verify | placements/jobs`; alumni `home | requests/mentoring | create | mentors | jobs`; staff and admin `home | subjects/roadmaps | create | review/admin | jobs`. The desktop sidebar lists about 19 items for a student and scrolls; admin screens add a second sub-navigation column.
Roadmaps. `features/roadmaps/`: `galaxy.tsx` (236, index), `galaxy-canvas.tsx` (317, the dark "Career Galaxy" canvas), `roadmap-page.tsx` (680: `Graph`, `StepList`, `NodePanel`, `ProgressCard`, `Comments`), `editor.tsx` (602), `review.tsx` (162), `history.tsx` (230); helpers in `lib/roadmaps.ts` (293, `layoutGalaxy`, `wrapLabel`). Schema `packages/shared/src/schemas/roadmaps.ts`: a node has `id, title, kind (NODE_KINDS), summary (≤400), prerequisites (≤6 ids), estimateHours [min,max], resources (≤5), proof (≤300), sources (≤6), needsReview`; content has `title, summary, category (ROADMAP_CATEGORIES), branches, outcomes (≤6), sources, nodes (≤MAX_NODES)`; `graphProblems()` validates the DAG. 27 library roadmaps in `apps/api/src/modules/roadmaps/library/`.
Other screens named below. `features/landing/landing.tsx`; `features/auth/{sign-in,sign-up,phone-parts,mfa-gate,mfa-setup,email-links}.tsx`; `features/join/join.tsx`; `features/home/home.tsx`; `features/mentors/{mentors,mentor-page,mentor-stats,mentor-reviews,request-form}.tsx`; `features/mentorship/{requests,rematch-sheet}.tsx`; `features/mentor/mentor-dashboard.tsx`; `features/placements/{placements,drive-page,offer-report,academic-dialog}.tsx`; `features/progress/{readiness,progress-page,leaderboard,rewards}.tsx`; `features/resume/*`; `features/interviews/{interviews,session}.tsx`; `features/practice/{practice,set,item-form}.tsx`; `features/copilot/{copilot,queries,stream}.ts(x)`; `features/study/chat/` and `features/study/*`; `features/companies/*`; `features/admin/admin-overview.tsx`, `admin.tsx` and the section screens; `features/settings/*`; `features/help/*`.
UI audit tooling. `pnpm --filter @campuslink/web audit:capture | audit:journeys | audit:extras | audit:lighthouse` (config `apps/web/e2e/audit/playwright.config.ts`); the last run is in `docs/build/after-2/` (1,152 screenshots, `data-after/touch-targets-360.json`).
3. What the audit saw (the reasons for Part U)
Taken from `docs/build/after-2/after/*` (1440 and 360, light, DPIT) on 7 November 2026. Fix each of these and add a before/after pair for it to the final report.
Everywhere

* A1. The desktop sidebar shows ~19 destinations and scrolls; admins see a second sub-navigation column, leaving three columns of cramped content. Too many choices, no hierarchy.
* A2. On phones, a screen that is not a tab (Roadmaps, Readiness, Companies…) keeps the previous tab lit (Home), so people do not know where they are. The last tab label is truncated ("Placemen…").
* A3. Truncation of meaning on almost every list: session titles, drive names, mentor names, next-step items, roadmap node titles, "Demo Alumnus 26-…".
* A4. Card inside card ("One useful thing today" wraps a post card), uneven radii and paddings, pill buttons of different heights, generic icon-in-tinted-circle on every row.
* A5. Monospace letter-spaced eyebrows ("SAT, 7 NOV", "WHY THIS MATCH", "NEXT SESSION") read as a developer tool, not a consumer product.
* A6. Page headers spend the first screen on an icon, a title and a two-line explanation of the feature; the content starts below the fold on phones (Placements, Roadmap detail, Copilot).
* A7. Saturated cyan primary buttons everywhere at the same weight; no clear primary action per screen.

Landing and sign-up

* A8. Landing: right half empty, logo shown twice, gradient-text headline, three small feature cards, no picture of the product, no proof. The main button says "Join with your college email" although sign-up is phone-first.
* A9. Sign-up is one long form (method switch, role, name, phone, birth month and year, a consent block) before any value is shown.

Home

* A10. A stories row with a single avatar takes ~170 px; "Next session · starts in 3 minutes" has no Join button; right rail of promotional cards ("Find a mentor", "Ask alumni"); "Suggested for you" repeats four identical big Follow buttons.

Roadmaps (the worst area)

* A11. Index: a dark "Career Galaxy" canvas inside a light app, with ~9 px labels, clipped names ("Software Engineer (DSA a…", "Mobile App Developer (Andr…"), no outcome or time information, and zoom buttons. It is decorative, not usable, and costs code.
* A12. "My roadmaps" shows a student an internal "1 needs review" badge and a thin progress bar.
* A13. Detail: the graph view shows three truncated nodes in a scrolling box with a legend paragraph; most of the screen is empty. Metadata is a row of chips (CSE, IT, AIML, DS, "about 450–810 hours in all") that tells a student nothing actionable. "Your progress" is a generic box with a dropdown. On phones, the title, History button, paragraph and chips fill the whole first screen.
* A14. The editor and the review queue are long forms with no live preview and no visual diff.

Mentors

* A15. Desktop shows one swipe card in the middle of a 1440 px screen. The match ring reads "37 · Good match". Role text repeats ("Data Analyst · Kestrel Analytics (demo)" and "DEMO: Data Analyst at Kestrel Analytics (demo)"). The tip says "→ open" while the button says "Interested".

Placements, readiness, Copilot, admin

* A16. Placements (phone): description and academic-record card fill the first screen; drive cards have no Register button and no countdown.
* A17. Readiness: "You're at 18." leads with a deficit; the ring is small; the same action appears twice.
* A18. Copilot: a form (label, textarea, button) instead of a chat; slash-command syntax shown raw (`/eligible: …`); a three-line disclaimer; the disabled Ask button has poor contrast. A separate "Study assistant" exists in the menu.
* A19. Admin overview: tiles with titles wrapped one word per line ("Not / joined / yet"), a "Waiting" badge colliding with a truncated title ("Modera…"), and zero-count tiles at the same weight as urgent ones.

Part F. Fix the open issues
Do these first, in one or two commits each, with the full gate (`CLAUDE.md` › Before every push).
F1. G12 governance. Resolve per Step 0.2. Whatever the answer, add a test that the employer host and every `scope: 'employer'` route return 404 when `NETWORK_ENABLED=false` (only if you add the flag).
F2. Tenancy plugin hardening notes for the pen test. No code change unless a defect is found. Add a section to `docs/security-review.md` › Pen-test focus naming `apps/api/src/db/tenant-plugin.ts` (lines 29 and 86: the network-path model allowlist and the cross-collection stage refusal), `lib/network-scope.ts`, the employer host boundary (`requireScope`), and the credential routes, with the tests that cover each.
F3. Dependency advisories. Clear the two moderate production advisories: update `write-excel-file` (or replace its `archiver` chain, or pin patched `glob ≥ 14.0.2` and `minimatch ≥ 11.0.1` through `pnpm.overrides` if the API allows). Re-run `pnpm audit --prod` and the export tests (reports, placements export, readiness export). Record the remaining dev-only advisories with reasons in `docs/security-review.md`.
F4. Touch targets. Raise every target listed in `docs/build/after-2/data-after/touch-targets-360.json` to at least 44 × 44 px (member-name links on Home and a job, job titles in the jobs list, the roadmap review queue and the rest of that file) without enlarging the visible text: use padding or a pseudo-element hit area. Make the audit script fail on any target under 44 px on any screen.
F5. Landing and sign-in fonts. The language switcher's native names ("తెలుగు", "हिन्दी") must not download the Telugu (138 KB) and Devanagari (253 KB) fonts on English pages. Render those two words with the system font stack (`font-family: system-ui` scoped to the switcher), keep `unicode-range` subsetting, and confirm in `audit:lighthouse` that landing LCP returns to ≤ 2.0 s.
F6. Bundle headroom. Before any Part U work, free at least 15 KB of initial JS (U0 lists candidates). Record the before and after per file in `progress-3.md`.
F7. Stale records. Update `docs/build/report-2.md` and `progress.md` so the G12 approval text matches Step 0.2's outcome; fix `README.md`'s status line; make `CLAUDE.md` › Git workflow match how you actually worked.
F8. Partly met items (no code unless an input arrived): record their status in `progress-3.md` with the owner input each needs. They are the Android build and Play listing (G9; `docs/android.md`), WhatsApp one-tap autofill (needs the signed Android package), employer invoicing and revenue share (G12 hooks), the NAAC definitions against the manual (R12), and translated legal texts (R13).
Part U. The user-experience rebuild
How to work (Part U)

* Design before code, per phase. Write `docs/design/v2/<phase>.md`: the user and their job, the problems from §3 it fixes, the layout at 360 and 1440 (ASCII wireframe or an annotated screenshot of a prototype), states (loading, empty, error, offline, minor, read-only), copy in English, and the acceptance checks. Then build.
* Build from primitives. New or changed primitives first (U1), then screens. A screen file that styles a raw `<div>` into a card, list row or toolbar is a defect.
* Every screen, every state. Loading skeletons match the final layout (no jump), empty states show what will appear and the one action that fills them, errors say what happened and what to do, offline shows cached content with a quiet "Updated N min ago".
* Three languages, both themes, both widths. Check en, te and hi at 360 and 1440 in light and dark. Telugu and Hindi strings run 20–40% longer: design for them, not around them.
* Copy is design. Short, warm, specific, second person, verbs on buttons ("Register", "Book 30 min", "Mark done"), no feature explanations in page headers, no jargon (NBA, SAR, ATS) on student screens without a plain-words gloss. Update en first, then te and hi, and add every changed string to `docs/build/translation-review.md`.
* Measure. Each phase records tap counts for its key task (before and after), Lighthouse for its screens, and axe results. A phase is done only when its numbers are better than before.

U0. Baseline and headroom

1. Run `audit:capture`, `audit:journeys`, `audit:extras` and `audit:lighthouse`; copy the outputs to `docs/build/before-3/`.
2. Count the taps and fields for these tasks on a phone, from a cold start of the installed app, and record them: (a) a new student signs up and is verified; (b) a student asks an alumnus for a mock interview; (c) a student registers for an eligible drive; (d) a student marks the next roadmap step done; (e) a student asks the assistant a question and opens a source; (f) a TPO sees who has not joined and nudges them; (g) an alumnus accepts a request from WhatsApp.
3. Free ≥ 15 KB of initial JS (F6). Use the build's chunk report to find what is in the initial graph. Candidates, measure before choosing: anything only one screen uses; `cmdk` (load the command palette on first ⌘K/Ctrl K or search tap); `sonner` (keep `lib/toast.ts`'s API, render with a 1 KB in-house toaster or load sonner after first paint); route preload lists that pull screen code into the entry; locale packs; `lucide-react` icon imports that defeat tree-shaking; polyfills Vite no longer needs. Keep the budget test honest: do not move code into a chunk that every screen immediately loads.

U1. Design language v2 (ADR 0015) and primitives
Direction. Calm, warm, confident and Indian-campus friendly, at the standard of today's best consumer-grade work tools (Linear, Notion, Duolingo's learning paths, Airbnb's listing cards): strategic minimalism with one clear next action, content before chrome, real people's faces and names as the visual centre (alumni are the product), and rich but quiet colour from the college's hue.
Tokens (`styles/tokens.css`, `packages/shared/src/palette.ts` and `palette.test.ts`; regenerate `palette.css`):

* Type. Keep Bricolage Grotesque only for display sizes (screen titles and big numbers) and Geist for everything else; drop Geist Mono from member-facing UI (keep it for codes and IDs). A six-step scale: Display 32/36, Title 22/28, Headline 18/24, Body 16/24, Callout 14/20, Caption 12.5/16 (px at 360; fluid up to +15% at 1280). Minimum UI text 12.5 px; body 16 px on phones. Sentence case everywhere; no letter-spaced uppercase eyebrows except tiny section labels in admin tables. Telugu and Devanagari get +2 px line height on every step (test it).
* Space. A 4-px base with steps 4, 8, 12, 16, 20, 24, 32, 40, 56, 72. Page gutters 16 (phone), 24 (tablet), 32 (desktop). Max reading width 680 px; max content width 1200 px.
* Radii. Three: 8 (inputs, chips), 12 (cards, sheets' inner items), 20 (sheets, dialogs, hero media). Buttons follow their height (pill only for small chips).
* Surfaces and elevation. One background, two raised surfaces, one sunken. Borders 1 px at low contrast; shadows only for floating layers (menus, sheets, toasts). No card inside a card: inner groups use spacing or a divider.
* Colour. Neutrals carry 85% of the UI. The college hue appears in the primary button, the active nav item, links, progress and selection. Status colours (success, warning, danger, info) are fixed hues adjusted for contrast, never the college's. Keep `*-ink` contrast at ≥ 5.5:1 and add a test for status inks. Dark mode: true dark surfaces, not inverted greys; check every chart.
* Iconography. lucide at 20 px, 1.75 stroke, only where an icon adds meaning (not on every row). No icons in tinted circles as decoration.
* Motion. 120 ms (press), 200 ms (enter), 280 ms (sheet), standard and emphasised easing tokens; transform and opacity only; reduced motion respected (existing `--motion-scale`).
* Density. A `data-density="compact"` mode for staff tables and lists.

Primitives to add or rework (each in the style guide, `features/design/style-guide.tsx`, both themes, en/te/hi, with an accessibility test):

* `ListRow` (leading avatar or icon, title that wraps to two lines, meta line, trailing action or chevron; whole-row 44+ px hit area) and `ListSection` (heading + rows; replaces most cards-of-rows).
* `PageHeader` v2: title, optional one-line subtitle, primary action and overflow; collapses into a compact top bar on scroll on phones; no explanatory paragraph (move it to an "About this" sheet or help).
* `Toolbar` (filters, search, view switch, sort) that becomes a filter `Sheet` on phones, with an active-filter count.
* `EmptyState` v2 with a small preview of what will appear and one action; `Skeleton` variants that mirror `ListRow`, cards and charts.
* `ActionCard` (one task, one button, optional deadline chip): the single pattern for "do this next".
* `PersonCard` (photo or initials, name, role at company, batch, one reason, one action) used by mentors, alumni, suggestions and the network.
* `Countdown` chip ("Closes in 2 days", "Starts in 3 min") with `aria-live` off and a precise time on hover or long-press.
* `StepTrack` (the roadmap journey, U3), `ScoreRing` v2 (readiness), `Timeline` (sessions, drive rounds, history), `Kbd`.
* `Button` sizes S/M/L with one height per size; variants primary, secondary, tertiary, danger; a loading state that keeps width.
* Toasts with Undo for reversible actions (mark done, pass on a mentor, withdraw).

Write ADR 0015 with before/after screenshots of five primitives and the token table. Update `CLAUDE.md` › Coding conventions.
U2. Information architecture and navigation
Goal: anyone finds anything in two taps and always knows where they are.

1. Five spaces per persona, defined in `buildNav()` only (`packages/shared/src/navigation.ts`: `NavId`, `NavGroup`, `PERSONA_TABS`, `MENU_ORDER`, `ADMIN_SECTIONS`):
   * Student: Home, Learn (Roadmaps, Study, Practice, Ask), Mentors (Alumni Match, Requests, Sessions, Messages), Career (Placements/drives, Jobs and tracker, Résumé, Interviews, Readiness, Companies, Referrals), You (profile, progress and rewards, settings, help). Final-years land on Career; first-years on Learn.
   * Alumnus: Home, Mentoring (requests, sessions, micro-asks, office hours), Jobs and referrals, Community (Q&A, circles, batch page), You.
   * TPO and staff: Today (the work queue, U9), Students (onboarding, verification, readiness board), Placements (drives, offers, reports), Content (roadmaps review, study, Q&A moderation), College (settings, billing, analytics).
   * Every remaining destination becomes a section inside one of these spaces (tabs or a list on the space's landing screen), not a sidebar item.
2. Desktop: a slim sidebar with the five spaces plus Search and Create; the active space expands its sections underneath (one level, no scrolling sidebar). Remove the admin second column: admin sections are the Staff spaces' sections.
3. Phone: five bottom tabs with full labels in all three languages (shorter labels in te/hi if needed; never truncated). Create moves into each space's primary action or a floating button on Home only. The tab of the space that owns the current screen is always lit (replace `tabMemory.active` with ownership from `buildNav()`; keep tab memory for the URL each tab returns to).
4. Global search and the command palette cover people, companies, drives, roadmaps, subjects and actions, with recent items; it is the fastest path for power users (U0 removes it from the initial bundle).
5. One inbox. Notifications and messages stay separate screens but share one header entry with a unified unread count and a segmented switch.
6. Wayfinding. Every non-root screen has a back affordance (`BackLink`) and a compact title; breadcrumbs only on desktop.
7. Tests: navigation unit tests per persona (spaces, sections, permissions, feature switches, minors), the "owning tab is lit" e2e for ten deep links, and a test that no persona's desktop sidebar exceeds 7 entries.

U3. Roadmaps, rebuilt (the centrepiece)
Goal: a confused second-year can pick a direction in under a minute, see exactly what to do this week, and feel progress every time they open it.
Index: "Career paths" (`features/roadmaps/galaxy.tsx` → `paths.tsx`; remove `galaxy-canvas.tsx` and `layoutGalaxy` from the member UI)

* Top: "Continue" — the member's followed paths as `ActionCard`s showing the next step's title, "Step 3 of 10 · about 2 weeks at your pace", and a big Continue button. Never show internal review states to students.
* Then: "For your branch" — a horizontally scrolling row (phones) or grid (desktop) of path cards: role title (two lines max, never truncated), a one-line "what you'll be able to do" from `outcomes[0]`, total time as weeks at a stated pace (from `estimateHours` and the member's weekly goal; show the pace, e.g. "about 14 weeks at 6 h a week"), number of steps, and the people signal from the college's own data where it exists and passes `suppress()` (for example "4 alumni from your college work as this", read through the owning service, never invented).
* Then: all paths grouped by category with chips for category and branch (Toolbar), and search. A compact "Compare" for two paths (time, steps, skills in common) is allowed if it reuses data already present.
* The Galaxy may remain only as an optional, lazily loaded "Map" view for exploration if it can meet U1 (light theme, ≥ 12.5 px labels, no clipping, keyboard focusable nodes); otherwise delete it. Decide with numbers (bundle, LCP) and record the decision.

Detail: the journey (`features/roadmaps/roadmap-page.tsx`; split into `journey.tsx`, `step-sheet.tsx`, `path-header.tsx`)

* Header (compact): title, one-line outcome, a progress bar with "3 of 10 steps · next: Arrays and hashing", and one primary button: Continue (opens the next step) or Start this path. Secondary actions (history, share, stop following, report) in the overflow. Branch chips and "last reviewed" move to an "About this path" sheet with the sources.
* Journey view (default): a vertical `StepTrack` grouped into phases. Phases come from the DAG: compute topological levels from `prerequisites` (a pure, unit-tested function in `packages/shared`), merge levels into 3–6 phases of roughly equal hours, and name them by position ("Foundations", "Core skills", "Build and prove", "Get interview-ready") with en/te/hi strings; let library authors override a phase name later (optional field, schema change only if you need it, with a migration). Each step row: done/next/locked state, title (wraps), kind icon, time ("about 1–2 weeks"), and for projects a "proof" badge. Steps whose prerequisites are not done show as upcoming, not disabled: a student may still open them.
* Step sheet (`Sheet` on phones, right panel on desktop; URL state through `useUrlOverlay`): what and why (summary), how you'll know you're done (`proof` as a checklist the member ticks, stored with the existing progress API or a small extension), resources as rich link rows (title, source, free/paid if known, "opens in a new tab"), sources, comments, and the footer actions Mark done (with Undo toast and the existing celebration) and Next step. Add "Practise this" (G4 items by topic, when present) and "Ask a senior" (mentors whose profiles match the path's role) as quiet links, each only when data exists.
* Graph view stays as an option for those who want it, rebuilt: fits the viewport, readable labels that wrap, pan and zoom by gesture and keyboard, the current step centred on open, no legend paragraph (use a small key).
* Weekly goal and nudges: a single inline control ("Your pace: 6 h a week · change") instead of a dropdown card; the "on track" message lives in the header.
* Phones: the first screen shows the header and the next two steps; no paragraph above the fold.
* People and outcomes, from real data only: "Seniors on this path" (alumni who follow or completed it and are accepting mentees) and "Drives that ask for these skills" (from placements, by title keywords already in the roadmap outcomes), both suppressed and hidden when empty.

Authoring and review (`editor.tsx`, `review.tsx`, `history.tsx`)

* Editor: an outline (phases → steps) with drag to reorder, inline validation from `graphProblems()`, a live preview of the student journey beside it on desktop (below on phones), and a "sources" checker that flags steps without citations before submit.
* Review: side-by-side diff of two versions (steps added, removed, changed fields highlighted), approve or request changes with a reason; the "nobody approves a version they edited" rule stays enforced by the API.

Acceptance (U3): picking a path and starting it takes ≤ 3 taps from the Learn tab; "Mark done" on the next step ≤ 2 taps from Home; no truncated title at 360 in te/hi; LCP ≤ 2.5 s; zero axe violations; journeys e2e for student (start, mark done, undo), alumnus (edit and submit) and faculty (review with diff).
U4. First run: landing, sign-up and the first ten minutes
Landing (`features/landing/landing.tsx`)

* Above the fold: the college's crest and name once; a plain headline about the outcome ("Get guidance, referrals and placement help from seniors of <college>"); one primary button Join with your mobile number and a text link Sign in; on the right (desktop) or below (phone), a real product picture: a phone frame showing the Home screen with the seeded demo data, labelled "Demo data" (generated at build time by the audit capture, never a mock-up of features that do not exist).
* Below: three short sections with real UI crops (find a senior, prepare and register for drives, follow a career path), then the college's opt-in outcomes page numbers when published (aggregates through `suppress()`), then the privacy promise in one line. Language switcher at top right (F5).
* LCP element is the headline text, not an image.

Sign-up (`features/auth/sign-up.tsx`, `phone-parts.tsx`, `features/join/join.tsx`)

* A three-step flow with a progress indicator and back: (1) mobile number (role toggle "I'm a student / alumnus" stays here); (2) the code (auto-submit, resend countdown, switch channel); (3) name and birth month, then consents as a compact summary ("We use your data to run your account, match you with mentors… " with Review choices expanding the existing purposes), then Create account. Email sign-up stays available as "Use email instead" for staff.
* The minor path (guardian) gets the same calm design with a clear "what happens next" and an illustration.
* Keep every legal behaviour and test from B2 and R1; only the presentation changes.

First ten minutes

* After sign-up and verification, a short "Set up your CampusLink" checklist on Home (dismissible, max 4 items, each one tap): pick your goal (target role and companies), follow a path, find a senior, turn on WhatsApp updates. Each item personalises something visible (X7 honesty) and shows what changed.
* Questions are asked when their answer is useful (progressive profiling): target companies when opening Companies, CGPA never asked of students (it comes from the college record).

Acceptance (U4): sign-up to Home in ≤ 6 taps and ≤ 4 fields for an adult; time to first useful action (a followed path or a sent request) measured in the journeys audit and improved against U0.
U5. Home: one clear "Today"

* Top: greeting with the date in normal text (no monospace), then the single most urgent item as a large `ActionCard`: a session starting within 15 minutes gets Join (and the time); else a drive closing within 48 hours gets Register; else the weekly Next Step.
* Then "Your next steps" (from G7's Next Step, max 3 `ListRow`s, titles wrap) and "From your college" (the feed, without the "One useful thing" wrapper card; one post card style).
* Stories row only when there are ≥ 3 active stories. "Suggested for you" becomes one `PersonCard` row with real reasons and a single Follow per card at secondary weight.
* Desktop: two columns (main feed and a narrow "Coming up" column with sessions, deadlines and events); no promotional cards.
* Alumni Home leads with requests waiting and micro-asks (one-tap Accept/Decline); staff Home is U9's Today.

U6. Mentors and mentorship

* Alumni Match on desktop: a two-pane layout: a ranked list of `PersonCard`s on the left (filters: company, role, branch, availability, language) and the selected mentor's profile on the right. Phones keep the one-at-a-time card if usability testing prefers it, with the buttons Not now and Request (no "Interested" ambiguity), and a list view toggle.
* Match strength as words with the reasons first ("Strong match: same branch, works at a company you're targeting, replies within a day"); show no raw number below 60, and none at all to minors (X7, G10 rules).
* De-duplicate role lines (one "Data Analyst at Kestrel Analytics" line; the demo label once as a badge).
* Request flow: a three-step sheet (what you need: session type with plain descriptions; your goal: two short fields with examples; pick a time from the mentor's slots) with a preview of exactly what the mentor will see. Rematch and nudges (B5) appear as calm, helpful messages ("Priya hasn't replied yet. Here are 3 seniors who usually reply within a day").
* Sessions: a session page with time, join button (active 10 minutes before), agenda, shared notes, and after-session feedback and the public review prompt.
* Mentor dashboard (alumni): requests as a queue with one-tap Accept/Decline and templates, the week's capacity, impact card.

U7. Career: placements, résumé, interviews, practice, readiness

* Placements: first screen = eligible drives as cards with company, role, CTC band, mode, a `Countdown`, eligibility at a glance ("You're eligible" or the first reason not) and a Register button on the card. Academic record moves to a compact row ("CGPA 8.2 · 0 backlogs · from the college · View"). Tabs: For you, All, Registered, Offers. Drive page: a timeline of rounds and results.
* Résumé: split view on desktop (editor left, live PDF preview right), stepper on phones; ATS report as a checklist with fixes and a score that rises live; AI rewrite as an inline suggestion with a diff and Accept/Reject per bullet.
* Interviews: a focused full-screen session (question, timer, record/type, next), then a report with rubric bars and quotes; "Book a human mock" as the primary action on the report.
* Practice: a daily set as a short, game-like flow (one question per screen, instant feedback, streak at the end, celebrate at the ADR 0008 moment "quiz complete").
* Readiness: lead with momentum ("+6 this week · 3 steps add 13 more"), a large `ScoreRing`, the top three actions once, then the parts as compact rows with bars; never shame language.
* Companies: company pages as rich, scannable profiles (years recruited, roles, bands, rounds, seniors there who mentor, write-ups), every number through the existing suppression.

U8. Ask: one assistant (X8)

* One Ask screen (`features/ask/`), reachable from the Learn space and the global search ("Ask about…"), with a scope switch: Study (subject picker) and Career. It reuses `features/study/chat/` and `features/copilot/stream.ts` behind one chat UI.
* Chat layout: conversation history (sidebar on desktop, sheet on phones), messages, a composer docked at the bottom with suggestion chips written as natural questions ("Which drives can I register for?", "Help me prepare for Nimbus Labs"); commands still work if typed but are never shown as `/syntax`.
* Citations as numbered inline markers that open source cards (title, origin, snippet); refusals as a friendly card with the human next steps as buttons. A one-line trust note under the composer ("Answers come from your college's material. Sources are linked."), with details in a sheet. Remaining daily questions shown only when under 5.
* Streaming with a visible stop button; copy, retry and feedback per answer.
* Remove the separate "Study assistant" and "Career Copilot" destinations; keep their routes as redirects.

U9. Staff: Today, tables and the TPO console

* Today (replaces `admin-overview.tsx` as staff Home): a prioritised queue of work items (`ListRow`s with counts, age and one action each): offers to verify, verification requests, drives closing, content to review, students not joined, reports to moderate. Items at zero are hidden; an all-clear state celebrates nothing but says "Nothing waiting. Next drive: …".
* Single-level navigation (U2) and a table pattern for staff lists: sticky header, column sort, filter Toolbar, bulk select with a sticky action bar, row click opens a side panel, CSV export where it exists today, `data-density="compact"`.
* Dashboards (analytics, reports, readiness board): 4 KPIs at the top with change vs previous period, then one chart per question; every number keeps `suppress()`; charts readable in dark mode and on phones.
* Recruiter portal and platform console get the same table and header patterns (only if Step 0.2 allows touching network code).

U10. Speed, feedback and polish

* Optimistic updates for follow, save, RSVP, mark done, accept/decline, with rollback and an Undo toast.
* Skeletons that match final layout; no spinner on any screen load (rule stands).
* View transitions between list and detail (existing `animateScreens()`), shared-element style for cards to detail where cheap.
* Image handling: avatars and logos with fixed aspect boxes (CLS), `loading="lazy"`, the `?w=` variants from B13.
* Fonts: preload only the Latin subset of Geist and Bricolage used above the fold; Telugu and Devanagari load only when that locale is active or such text is on screen (F5).
* Haptics through `haptic()` stay opt-in; sounds: none.
* Error and offline: one inline pattern ("Couldn't load. Retry") with the request id hidden behind "Details".

U11. Accessibility and language

* 0 axe violations on every screen in both themes; 44 × 44 px targets everywhere (F4); visible focus rings using the college hue at ≥ 3:1; full keyboard paths for every journey in §U0.2; screen-reader labels for icons-only buttons, charts (a text summary) and the roadmap journey (an ordered list with states).
* No truncation of meaning in te/hi at 360 (X5): add an audit check that scans captured screens' text nodes for ellipsis on titles, names and buttons.
* `prefers-reduced-motion` respected; text scales to 200% without loss (test at 200% zoom).

U12. Bugs to fix (found in the audit; each gets a test)

1. A non-tab screen lights the wrong bottom tab (A2): ownership-based highlighting (U2.3) with an e2e over deep links.
2. Bottom-tab labels truncate ("Placemen…") in English, Telugu and Hindi.
3. Home's next session "starts in 3 minutes" without a Join button (A10).
4. Mentor card: "37 · Good match" (A15), duplicate role lines, tip text says "open" while the button says "Interested".
5. Students see "needs review" on roadmaps (A12).
6. Admin overview tile titles wrap one word per line and the "Waiting" badge overlaps the title (A19).
7. Copilot's disabled Ask button fails contrast (A18).
8. Roadmap graph nodes are clipped by the viewport on open (A13).
9. Landing CTA says "college email" while sign-up is phone-first (A8).
10. Any other defect found while doing U1–U11: log it in `progress-3.md` with a test.

U13. Usability check, re-audit and final report

1. Re-run all audit scripts into `docs/build/after-3/` (360 and 1440, light and dark, en/te/hi, every persona). 0 axe violations, no target under 44 px, no truncation of meaning, every screen within budget.
2. Re-measure §U0.2's tap counts and Lighthouse; every task and every screen must improve or stay equal, with reasons for any exception.
3. Write `docs/build/usability-script.md` for the owner: five students and one TPO at KNRCER, six tasks from §U0.2, what to observe, a SUS questionnaire, and a single-ease question per task. The owner runs it; you prepare it.
4. `docs/build/report-3.md`: what changed per phase with before/after screenshot pairs for A1–A19 and U12, the numbers (bundle, Lighthouse, tap counts, axe), decisions and deviations, ADR 0015, gaps, and what the owner should check on a real low-end Android phone over 3G.

Gates (every phase)

* `CLAUDE.md` › Before every push, unchanged: format, lint, typecheck, unit and API tests (isolation and permission suites included), coverage gate, build, bundle budget, secret scan, then e2e and a green CI run on `main`.
* Plus for Part U: the phase's design doc exists; its screens are captured at 360 and 1440 in both themes and three languages; axe 0; targets ≥ 44 px; no truncated meaning; Lighthouse targets (X6) met for its screens; tap counts recorded.
* Never weaken a test to pass. If a privacy, tenancy, minors or permission test fails after a UI change, the UI change is wrong.

Phase order
Step 0 → F1–F8 → U0 → U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8 → U9 → U10 → U11 → U12 (bugs are fixed as their screens are rebuilt; anything left is fixed here) → U13. Report progress in `docs/build/progress-3.md` after each phase, with the commit and CI run.
Acceptance for the whole prompt: on a mid-range Android phone, a new student signs up, follows a career path, marks a step done, asks a senior for a mock interview and registers for a drive, all in their language, without confusion and without a screen that looks unfinished; a TPO opens Today and clears the most urgent item in one tap; the product looks and feels like a funded, production SaaS. Every gate is green, the initial bundle is ≤ 170 KB with at least 15 KB freed before the rebuild, and every audit finding A1–A19 has a before/after pair in `report-3.md`.
