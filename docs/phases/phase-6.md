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
