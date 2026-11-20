# Final report: master prompt 3 (Part F, then U0 to U13)

**Date:** 2026-11-20. **Branch:** `main`, one commit per phase, each pushed after the full gate. The phase-by-phase record, with every commit, CI run and gate table, is [`progress-3.md`](progress-3.md). This report summarises it for the owner. The usability check you run with KNRCER students is [`usability-script.md`](usability-script.md).

## Acceptance for the whole prompt

| Statement                                                                                                                                                                           | Where it is shown, or why it is not met                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On a mid-range Android phone, a new student signs up, follows a career path, marks a step done, asks a senior for a mock interview and registers for a drive, all in their language | **Met in the lab; not yet on a phone.** The task audit walks each of these on a 360 px phone, by tap and by keyboard (`after-3/data-after/tasks.json`, `tasks-keyboard.json`). The language audit finds no meaning cut short in English, Telugu or Hindi. `defects.spec` keeps the tabs whole in all three. A real phone and real students are your two checks below. |
| …without confusion and without a screen that looks unfinished                                                                                                                       | **For the usability check.** No script can say "without confusion". [`usability-script.md`](usability-script.md) is written to find out, with five students and a TPO at KNRCER. "Unfinished": 0 axe violations, 0 targets under 44 px and no screen wider than the phone, on every screen.                                                                           |
| A TPO opens Today and clears the most urgent item in one tap                                                                                                                        | **Partly.** Today lists what is waiting, most urgent first, and one tap opens the place where it is cleared (task f: 4 taps from Today to a sent nudge, down from 5). One tap does not clear it: inviting on WhatsApp keeps its opt-in confirmation, and verifying an offer needs its proof read (U9a, below).                                                        |
| The product looks and feels like a funded, production SaaS                                                                                                                          | For you to judge from the pairs below and on a phone.                                                                                                                                                                                                                                                                                                                 |
| Every gate is green                                                                                                                                                                 | See "Gates".                                                                                                                                                                                                                                                                                                                                                          |
| The initial bundle is ≤ 170 KB, with at least 15 KB freed before the rebuild                                                                                                        | **≤ 170 KB: met** (155.7 KB, from 169.8). **15 KB before the rebuild: not met.** U0 freed 10.1 KB before Part U. The rest came later, in U10b (one file for the first load): 14.1 KB freed in all.                                                                                                                                                                    |
| Every audit finding A1–A19 has a before/after pair                                                                                                                                  | Below, with three more for U12.                                                                                                                                                                                                                                                                                                                                       |

## What changed, per phase

- **Part F (open issues).**
  - F4: every target under 44 px raised, and the capture audit now fails on any.
  - F5: the landing and sign-in no longer download Telugu and Devanagari fonts to draw two words.
  - F1–F3 and F7 were done in prompt 4.
  - F6 (bundle headroom) and F8 (items waiting on you) are below.
- **U0 · Baseline.**
  - The before set ([`before-3/`](before-3/)) has 1,152 screenshots, plus the axe, target, journey and Lighthouse data.
  - Tap counts for the seven tasks.
  - Initial JS 169.8 → 159.7 KB: an in-house `cn` replaced tailwind-merge, the palette generator moved to the API, and lucide's runtime was replaced.
- **U1 · Design language v2 ([ADR 0015](../adr/0015-design-language-v2.md)).**
  - Tokens: six fluid type steps, a 4 px space scale, three radii, flat cards, a truer dark theme, motion durations, and a compact density.
  - Sentence-case section labels (A5, everywhere at once).
  - New and reworked primitives: `ListRow`, `PageHeader` v2, `Toolbar`, `EmptyState` v2, `ActionCard`, `PersonCard`, `Countdown`, `StepTrack`, `ScoreRing` v2, `Timeline`, Button v2 and `toast.undo()`. Each is in the style guide with an accessibility test.
- **U2 · Navigation.**
  - Five spaces per persona. The admin's desktop rail went from 39 entries and a second column to 7.
  - The lit tab is the screen's owner (A2), and the bottom-tab labels are whole in en, te and hi.
  - One inbox, and Create out of the tab bar.
  - Search covers people, companies, drives, paths, subjects and actions, with recent items.
- **U3 · Career paths.**
  - The Galaxy is deleted (A11).
  - The paths index has Continue cards and "For {branch}".
  - A path is a journey of phases with a step sheet, and its pace is in hours a week.
  - The map opens fitted, with the next step centred and titles wrapped (A13).
  - The editor has an outline with drag to reorder and a live preview, and reviewers see a side-by-side diff (A14).
- **U4 · First run.**
  - The landing paints its headline from `index.html` before any script: LCP 4.2 → 1.8 s.
  - The landing shows the product, and its button names the phone (A8).
  - Sign-up is three steps (A9), and minors see "What happens next".
  - "Set up your CampusLink" on a new student's Home.
- **U5 · Home.**
  - One Today card for the most urgent thing: Join, Register or the next step (A10).
  - Next steps as rows, and "Suggested for you" with the reason.
  - The feed without the card-in-card (A4), and stories only when there are three or more.
  - Coming up on wide screens, and "Waiting for you" for alumni.
- **U6 · Mentors.**
  - Match is two panes on wide screens with filters, and strength is said in words (no score under 60, one role line, Request; A15).
  - A three-step request sheet, and seniors on a path.
  - A session's own page with an agenda and shared notes, the mentor's queue, and a calm rematch line.
- **U7 · Career.**
  - Placements: the record is one row, and each card has Register and a countdown (A16).
  - Drive rounds as a timeline.
  - Readiness leads with momentum (A17).
  - Drives and practice for a path's role.
  - Interview report bars, and the companies question asked where it fits.
  - The résumé: split view or stepper, a live ATS checklist, and inline rewrites.
- **U8 · Ask.**
  - One Ask screen for study and career (A18).
  - Commands are shown in words, with one trust line.
  - Citations open source cards, refusals come as a card with people to ask, and career answers take feedback.
- **U9 · Staff.**
  - Today, the work queue, replaced the overview's tiles (A19).
  - One `DataTable` pattern for staff, platform and recruiter lists.
  - Dashboards lead with four numbers and their change, never a change from a suppressed "<5".
- **U10 · Feedback, speed, polish.**
  - Undo on answers and optimistic actions, and one error pattern with Details.
  - The initial load is one file of 155 KB, and the mesh paints a still first frame.
  - Avatars are small and load near the viewport.
  - Skeletons are shaped like their content, the boot mark has no spinner, and cards morph into their screens.
- **U11 · Accessibility and language.**
  - 0 axe violations and 0 targets under 44 px.
  - A new check for meaning cut short (9 → 0).
  - Focus ring at 3:1 for every hue, and charts read in words.
  - A keyboard mode for the task audit.
  - Reduced motion and 200% text tested.
- **U12 · The audit's defects.**
  - Each of the brief's nine defects is checked against today's code, and each has a test ([`docs/design/v2/u12.md`](../design/v2/u12.md)).
  - "Needs review" is hidden from students (A12).
  - A disabled filled button turns neutral, not half-faded (A18).
  - The deck's arrow-key tip says "request".
- **U13 · This phase.**
  - Every audit re-run into [`after-3/`](after-3/).
  - The before build measured on this machine for a fair Lighthouse comparison.
  - The usability script, and this report.

## The numbers

Measured on this machine. The before figures are `094acfc` (the U0 before set's commit), built and measured again here the same way. The before set's own figures came from a much faster cloud container and are not comparable. The raw data is in [`after-3/data-after/`](after-3/data-after/).

### Quality, every screen

|                                                   |                        Before |                              After |
| ------------------------------------------------- | ----------------------------: | ---------------------------------: |
| axe (WCAG 2.2 AA): scans, violations              |                        598, 0 |                         598, **0** |
| Targets under 44 × 44 px (360 px, every role)     |              90 on 23 screens |                              **0** |
| Screens wider than a 360 px phone                 |                             0 | **0** (one found and fixed in U13) |
| Meaning cut short, en/te/hi (U11's check)         | 9 at 360 px (U11's first run) |           **0** at 360 and 1440 px |
| Keyboard: tasks completed from the keyboard alone |                  not measured |                         **6 of 6** |

### Bundle

|                                                    |                    Initial JS (gzip) |
| -------------------------------------------------- | -----------------------------------: |
| Before (`094acfc`)                                 |                             169.8 KB |
| U0: tailwind-merge, palette and lucide runtime out |                             159.7 KB |
| U2: the five spaces                                |                             161.0 KB |
| U10a: Undo and one error pattern                   |                             162.6 KB |
| U10b: the first load as one file                   |                             155.0 KB |
| **U13**                                            | **155.8 KB** in 2 files (budget 170) |

Every screen is within its 70 KB budget; the largest are Settings (68.1 KB) and the platform console (66.0 KB). The two allowed exceptions are unchanged: the PDF viewer and KaTeX, each loaded only when a PDF or a formula is opened.

### Lighthouse (mobile emulation, simulated throttling, DPIT)

Two runs each side. LCP, FCP and the score are their means, and blocking time is the range, because on this machine it swings by up to three times between runs of the same build (warm Home, before: 432 and 1,223 ms).

| Page                   | LCP before |   LCP after | Target | FCP before → after | TBT before → after (ms) | CLS after | Score before → after |
| ---------------------- | ---------: | ----------: | -----: | ------------------ | ----------------------- | --------: | -------------------- |
| Landing                |      6.1 s | **1.7 s** ✓ |  2.0 s | 2.7 s → 1.2 s      | 310–570 → 110           |     0.001 | 62 → 99              |
| Sign-in                |      4.9 s |   **4.2 s** |  2.0 s | 2.9 s → 1.5 s      | 90–570 → 60–110         |     0.000 | 70 → 85              |
| Home                   |      6.6 s |   **6.0 s** |  2.5 s | 2.7 s → 1.6 s      | 470–810 → 1,040–1,590   |     0.000 | 57 → 53              |
| Mentors                |      5.9 s |   **4.9 s** |  2.5 s | 2.8 s → 1.4 s      | 340–610 → 670–1,020     |     0.000 | 62 → 63              |
| Jobs                   |      5.4 s |   **4.6 s** |  2.5 s | 2.9 s → 1.6 s      | 450–1,070 → 900–950     |     0.016 | 58 → 62              |
| Career paths           |      5.0 s |   **4.4 s** |  2.5 s | 2.7 s → 1.4 s      | 580–600 → 580–920       |     0.000 | 62 → 67              |
| Study                  |      5.0 s |   **4.3 s** |  2.5 s | 2.9 s → 1.6 s      | 370–680 → 430–490       |     0.000 | 64 → 73              |
| Companies              |      5.1 s |      2.4 s¹ |  2.5 s | 2.9 s → 1.6 s      | 470–740 → 490–810       |     0.000 | 62 → 82              |
| Copilot / Ask (career) |      5.5 s |   **4.7 s** |  2.5 s | 2.8 s → 1.5 s      | 360–570 → 460–980       |     0.003 | 64 → 67              |
| Résumé                 |      4.9 s |   **4.5 s** |  2.5 s | 2.8 s → 1.5 s      | 410–430 → 560–610       |     0.000 | 67 → 69              |
| Practice               |      4.9 s |   **4.6 s** |  2.5 s | 3.0 s → 1.6 s      | 330–630 → 440–1,140     |     0.000 | 65 → 66              |
| Readiness              |      4.7 s |      2.4 s¹ |  2.5 s | 2.9 s → 1.6 s      | 380–840 → 520–860       |     0.000 | 63 → 81              |
| Profile (edit)         |      4.9 s |   **4.3 s** |  2.5 s | 2.9 s → 1.6 s      | 370–960 → 490–570       |     0.000 | 62 → 72              |
| Home, installed app    |      1.4 s | **1.7 s** ✓ |  2.5 s | 0.2 s → 0.1 s      | 430–1,220 → 710–1,240   |     0.000 | 83 → 79              |
| Jobs, installed app    |      1.3 s | **1.3 s** ✓ |  2.5 s | 0.2 s → 0.1 s      | 450–1,080 → 670–730     |     0.016 | 83 → 83              |

¹ The launch mark, not the content: see below.

The **Profile view** row is left out. Neither build's run is a cold load (21–34 KB transferred in every run, before set included), so it measures the script, not the page.

- **What met its target.** Landing (1.7 s) and both installed-app runs. Sign-in (4.2 s) and the signed-in cold screens did not (4.3–6.0 s): their largest paint waits for the app's code, the college and the strings, as before (gap 1).
- **¹ Companies and Readiness** report 2.4 s, but their largest paint is now the launch mark, not their content. The intro paragraph that used to be their largest paint moved into "About this" (A6), and nothing on screen since is larger than the mark. Read them like the other signed-in screens, not as met.
- **Better on every cold screen.**
  - LCP improved by 0.3–0.9 s on screens whose largest paint is still content, and by 4.4 s on the landing.
  - First paint went from about 2.8 s to 1.5 s (U4 and U10b's boot).
  - CLS is 0.016 or less everywhere. Companies was 0.29 until this phase's fix.
- **Exceptions, with reasons.**
  - **Home** (score 57 → 53). Its LCP improved (6.6 → 6.0 s), but its blocking time rose: 470–810 → 1,040–1,590 ms. A CPU profile of a cold Home load at 4× CPU shows the app's own script time about the same (2.2 s before, 2.0 s after). Its largest single cost, the feed's virtual list measuring each post (`measureElement`), grew from 0.31 to 0.51 s in one profile each. That is the place to work next (gap 1).
  - **Home in the installed app** (1.4 → 1.7 s, score 83 → 79): the same render work, now that the code is cached. It is still inside the 2.5 s target.
  - **Blocking time on other screens** overlaps between the two builds, except Mentors and Résumé (up 100–400 ms). A profile of Practice shows the app's script time fell (1.8 → 1.0 s). So the app does less work there; the rise is either in how the work falls into tasks, or noise at this spread. INP, the target metric, cannot be measured by a page-load Lighthouse run; it is on the real-phone list.

### Tap counts (U0.2's seven tasks)

The task audit (`tasks.audit.ts`) counts on a 360 px phone by fixed rules: a select is two taps, a one-time code is one tap and one field. The before figures are the same script on the before build. By keyboard, every task completes with Tab, the arrow keys and Enter (`tasks-keyboard.json`).

| Task                                               | Before (taps, fields) |    After |                       | Why                                                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------: | -------: | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a. A new student signs up and is verified          |                 13, 7 |    14, 7 | **+1 tap**            | Sign-up is three steps (A9): Continue between the number and "About you". By U4's hand count, sign-up to Home is 3 taps and 4 fields (target ≤ 6 and ≤ 4).                                                                   |
| b. A student asks an alumnus for a mock interview  |                 11, 4 |    13, 5 | **+2 taps, +1 field** | The brief's three-step request (U6): "what you need" has its own Continue, and the goal is two short answers with examples, where there was one field with a starter. The mentor gets a clearer request and a preview of it. |
| c. A student registers for an eligible drive       |                  5, 1 | **1, 0** | better                | Register on the drive's card (U7a).                                                                                                                                                                                          |
| d. A student marks the next roadmap step done      |                  3, 0 |     3, 0 | equal                 | Home → Next on … → Mark done. A final-year student starts on Career (U2), so Home is one of the three.                                                                                                                       |
| e. A student asks the assistant and opens a source |                  7, 2 | **5, 1** | better                | One Ask in Learn (U8a): no subject to search for and pick.                                                                                                                                                                   |
| f. A TPO sees who has not joined and nudges them   |                  5, 1 | **4, 1** | better                | Today's "haven't joined yet" row opens Invite (U9a).                                                                                                                                                                         |
| g. An alumnus accepts a request from WhatsApp      |                  2, 0 |     2, 0 | equal                 | The quick reply; unchanged.                                                                                                                                                                                                  |

### Journeys (navigation timing, 360 px phone)

The journeys audit times each step from the tap until the screen is ready. Both builds were measured on this machine, each with its own script for its own navigation.

|                                         | Throttled (4× CPU, slow 4G)         | Unthrottled                         |
| --------------------------------------- | ----------------------------------- | ----------------------------------- |
| All 40 steps                            | 25.5 s → **20.0 s**                 | 5.7 s → **4.7 s**                   |
| Median step, 90th percentile            | 0.54 s, 1.27 s → **0.33 s, 1.01 s** | 0.13 s, 0.22 s → **0.11 s, 0.18 s** |
| Steps over 0.5 s                        | 20 → **15**                         | 1 → 1                               |
| Frames with an empty main               | 132 → **25**                        | 23 → **12**                         |
| Home to a sent request (the taps of J2) | 1.7 s → **1.1 s**                   | 0.9 s → **0.8 s**                   |
| Cold start: first visible change        | 3.1 s → **0.8 s**                   | 0.4 s → **0.1 s**                   |

Six of the 40 throttled steps got slower, all first visits to a rebuilt screen whose code then loads over the slow connection:

- the first post opened;
- the first Mentors, Learn and path visits;
- Ask;
- a notification's request.

Unthrottled, none got slower. U4's "time to the first useful action" is the J2 row above: from Home to a sent mentorship request.

## Before and after: A1–A19 and U12

Each pair is the same screen and persona at the same width, from [`before-3/after/`](before-3/after/) (`094acfc`) and [`after-3/after/`](after-3/after/) (this phase). Light theme and DPIT unless the finding is about something else.

| Finding                                                                          | What changed (phase)                                                                                           | Before                                                                                                                   | After                                                                                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **A1** Desktop sidebar of ~19 destinations, a second column for admins           | Five spaces in one sidebar, at most seven entries; the admin's sections listed under the open space (U2)       | <img src="before-3/after/admin-admin-overview-1440-light-dpit.png" width="360" alt="Before: admin overview at 1440 px">  | <img src="after-3/after/admin-admin-overview-1440-light-dpit.png" width="360" alt="After: admin Today at 1440 px">     |
| **A2** A screen that is not a tab keeps Home lit; "Placemen…"                    | The space that owns the screen is lit (Learn on career paths); full labels in three languages (U2)             | <img src="before-3/after/student-roadmaps-360-light-dpit.png" width="180" alt="Before: Roadmaps with Home lit">          | <img src="after-3/after/student-roadmaps-360-light-dpit.png" width="180" alt="After: Career paths with Learn lit">     |
| **A3** Names and titles cut short                                                | Rows wrap to two lines; U11's check finds none cut in en, te or hi (U1, U5, U6, U11)                           | <img src="before-3/after/student-mentors-360-light-dpit.png" width="180" alt="Before: mentors on a phone">               | <img src="after-3/after/student-mentors-360-light-dpit.png" width="180" alt="After: mentors on a phone">               |
| **A4** Card inside a card, uneven radii, icons in tinted circles                 | Flat cards, three radii, one post card style (U1, U5)                                                          | <img src="before-3/after/student-home-1440-light-dpit.png" width="360" alt="Before: Home at 1440 px">                    | <img src="after-3/after/student-home-1440-light-dpit.png" width="360" alt="After: Home at 1440 px">                    |
| **A5** Monospace capital eyebrows ("SAT, 7 NOV")                                 | Sentence-case labels in the UI face (U1)                                                                       | <img src="before-3/after/student-events-360-light-dpit.png" width="180" alt="Before: Events">                            | <img src="after-3/after/student-events-360-light-dpit.png" width="180" alt="After: Events">                            |
| **A6** Headers spend the first screen explaining the feature                     | Title and one action; the explanation is in "About this" (U1, U8)                                              | <img src="before-3/after/student-copilot-360-light-dpit.png" width="180" alt="Before: Copilot">                          | <img src="after-3/after/student-copilot-360-light-dpit.png" width="180" alt="After: Ask">                              |
| **A7** Saturated primary buttons everywhere                                      | One primary action per screen; neutrals carry the rest (U1, ADR 0015)                                          | <img src="before-3/after/student-jobs-1440-light-dpit.png" width="360" alt="Before: Jobs at 1440 px">                    | <img src="after-3/after/student-jobs-1440-light-dpit.png" width="360" alt="After: Jobs at 1440 px">                    |
| **A8** Landing: empty half, logo twice, "college email"                          | The outcome headline painted before any script, the product in a phone frame, the button names the phone (U4a) | <img src="before-3/after/public-landing-1440-light-dpit.png" width="360" alt="Before: landing">                          | <img src="after-3/after/public-landing-1440-light-dpit.png" width="360" alt="After: landing">                          |
| **A9** Sign-up is one long form                                                  | Three steps with "Step n of 3" and Back (U4b)                                                                  | <img src="before-3/after/public-sign-up-360-light-dpit.png" width="180" alt="Before: sign-up">                           | <img src="after-3/after/public-sign-up-360-light-dpit.png" width="180" alt="After: sign-up, step 1">                   |
| **A10** Stories row of one, a session without Join, promo cards                  | One Today card with the single most urgent action; stories only with three or more (U5)                        | <img src="before-3/after/student-home-360-light-dpit.png" width="180" alt="Before: Home on a phone">                     | <img src="after-3/after/student-home-360-light-dpit.png" width="180" alt="After: Home on a phone">                     |
| **A11** The dark "Career Galaxy" with 9 px labels                                | Deleted; Continue cards, "For {branch}" and every path by category (U3a)                                       | <img src="before-3/after/student-roadmaps-1440-light-dpit.png" width="360" alt="Before: Roadmaps at 1440 px">            | <img src="after-3/after/student-roadmaps-1440-light-dpit.png" width="360" alt="After: Career paths at 1440 px">        |
| **A12** Students see "1 needs review"                                            | Shown only to people who write or review paths (U12)                                                           | <img src="before-3/after/student-roadmaps-360-dark-dpit.png" width="180" alt="Before: needs review badge">               | <img src="after-3/after/student-roadmaps-360-dark-dpit.png" width="180" alt="After: no review badge">                  |
| **A13** Path detail: chips, a generic progress box, a clipped graph              | One action, progress with the next step's name, the journey in phases; the map opens fitted (U3)               | <img src="before-3/after/student-roadmap-360-light-dpit.png" width="180" alt="Before: roadmap detail">                   | <img src="after-3/after/student-roadmap-360-light-dpit.png" width="180" alt="After: path detail">                      |
| **A14** Editor and review as long forms                                          | The editor's outline and live preview; reviewers see a side-by-side diff (U3b)                                 | <img src="before-3/after/alumni-roadmap-editor-1440-light-dpit.png" width="360" alt="Before: roadmap editor">            | <img src="after-3/after/alumni-roadmap-editor-1440-light-dpit.png" width="360" alt="After: roadmap editor">            |
| **A15** One swipe card on 1440 px, "37 · Good match", a repeated role line       | Two panes with filters, strength in words, one role line, Request (U6a)                                        | <img src="before-3/after/finalyear-mentors-match-1440-light-dpit.png" width="360" alt="Before: Alumni Match at 1440 px"> | <img src="after-3/after/finalyear-mentors-match-1440-light-dpit.png" width="360" alt="After: Alumni Match at 1440 px"> |
| **A16** Placements: the first screen is a description; cards without Register    | The record in one row; each card with Register and a countdown (U7a)                                           | <img src="before-3/after/finalyear-placements-360-light-dpit.png" width="180" alt="Before: Placements">                  | <img src="after-3/after/finalyear-placements-360-light-dpit.png" width="180" alt="After: Placements">                  |
| **A17** Readiness leads with a deficit                                           | Momentum first, a large ring, each step once with its points (U7a)                                             | <img src="before-3/after/finalyear-readiness-360-light-dpit.png" width="180" alt="Before: Readiness">                    | <img src="after-3/after/finalyear-readiness-360-light-dpit.png" width="180" alt="After: Readiness">                    |
| **A18** Copilot as a form, raw "/eligible", a faded Ask button                   | One Ask chat, commands in words, one trust line, a neutral disabled button (U8a, U12)                          | <img src="before-3/after/finalyear-copilot-360-light-dpit.png" width="180" alt="Before: Copilot">                        | <img src="after-3/after/finalyear-copilot-360-light-dpit.png" width="180" alt="After: Ask, career">                    |
| **A19** Admin tiles wrapping one word a line, zero counts as loud as urgent ones | Today: what is waiting, most urgent first, one action each (U9a)                                               | <img src="before-3/after/admin-admin-overview-360-light-dpit.png" width="180" alt="Before: admin overview on a phone">   | <img src="after-3/after/admin-admin-overview-360-light-dpit.png" width="180" alt="After: Today on a phone">            |
| **U12** Bottom tabs in Telugu and Hindi                                          | Whole labels at 360 px (`defects.spec`)                                                                        | <img src="before-3/after/student-home-te-360-light-dpit.png" width="180" alt="Before: Home in Telugu">                   | <img src="after-3/after/student-home-te-360-light-dpit.png" width="180" alt="After: Home in Telugu">                   |
| **U12** The mentor deck on a phone                                               | Not now and Request; the arrow-key tip says "request" (`defects.spec`)                                         | <img src="before-3/after/student-mentors-360-dark-dpit.png" width="180" alt="Before: mentor deck, dark">                 | <img src="after-3/after/student-mentors-360-dark-dpit.png" width="180" alt="After: mentor deck, dark">                 |
| **U12** Landing on a phone                                                       | The headline is the first paint; the button says "Join with your mobile number" (`landing.spec`)               | <img src="before-3/after/public-landing-360-light-dpit.png" width="180" alt="Before: landing on a phone">                | <img src="after-3/after/public-landing-360-light-dpit.png" width="180" alt="After: landing on a phone">                |

The other U12 items have tests rather than pictures: the tab a deep link lights (seven deep links), the map's first view (the next step whole in its frame), the disabled Ask button (3:1 or more), Join on Home for a session about to start (`today-pick.test.ts`) and "needs review" hidden from students (`journey.test.tsx`).

## Decisions and deviations

These are the choices that differ from the brief's letter, with the reasons. Each is recorded in its phase in `progress-3.md`.

- **The Galaxy is deleted, not kept as a map of paths (U3a).** It failed U1 on every count: dark only, 11–12 px labels cut short, and a canvas that touch users could not focus. The paths index is lighter without it.
- **"Seniors on this path", "Ask a senior", "Drives for this role" and "Practise this" moved from U3 to U6 and U7**, the phases that own their data. Built in U3 they would have been guesses (X7).
- **The sign-up code is the last step, not the second (U4b).** Asking for it second needs a sign-up ticket between two calls, which is a session change (rule X10). It is in F8 as your decision.
- **A daily readiness score is stored (U7a).** The readiness spec said scores are never stored, but "+6 this week" can't be honest without the earlier number. It is one number a day, the student's own, kept 35 days, exported and erased with the account, and never shown to anyone else.
- **Today's one tap opens the work; it does not do it (U9a).** Inviting on WhatsApp keeps its per-branch opt-in confirmation, and verifying an offer needs its proof read. So "clears the most urgent item in one tap" means one tap to the place where it is cleared (below).
- **Two kinds of Undo (U10a).**
  - Where the server can take a change back (a save, an RSVP, a follow), the change is sent at once and Undo sends the opposite.
  - Where the other person is told (accepting a request), the answer waits 6 seconds. It is sent when the page is hidden, so a phone never holds an answer the member thinks was given.
- **The first load is one file (U10b).** Rolldown's `$initial` group put the 22 initial chunks into two files. Initial JS went down 7.6 KB because the modules compress better together, and the per-screen budget is unchanged.
- **Equal lengths of time on dashboards (U9c).** "Last 6 months" is compared with the same number of days just before it, never a month in progress against a whole one. The readiness board's week-ago figures come from its own stored daily totals, because readiness is computed on read.
- **Shared session notes are cleared when either person's account is erased (U6b).** A shared note can't be split by author.
- **Sorting in staff tables is over the rows loaded (U9b).** Members load 20 at a time. The search and filters still go to the server.
- **The live résumé score is an estimate on the last check's terms (U7c).** Pages come from the rendered PDF and keywords from a pasted description. The exact score stays with the check.
- **The two assistants' servers are untouched (U8a, X8).** Ask is one screen over the two existing services, with their own rules, limits and budgets.
- **U13 measured the before build again, on this machine.** The before set's Lighthouse figures came from a shared cloud container, which runs far faster than the owner's machine: Home 3.9 s there against 6.6 s here, on the same code. So `094acfc` was built, served the same way, and measured twice with the same script (with Copilot's old address, `/copilot`), and so was this phase's build. The same was done for the journeys, with the before commit's own script.
- **U13's audit scripts walk the new navigation.** The journeys, extras and task scripts still opened Jobs, Roadmaps and the rest from the account menu and switched the old tabs. They now use the five spaces, keeping each step where its screen still exists. The before figures come from the old scripts on the old app.
- **Task e asks through Ask.** Since U8 there is one assistant, and its study scope answers from every subject a student takes, so the shortest path no longer picks a subject first.
- **A journeys run spoiled by machine load was thrown away.** The first run after the capture took 7.2 minutes against 3.0 for the same run later, with Back steps at 4 s instead of 0.7 s. A diagnostic of Back to Home on both builds (the same 0.5–1.0 s at 4× CPU) showed the app was not the cause. Both journeys and both Lighthouse runs were measured again after the machine restarted.

## ADR 0015

[ADR 0015](../adr/0015-design-language-v2.md) (accepted 2026-11-07) is the design language every rebuilt screen uses. It supersedes the visual parts of ADR 0008:

- six type steps, Bricolage for display only, and +2 px line height for Telugu and Devanagari;
- a 4 px space scale, three radii, and flat cards with shadows only on floating layers;
- neutrals for 85% of the UI, with the college hue only where it means something;
- status inks at 5.5:1 or more on every college's surfaces;
- lucide at 1.75 stroke, only where an icon adds meaning;
- three motion durations with reduced motion respected, and a compact density for staff tables.

It keeps ADR 0008's hue-generated palettes, faces, celebrations and aurora rules. Its five before/after pairs of primitives are in [`docs/design/v2/u1/`](../design/v2/u1/), and its rules are in `CLAUDE.md` › Coding conventions.

## Gaps

What prompt 3 asked for and does not have yet, most important first.

1. **Sign-in and the signed-in screens are above their speed targets.** The targets are LCP ≤ 2.0 s for sign-in and ≤ 2.5 s for every member screen (X6). On this machine's cold runs, sign-in is 4.2 s, Home 6.0 s and the other screens 4.3–4.9 s ("The numbers"). All are better than before, but none is met.
   - Each draws its largest paint from the app's own code. The landing reached 1.7 s by painting from `index.html`; the same for a signed-in screen needs a first-paint shell or server rendering. That touches the session path (X10), so it waits for your decision.
   - **Home's blocking time** rose (Lighthouse score 57 → 53). The feed's virtual list measuring each post is its largest cost, and the next thing to work on.
   - **INP** (target ≤ 200 ms) is not measured by a page-load Lighthouse run. It is on the real-phone list.
2. **No real people and no real phone yet.** The usability check and the phone checks above are prepared, not run.
3. **F6: 15 KB was not freed before the rebuild.** U0 freed 10.1 KB before Part U, and 14.1 KB in all by U10b. The brief's "before the rebuild" is missed. The total is 0.9 KB short of 15 even now.
4. **Two tasks take more taps than before** (tap counts, above):
   - sign-up's Continue;
   - the mock-interview request's second goal field and its step.

   Both follow the brief's own designs (three steps for sign-up, two short goal fields for a request), and both are for the usability check to judge.

5. **The sign-up code is the third step, not the second** (U4b): your decision in F8.
6. **The Telugu and Hindi strings added in prompt 3 are machine-assisted and not reviewed** (`translation-review.md` › Prompt 3). The language audit proves they fit, not that they read well.
7. **Signals that wait for data:**
   - the paths index's "4 alumni from your college work as this" (U3b);
   - "followed this path" for seniors on a path (U6a matches by job title only).
8. **Layouts not moved to the new patterns:**
   - drive registrants and the offers queue keep their tables (U9b);
   - the platform's billing tables keep theirs (U9d);
   - about ninety screens draw their own loading placeholder instead of the shared shapes (U10c).
9. **Task g (an alumnus accepts from WhatsApp)** is unchanged at 2 taps and untested on a phone: the templates are not approved by Meta yet (launch checklist).
10. **Owner items from F8 stay open:** the Android build and Play listing, WhatsApp one-tap autofill, employer invoicing, the NAAC manual, and the legal texts' review.
11. **The Release workflow's deploy step fails** for reasons outside prompt 3 (recorded in `progress-3.md`).

## What to check on a real low-end Android phone over 3G

The lab measures a simulated mid-range phone on a simulated connection. These checks need a real one: a 2–3 GB Android phone (Android 10–12), Chrome, and a real 3G connection or a weak 4G signal. Clear the site's data before the cold checks.

| #   | Check                                                                                                                                                            | What "good" looks like                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Landing, cold.** Open the college's address.                                                                                                                   | The headline is readable within about 2 s, before the rest of the page. Nothing jumps when the app takes over                 |
| 2   | **Sign-up with a real number.** Join, then the three steps.                                                                                                      | The WhatsApp or SMS code arrives within a minute. The keyboard is a number pad on the number and code fields                  |
| 3   | **Home after signing in, cold.** Sign out, clear the site's data, sign in again. Time it from the tap on Sign in to the Today card.                              | The lab says about 6 s on a simulated phone. Note the real figure, and anything blank (not a skeleton) for more than a second |
| 4   | **Sign-in page, cold.**                                                                                                                                          | The lab says about 4 s. The college's name and the form appear together                                                       |
| 5   | **The installed app.** Add to Home screen, close it, open it again.                                                                                              | The second open shows Home almost at once (the screens are cached)                                                            |
| 6   | **Telugu and Hindi.** Switch the language in Settings, then go through Home, Learn, Mentors and Career. Then set the phone's font size to Large and do it again. | Every letter renders (no empty boxes), and no title, name or button is cut off. Nothing scrolls sideways                      |
| 7   | **Scrolling.** The feed on Home, the mentor list, and a path with ten steps.                                                                                     | Smooth, and photos appear as they come near (they load near the screen, not all at once)                                      |
| 8   | **The path's map.** Open a path, choose Map, pinch and drag.                                                                                                     | The next step is whole on screen when it opens. Zooming follows the fingers                                                   |
| 9   | **Undo and leaving.** As an alumnus, accept a request and switch to another app within 6 seconds. Then, from another phone, check the student's request.         | The request shows as accepted. Leaving sends the answer; only Undo cancels it                                                 |
| 10  | **Offline.** Turn on airplane mode on Home, open another tab, then turn it off and press Retry.                                                                  | One line saying you are offline, then the screen loads on Retry                                                               |
| 11  | **Ask.** Ask the study assistant a question with a long answer, then open its source.                                                                            | The answer streams in without the page jumping. The source card opens on a tap of its number                                  |
| 12  | **Battery, heat and data.** A 10-minute session. Then look at Settings › Network › Data usage for Chrome.                                                        | No noticeable heat. Data used is in line with the page weights in "The numbers"                                               |
| 13  | **Thumbs.** Use small chips, Undo in a toast, the step sheet's Mark done, and the bottom tabs with one hand.                                                     | No missed taps (every target is at least 44 px)                                                                               |
| 14  | **Dark theme.** Turn on the phone's dark theme.                                                                                                                  | The app follows it. Charts and the map stay readable                                                                          |

Write the phone, its memory, the network and the times next to each line. The usability check's observation sheet has room for the slow screens.

## Gates

Every phase was pushed to `main` after the full gate, and each phase's CI run is recorded in `progress-3.md`. This phase's gate:

- **Static and unit:** format, lint and typecheck pass. Shared tests 223 passed, web tests 172 passed. U13 changes no API code (the API suite's last full run, U9c: 1,370 passed).
- **Build:** initial JS 155.7 KB of 170.
- **End-to-end:** the specs this phase touches pass on a fresh seed. One failure, the sidebar's fit at 1280×720, came from this phase's first account-button change, and was fixed and run again.
- **Audits:** every audit, as above. Secret scan clean.
- **CI:** green for U12 (run 44580483768) and for this phase, `0b5f1e8` (run 44714138849: verify, e2e, adapters, security and deploy-config).

## Next

1. Run the usability check ([`usability-script.md`](usability-script.md)) with five students and a TPO at KNRCER, and send its problem list to the next prompt.
2. Do the real-phone checks above on the same day, on the students' phones.
3. The decisions waiting on you (F8 in `progress-3.md`): the sign-up code order, and the Android build and Play listing.
4. The speed targets left (sign-in and the signed-in screens): a first-paint HTML or server rendering for the sign-in form and the signed-in shell. That is a project of its own and touches the session path (X10), so it needs your go-ahead.
5. Home's feed: measure posts less often (a closer size estimate for the virtual list), then measure Home's blocking time again.
