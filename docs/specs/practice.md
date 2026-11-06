# Aptitude and coding practice (prompt 2, G4)

Goal: daily practice tied to the companies that actually visit the college.

## Who does what

| Permission         | Who                                           | What                                                                       |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| `practice:use`     | students (alumni inherit it; staff do not)    | today's set, company sets, their own topic accuracy                        |
| `practice:author`  | alumni, faculty, TPO, college admin           | write a question (an alumnus's waits for review)                           |
| `practice:review`  | faculty, TPO, college admin                   | Admin › Practice questions: review, edit, tag companies, retire, AI drafts |
| `analytics:cohort` | faculty, TPO, college admin (already existed) | topic mastery by batch                                                     |

## The bank

`practiceitems`: `kind` (`mcq`, `numeric`, `output_prediction`, `coding`), `topic` (a closed list in five areas: quantitative, logical, verbal, data structures and algorithms, programming), `difficulty`, `companies` (`{key, name}`, the key from `lib/company.ts` so "Nimbus Labs Pvt. Ltd." and "Nimbus Labs" are one company), `text`, `code` and `codeLanguage` (a snippet shown with the question), `options` (MCQ), `answer` (MCQ: the right option's index; numeric: the value; output: the exact output), `tolerance` (numeric), `explanation`, `tests` (coding: hidden stdin → expected output), `source` (`starter`, `faculty`, `alumni`, `ai_generated`), `status` (`pending`, `approved`, `rejected`), `createdBy`, `reviewedBy`. Only `approved` items are served.

- **Starter set** (`modules/practice/starter-items.ts`): 53 original items, written for CampusLink, across every area, including 2 coding items. It is copied into a college's bank the first time anyone there opens practice (missing items only, so new starter items arrive on their own), so faculty can tag, correct or retire them like any other item. `ref` is permanent.
- **Never import copyrighted question dumps** (company papers, coaching books, websites). The module's [README](../../apps/api/src/modules/practice/README.md) says so, the author and AI prompts say so, and the authoring form reminds every writer.
- Faculty items go straight in. Alumni items wait as `pending`. AI drafts (`draftTask`, fast tier, feature `practice`, 20 calls a member a day) for a topic, kind and difficulty land as `pending`; drafts that fail the item rules (no right option, a numeric answer that is not a number, an output item without code) are dropped before saving.
- `itemProblem()` in shared is the one set of item rules: the API's Zod refinement, the form's live check and the draft filter all use it.
- Placement aptitude tests are set in English, so items are written in English; every screen around them is in the member's language.
- Rejecting an approved item retires it: it is no longer served, and sets that already hold it keep it.

## The daily set

Up to `PRACTICE_SET_SIZE` (10) items a day, made once per member per day (in the college's timezone) and resumed after that:

1. Items the member got wrong (or saw) that are due again, oldest due first, at most `PRACTICE_REVIEWS_MAX` (6).
2. New items: half of the rest from weak topics (accuracy below 60% with at least 3 answers in the last 90 days), spread round-robin across topics.
3. Seen items not yet due, soonest first, only when the bank has too few new ones.

The set is short rather than padded when the bank is small. Coding items are served only when the code runner is on.

**Spaced repetition** (Leitner boxes, `nextCard()` in shared): a wrong answer (or "Show the answer") puts the item in box 0, due tomorrow; each right answer moves it one box up: 1, 3, 7, 16, 35 days. `practicecards` holds one row per member and item: box, due day, last result, reps, lapses.

**Checking** (`checkAnswer()` in shared): MCQ by index; numeric by value within the item's tolerance (people's ways of typing numbers accepted: "1,200", "3/4", "1 1/2", "45%"); output after normalising line endings, trailing spaces and blank edges, as judges do. An answer is final: a second answer to the same question is refused (409), guarded in the update itself.

Finishing the daily set records `practice_set_completed` and awards XP kind `practice_set` (10 XP, cap 1 a day, through `lib/awards.ts`). The streak is consecutive days with a finished daily set (`currentStreak`). On the screen, a finished daily set is a "quiz complete" celebration moment (ADR 0008), once per device.

## Company prep

"Preparing for <company>" lists the companies whose tags appear on served items, with the next open drive's registration closing date from placements (`PlacementsService.recruitingCompanies()`), soonest first. A company set draws only that company's items with the same scheduling. Company sets earn no XP and are capped at `PRACTICE_COMPANY_SETS_PER_DAY` (5). The Interview Experience Bank entries (G10) join this page when G10 is built.

## Coding and the CodeRunner

Without a runner, coding is practised through output prediction and code-reading MCQs. Real execution goes through `CodeRunner` (`modules/practice/code-runner.ts`):

- `DisabledCodeRunner` (default): runs nothing; coding items are not served.
- `Judge0CodeRunner`: a **self-hosted** Judge0 the platform owner runs on an isolated network (`CODE_RUNNER=judge0`, `JUDGE0_URL`, optional `JUDGE0_AUTH_TOKEN`, `JUDGE0_LANGUAGES` to remap language ids). One synchronous submission per hidden test, base64-encoded, with `enable_network: false`, 2 s CPU, 5 s wall, 128 MB memory and a 1 MB file limit. Output is compared here with the output rules. Compile errors, time-outs and runtime errors are results (wrong); an outage is not: nothing is recorded and the member can try again. Code is never sent to a third party.
- `StubCodeRunner`: tests and local development.

The contract (`test/practice-runner.test.ts`) runs against the stub and against Judge0 behind a fake transport.

## Topic mastery by batch

Admin › Practice questions › Topic mastery (`analytics:cohort`): for each graduation year, how many students practised and, per topic, how many practised it and their accuracy, over the last 90 days. Counts below five show as "<5" (`suppress()`), and accuracy is shown only for groups of five or more, so no one is singled out. Nothing is ranked.

## Privacy

Export: sets with answers, the schedule (topic, box, due, reps, lapses) and questions written. Erasure: sets and schedule are deleted; questions the member wrote or reviewed stay with the college, unattributed. Another member's or another college's set is 404.

## API

| Route                                     | Access                |
| ----------------------------------------- | --------------------- |
| `GET /practice`                           | `practice:use`        |
| `POST /practice/sets` (`{company?}`)      | `practice:use`        |
| `GET /practice/sets/:id`                  | `practice:use`, owner |
| `POST /practice/sets/:id/answers`         | `practice:use`, owner |
| `POST /practice/items`                    | `practice:author`     |
| `GET /admin/practice/items?status=`       | `practice:review`     |
| `PUT /admin/practice/items/:id`           | `practice:review`     |
| `POST /admin/practice/items/:id/decision` | `practice:review`     |
| `POST /admin/practice/drafts`             | `practice:review`     |
| `GET /admin/practice/mastery`             | `analytics:cohort`    |

## Screens

`/practice` (today's set, streak, topic accuracy, company prep, "Write a question" for authors), `/practice/sets/:id` (one question at a time: answer, the result with the explanation, next; a summary at the end), Admin › Practice questions (To review, In use, Retired, Topic mastery; Add question; Draft with AI). Strings are in the `practice` language pack.

## Tests

`packages/shared/src/practice.test.ts` (scheduling maths, set planning, answer checking, item rules), `apps/api/test/practice.test.ts` (the daily set, mistakes coming back, XP once, company sets and their cap, coding through the runner, the review flow, AI drafts never served, permissions, mastery suppression, isolation, export and erasure), `apps/api/test/practice-runner.test.ts` (the runner contract, Judge0 requests and status mapping, coding hidden with the runner off, the starter bank's integrity), `apps/web/e2e/practice.spec.ts` (a daily set start to summary, adding a question; axe).
