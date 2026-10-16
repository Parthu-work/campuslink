# Phase 6: Roadmaps and Career Galaxy

Done when: students explore researched, cited roadmaps in a zoomable Career Galaxy (or a simple list), track progress node by node with weekly goals and nudges; alumni, faculty, TPO and certified student contributors draft roadmaps; a different reviewer approves them; and every published version has history, a diff and per-node comments.

## Plan

1. **Content model:**
   - A roadmap is a small acyclic graph of nodes (skill, milestone, project, exam).
   - Each node carries a summary, prerequisites, an estimated time range (labelled as an estimate), free resources, a "proof of skill" project and its own sources.
   - Each roadmap has its own sources, outcomes, categories and branches.
   - Anything not backed by a confirmed source is marked `needs_review` and shown as such.
2. **Library:**
   - Researched roadmaps live as reviewed JSON in `modules/roadmaps/library/`, cited per roadmap and per node, each with a `lastReviewedAt` date.
   - Every college gets them installed and can feature, archive or revise them through the same workflow.
   - Coverage: CSE domains (SDE and DSA, web full-stack, backend, frontend, mobile, DevOps and cloud, SRE, QA and SDET, data analyst, data engineer, data science, ML and AI, cybersecurity, embedded and IoT, game dev, blockchain, UI/UX, forward-deployed engineering, product management), then Mechanical, Chemical, EEE, ECE, Civil, plus higher studies and government exams.
3. **Authoring and governance:**
   - Who writes: `roadmaps:write` (alumni, faculty, TPO, admins, and students only with `CERTIFIED_CONTRIBUTOR`).
   - Workflow: draft → submit → review (`roadmaps:review`; the author cannot approve their own submission) → publish.
   - Publishing requires at least 2 roadmap sources, and every node must have a source or be marked `needs_review`.
   - Editing a published roadmap opens a new draft version while the published one stays live.
   - Version history, a node-level diff, and per-node comments for authors and reviewers.
   - Reviewers can feature or archive roadmaps.
4. **Progress (`roadmaps:progress`):**
   - Mark nodes done; progress lights nodes in the Galaxy.
   - A weekly goal (nodes per week), with a gentle weekly nudge when you are behind. Nudges are a new `roadmaps` notification category, off by email.
   - "My roadmaps" on the Career Galaxy page.
5. **Career Galaxy:** an SVG constellation of roadmaps by category, and per roadmap a layered, pan-and-zoom node graph. It is keyboard reachable and has a list view that is the default with reduced motion and on very small screens. No WebGL, so it stays fast on low-end phones.
6. **Link checking:** `pnpm --filter @campuslink/api roadmaps:verify` fetches every cited URL in GitHub Actions. Failing links are listed in `docs/roadmap-sources.md` and their nodes flagged.
7. **Search:** the command palette finds roadmaps.
8. **Tests:**
   - Schema and graph validation, and the publish checklist.
   - The workflow (draft, submit, approve, request changes, no self-approval), version history and diff.
   - Library install and update, and progress with goals and nudges.
   - Isolation for every new collection.
   - Playwright: explore the Galaxy → open a roadmap → mark progress; draft → submit → review → publish.

## Assumptions

- **Research:** this container can't fetch web pages, but web search works. Every cited URL comes from a search result, and CI re-checks that each one answers.
- **Time estimates** are editorial judgments for a part-time student, shown as "about".
- **No exam dates, fees, vacancies or cut-offs** appear in roadmaps (they change yearly); nodes link to official pages instead.
- **Library roadmaps are attributed to the platform's research,** not to a college member. Each college's reviewers own their copies from then on.

## Outcome

**Built:**

- **API:** the `roadmaps` module.
  - Four tenant-owned collections: roadmaps, versions, progress and comments.
  - Workflow: draft → submit → review → publish. Anyone who saved a version (including a reviewer) cannot approve it. Version history and a publish checklist.
  - Feature and archive flags; per-step comments; roadmaps and comments are reportable and moderatable.
  - Weekly goals with gentle nudges (new `roadmaps` notification category, email off by default).
  - Roadmaps appear in command-palette search.
- **Library:** 16 researched, cited roadmaps.
  - **Software:** SDE and DSA, full-stack web, backend, frontend, mobile, DevOps and cloud, SRE, QA and SDET.
  - **Data and AI:** data analyst, data engineer, data science, ML and AI engineer.
  - **Design and product:** UI/UX, product management.
  - **Core engineering:** ECE, EEE.
  - **Installation:** every new college gets them at creation, and the seed installs them too. Reviewers install or update from the library page; updates arrive as proposals for review.
- **Link check:** `roadmaps:verify` runs in the feeds workflow. First run: 9 broken links, all fixed. Now 251 URLs: 242 pass, 9 inconclusive (sites that block automated or overseas clients), 0 fail. See `docs/roadmap-sources.md`.
- **Web:**
  - **Career Galaxy:** an SVG constellation per category; each star is a keyboard-reachable link.
  - **Roadmaps list:** filters by category, branch and search; My roadmaps and My drafts.
  - **Roadmap page:** layered graph with zoom and native-scroll pan, or a numbered list; the step panel shows resources, sources, proof of skill, the "needs review" note, mark done, and comments for writers.
  - **Progress and goals:** a progress card with weekly goal and next steps.
  - **Editing and review:** a form-based editor with a live publish checklist; history with a step-level diff, plus the review form; review queue and library page.
  - **Defaults and language:** the list view is the default with reduced motion and on small screens; English and Telugu throughout.
- **Seed:** library installed in both demo colleges; Ananya follows SDE and DSA with a goal; Rahul's DEMO draft waits for review.

**Tests:**

- API: 502 tests, including the workflow, no self-approval, versions, the library (every roadmap valid and publishable), progress and nudges, comments and moderation, and a 12-case isolation suite for the 4 new collections. Coverage is 92%.
- Web unit tests: graph layout, galaxy layout (no overlapping stars), next steps and version diff.
- Playwright: explore the Galaxy → open a roadmap → mark progress and set a goal; draft → submit → review → publish. Both run with axe at desktop and phone sizes.
- Checked at 360 px and desktop in both themes: no horizontal overflow.

**Decisions:**

- Library roadmaps are attributed to the platform's research, not a member, so they can be reported but have no person to block.
- Reports no longer require a member subject.
- Comments are for writers and reviewers only; students give feedback through reports for now.
- One open version per roadmap avoids merge conflicts.
- Refused connections in the link check count as inconclusive, because Indian government sites block overseas runners.

**Gaps:**

- **10 planned roadmaps are not in the library:** cybersecurity, blockchain, game development, forward-deployed engineering, higher studies, government exams, mechanical, civil, chemical, and embedded/IoT. The shared web-search budget for the research run ran out, so they were left out rather than written from memory. Colleges can author them now; the next research pass adds them.
- Mobile, ECE and EEE have many "needs review" steps.
- Editor validation messages come from the schema in English.
