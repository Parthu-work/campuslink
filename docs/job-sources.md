# Job sources

Openings come from three places:

1. **Posted in the app:** members with `jobs:post` (alumni, TPO, faculty, admins) post openings.
2. **Imported:** the placement cell or admins (`jobs:sources`) add sources, which are imported on a schedule.
3. **Demo data:** clearly marked DEMO, at fictional companies, with links on the reserved `example.com` domain.

Every listing links to the employer's own page; applying always happens there.

## Adapters (`JobSourceAdapter`, `apps/api/src/modules/job-sources/adapters.ts`)

| Kind              | Endpoint (public, read-only)                                       | Notes                                                                                                           |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `greenhouse`      | `GET boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true` | Greenhouse Job Board API. The description is entity-escaped HTML; we keep a 1,500-character plain-text snippet. |
| `lever`           | `GET api.lever.co/v0/postings/{board}?mode=json`                   | Lever Postings API; salary only when the posting states a range.                                                |
| `ashby`           | `GET api.ashbyhq.com/posting-api/job-board/{board}`                | Ashby public job board; unlisted postings are skipped.                                                          |
| `smartrecruiters` | `GET api.smartrecruiters.com/v1/companies/{board}/postings`        | Public postings list (no descriptions in the list; we show function, level and department).                     |
| `adzuna`          | `GET api.adzuna.com/v1/api/jobs/in/search/1`                       | Needs the deployment's own `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (free tier); cards say "Jobs by Adzuna".        |
| `rss`             | any RSS/Atom URL                                                   | Government notices and company career feeds through the Phase 4 polite fetcher (robots.txt included).           |

To add another source, implement `target`, `attribution` and `fetch`, returning `RawJob[]`, and add the kind to `JOB_SOURCE_KINDS`.

**Fetching rules:**

- Every request goes through `safeFetch`: HTTPS only, public IPs, pinned DNS, 20-second timeout, 8 MB cap.
- Requests identify as `<APP_NAME>Bot/1.0`.
- 429 and 503 responses honour `Retry-After`. Failures back off up to two days.
- The vendors' documented public APIs are used under their API terms. robots.txt governs crawling of pages and feeds, so it applies to `rss` sources.

## Normalisation (`modules/jobs/normalize.ts`)

- **Text:** titles, companies and locations become plain text. Descriptions become a snippet.
- **Mode, type and level:** read from the posting's own fields first, then from keywords and "N+ years" phrases. The level is shown as "about" for imported jobs.
- **Skills:** a fixed vocabulary (`SKILL_VOCABULARY`). Short or ambiguous names (C, R, Go, REST, Express, Spring) only match in clear forms ("C/C++", "Golang", "REST APIs").
- **Branches:** the source's branches, plus keyword hints (VLSI → ECE, STAAD → Civil, …).
- **India only:** on by default for ATS boards, since they list worldwide. A posting is kept only if its location names India or an Indian city.
- **Duplicates:** `sha256(companyKey | title | first location part)`, unique per college. The first source to list a job keeps it.
- **Company names:** `companyKey` drops case, punctuation, bracketed notes and legal forms ("Pvt Ltd", "Limited", "Inc"). The same key is stored on profiles for "alumni at this company".
- **Expiry and closure:**
  - Posted jobs expire after the poster's chosen 7–60 days.
  - Imported jobs stay listed 21 days after they were last seen. An ATS board is authoritative: a job missing from its latest list closes, and reopens if it returns.
  - Ended listings are deleted 60 days later (TTL). Tracker entries keep their title and company.

## Verified starter boards

`modules/job-sources/starter.ts` lists candidate boards of employers that hire in India. They stay disabled until `pnpm --filter @campuslink/api jobs:verify` passes for them in GitHub Actions (`feeds.yml`, job `boards`). A pass means the API answers and lists at least one opening in India. Results are reported as a workflow annotation, and the job turns red only when an already verified board regresses.

### Verification results

GitHub Actions run of 2026-10-16 (`feeds` workflow, job `boards`, commit d27f6bb):

| Board           | Result                          | Status                |
| --------------- | ------------------------------- | --------------------- |
| gh-rubrik       | pass: 133 postings, 33 in India | verified 2026-10-16   |
| gh-druva        | pass: 34 postings, 12 in India  | verified 2026-10-16   |
| lv-cred         | pass: 7 postings, 7 in India    | verified 2026-10-16   |
| lv-meesho       | pass: 58 postings, 58 in India  | verified 2026-10-16   |
| lv-zeta         | pass: 24 postings, 21 in India  | verified 2026-10-16   |
| ab-atlan        | pass: 7 postings, 4 in India    | verified 2026-10-16   |
| sr-servicenow   | pass: 100 postings, 7 in India  | verified 2026-10-16   |
| sr-bosch        | pass: 100 postings, 14 in India | verified 2026-10-16   |
| gh-postman      | failed: board not found         | removed from the list |
| gh-phonepe      | failed: board not found         | removed from the list |
| gh-browserstack | failed: board not found         | removed from the list |
| gh-thoughtspot  | failed: board not found         | removed from the list |
| lv-razorpay     | failed: board not found         | removed from the list |
| sr-visa         | failed: no postings returned    | removed from the list |

Those employers may use another ATS or board name; an admin can add their current board after testing it.
