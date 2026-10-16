# Phase 5: Jobs and referrals

Done when: a student finds openings in Job Radar (posted by alumni and staff, or pulled from verified public sources), filters them, saves and tracks them, sees which alumni work at the company, and asks one of them for a referral. The alumnus can refer or decline within their own weekly cap.

## Plan

1. **Openings posted in the app (`jobs:post`):** alumni, TPO, faculty and admins post with title, company, location, mode, type, experience level, skills, branches, optional salary, an https apply link, a plain-text description and an expiry (7–60 days). Posters can close their own openings.
2. **Job sources (`JobSourceAdapter`, managed with the new `jobs:sources` permission, which TPO and admins hold):**
   - Greenhouse, Lever, Ashby and SmartRecruiters public job-board APIs (one board per source).
   - Adzuna (India), only when the deployment sets `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.
   - RSS/Atom (government notices, company career feeds), through the Phase 4 polite fetcher with robots.txt.
   - Every source is test-fetched before it is added and gets a health view like news sources.
3. **Normalisation:** title, company, location, mode, type and level are inferred from the posting. Skills come from a fixed vocabulary, and salary is kept only when the source states it. The apply link must be https, and descriptions are reduced to a plain-text snippet. Duplicates across sources are matched on company + title + location. Jobs expire automatically, and an ATS job missing from its board's latest list is closed.
4. **Job Radar:** smart sections (For you, Alumni can refer, Fresher friendly, Closing soon), then all openings with filters for skills, branch, level, mode, type, location, fresher-friendly and "alumni here". Relevance uses your skills, branch and year; no hidden tracking.
5. **Saved jobs and tracker:** save, then move through applied, interviewing, offer, rejected or withdrawn, with a private note. The job's title and company are kept in the tracker even after the listing goes away.
6. **Alerts:** up to 5 saved searches, checked daily; matches arrive as one notification per alert (a new `jobs` category).
7. **Alumni at this company:** each job shows how many verified alumni work there (counting only those whose company is visible to you). Alumni who opt in to referrals (off by default, with a weekly cap) are listed for a one-tap request.
8. **Referral requests (`referrals:request`):**
   - The request carries why you fit, plus an optional PDF résumé (rebuilt like chat PDFs; only the two people can open it).
   - Limits: one open request per job and alumnus, 3 open and 5 a week per student, the alumnus's own weekly cap, a rate limit, a bot check and an idempotency key.
   - Requests expire after 14 days.
   - The alumnus can refer, with a note, or decline with a kind template; the requester can withdraw.
   - Each step sends a notification.
9. **Search:** the command palette finds jobs.
10. **Web:** Job Radar, job detail, posting form, tracker with alerts, Referrals (received, sent and settings), and admin Job sources.
11. **Tests:**
    - Adapters against recorded response shapes through a fake fetcher.
    - Normalisation and dedupe, expiry and closure.
    - Caps and limits, referral lifecycle and file access.
    - Isolation for every new collection.
    - Playwright: post → find → save → track → request a referral → refer.

## Assumptions

- **No job listing is invented.** Seed openings are posted by the fictional demo alumni at fictional companies and are marked DEMO. Real listings come only from sources an admin adds.
- **Terms:** the four ATS APIs are the vendors' documented public job-board endpoints, intended for showing a company's openings elsewhere. We show a snippet and link to the company's own apply page. robots.txt applies to RSS and career pages; documented APIs follow their API terms. Adzuna requires attribution ("Jobs by Adzuna") and its own keys, so it is off without them.
- **Starter boards** (Indian employers on these ATSs) are verified in GitHub Actions like news feeds (`jobs:verify`) and stay disabled until they pass. This container cannot reach those hosts.
- **Experience level** is inferred from the title and text (intern/fresher/junior/senior keywords and "N+ years"). It's a best effort, so it is shown as "about".
- **No in-app applications:** applying happens on the employer's site. The tracker is a personal list that nobody else sees.
