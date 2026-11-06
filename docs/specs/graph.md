# The moat data (prompt 2, G10)

Goal: every placement season leaves knowledge behind that juniors use and that no other college has: where seniors went and how the rounds went (the Placement Graph), what they were asked (the Interview Experience Bank), and which mentors' help led somewhere (outcome-proven matching). Everything is per college and behind the `placements` feature switch.

## The Placement Graph

Built by `GraphService` (`apps/api/src/modules/graph/`), as pure functions in `compute.ts` over rows each owning module returns through its service:

| Input                                                  | From                             | Used for                                   |
| ------------------------------------------------------ | -------------------------------- | ------------------------------------------ |
| Verified offers (`OffersService.graphRows`)            | placements                       | placed, batches, bands, branches, outcomes |
| Drives that started, rounds, results (`graphRounds`)   | placements (entered by the cell) | rounds and pass rates, interview outcomes  |
| Referrals made and the outcome students reported       | referrals (`outcomeRows`, G8)    | referral success, matching                 |
| Verified alumni who show their company to all members  | profiles (`alumniCompanies`)     | alumni there                               |
| Alumni taking requests (`MentorsService.acceptingIds`) | mentorship                       | alumni there who mentor                    |
| Completed sessions (`SessionsService.completedSince`)  | sessions                         | sessions with them, matching               |
| The cell's company list (`recruitingCompanies`)        | placements                       | names; every listed company has a page     |

Per company (`companygraphs`, one row per company and college): distinct students with a verified **job** offer (internships are not placements; a student with two offers counts once), offers and the median CTC band per batch, offers per branch, drives with results, per round kind how many sat it and cleared it (pending and absent do not count), alumni there, those who mentor, their completed sessions, and referrals by alumni there (referred, outcome reported, interview or offer). Nothing in it names or points to a member; exact CTCs are used only to pick the median band.

**Nightly.** From 02:00 India time an hourly tick (`server.ts`) queues `graph.nightly` once per college and day (job id `graph-<college>-<day>`); the run replaces the college's rows and deletes companies no longer on record. A college that opens company pages before its first run gets today's run queued then (same job id). `pnpm seed` builds the demo colleges' graph (`scripts/seed-graph.ts`).

**Shown** (`GET /companies`, `GET /companies/:key`, permission `companies:view`: students, alumni, staff):

- every count through `suppress()`: under five reads "<5";
- the median band of a batch only from five offers; a round's pass rate only from five who sat it; the referral rate only from five reported outcomes;
- "N from your branch" from the viewer's own profile branch;
- the company's published write-ups.

`company_page_viewed` is recorded once per member, company and day (per process), with no properties.

## The Interview Experience Bank

A write-up (`interviewexperiences`): company, role, year, rounds (kind, name, questions in the author's words, notes), tips, difficulty, result, and whether to show the author's first name (otherwise "A senior" with branch and batch, kept on the write-up).

- **College-verified authors** (`experiences:share`, students and alumni; only verified members hold it): a student writes about a company they have a **verified offer** from or whose **campus drive they sat**; an alumnus about any company. The badge says which (`verified_offer`, `drive`, `alumni`). Anyone else gets 403.
- **Reviewed first.** A write-up is `pending` until the placement cell or faculty (`experiences:review`, Admin › Interview write-ups) publish it or send it back with a note the author sees (`experience_published`, `experience_returned`). The author can withdraw it until it is published. Text is stored as plain text.
- **Moderated after publishing** through `ModerationService` (target `experience`): reports (`/reports`), removal with a reason the author sees (`content_removed`), appeals to a second moderator.
- **Questions flow into the banks only after their own review.** While publishing, the reviewer picks questions for the mock interview bank (G3): they arrive `pending` with source `interview_bank` and are drawn only after faculty approve them in Admin › Interview questions. From a published write-up a reviewer can write a question up as a practice item (G4, the practice form prefilled with the question and company); faculty items go into the practice bank directly, and the question is marked as used. Practice company prep links each company to its page.
- **The 7-day prompt.** The nightly run gives every offer verified in the last 30 days one `experienceprompts` record (unique per offer, the claim) and a delayed job `graph.experience_prompt` due 7 days after verification (job id `expprompt-<offer>`). It sends `experience_prompt` once, and not at all if the member already wrote about that company. It goes in-app, by push or email, and on WhatsApp (template `cl_experience_prompt`) to members who opted in, within their weekly cap. The prompt fires 7 days after verification; only an offer verified more than 7 days before the next nightly run (an outage) is asked at once instead.
- `experience_shared` is recorded when a write-up is sent (with its basis only).

## Outcome-proven matching

The same nightly run writes, per mentor (`mentoroutcomes`), what their mentees reached **after their first completed session together**: a verified offer dated after it, an interview round (technical, HR or group discussion) of a campus drive held after it, or a referral after it that the student said led to an interview or offer; each mentee is a line with their branch, the companies and how far they got (no id). Plus the mentor's own referrals that converted.

`scoreMatch()` (`modules/mentorship/mentors.service.ts`) gains a bounded, deterministic term (`OUTCOME_MATCH`, `outcomePoints()` in shared): +4 per mentee like the viewer (same branch; or, when that is under two, aiming at a company the viewer targets) up to +12, +3 per converted referral up to +6, never more than +15 in all, and nothing under two outcomes. The score stays within 0 to 100. Reasons in plain words: "Helped 3 students from your branch reach interviews or offers", "Their referrals led to 2 interviews or offers" (loaded on the mentors screen as a part with the `moat` pack). Only while placements are on.

## Privacy

- `interviewExperiences`: export the member's write-ups and prompts; erasure deletes unpublished write-ups and prompts and keeps published ones as a former member's (no author, no name), like answers.
- `mentorOutcomes`: export and erase the mentor's own summary.
- Company rows hold aggregates only.

## Screens

`/companies` (search, cards), `/companies/:key` (figures, by batch, rounds, referrals, write-ups; ask an alumnus there, practise, share), `/experiences/new` (the form), `/experiences` (one's write-ups and their status), Admin › Interview write-ups (to review, published, sent back). Strings are in the `moat` pack; nav and admin labels and the three notifications are in the core files.

## Tests

`apps/api/test/graph-compute.test.ts` (graph computation on fixtures: distinct students, internships, bands, rounds; mentor outcomes before and after sessions; evidence; the bounds of the term; `scoreMatch`), `test/graph.test.ts` (nightly scheduling and idempotency, suppression and shares from five, verified records only, visibility, events, permissions, the feature switch, matching through `/mentors/match`, authors, review, the interview bank queue, moderation, send back and withdraw, the 7-day prompt, export and erasure), `test/isolation/graph.test.ts`, the privacy exporter list, `navigation.test.ts`, `apps/web/e2e/companies.spec.ts` (share, publish, read; axe on every screen).

## Known gaps

- `content.experience` (the content name in moderation notices) is not in the core language files yet (the core files are frozen to three anchors while the branches are parallel); the report menu gets it from the pack. G13 adds it.
