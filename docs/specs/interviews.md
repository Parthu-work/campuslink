# Mock interviews with human follow-up (prompt 2, G3)

Goal: a final-year can practise an interview at 11 pm in their language, get honest feedback, then book a mock with an alumnus.

## A session

A member with `interviews:practice` (students; alumni inherit it; staff do not) picks:

| Choice     | Values                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Track      | `hr`; `technical` for a branch (their own by default); `drive` for a drive they can see                 |
| Difficulty | `easy`, `medium`, `hard` (nearest difficulty first when a level has too few questions)                  |
| Language   | `en`, `te`, `hi`, or `mixed` (answer in any mix)                                                        |
| Mode       | `text` or `voice` (voice only when a transcription service is reachable; otherwise the session is text) |
| Length     | 5 to 8 questions                                                                                        |

Every session opens with "Tell me about yourself". Then: HR questions for `hr`; technical questions for the branch (or the any-branch set) for `technical`; for a `drive`, up to two questions the AI writes for its role, then technical and HR. Questions the member saw in their last three sessions come last.

HR starter questions are asked in English, Telugu or Hindi. Technical questions are asked in English, as campus technical rounds are; the member may answer in any language. Questions the college adds are asked as written.

A member may start `INTERVIEW_SESSIONS_PER_DAY` sessions a UTC day (60 interview AI calls a day ÷ at most 13 calls a session = 4).

## Questions

- **Starter set** (`modules/interviews/starter-questions.ts`): 12 HR questions in three languages and technical questions for software (CSE, IT, AIML, DS), electrical (ECE, EEE), mechanical, civil and chemical, plus four any-branch questions. Each has a topic and a rubric (what a good answer covers).
- **The college's bank** (`interviewquestions`): `track`, `branch`, `difficulty`, `topic`, `text`, `rubric`, `source` (`faculty`, `alumni`, `interview_bank`, `ai_generated`), `status` (`pending`, `approved`, `rejected`), `createdBy`, `reviewedBy`. Faculty (`interviews:review`: faculty, TPO, college admin) add questions straight into the bank; questions the AI writes for a drive are used in that one session and wait as `pending` until faculty approve them (optionally edited) or reject them. Only `approved` questions are drawn.
- Admin › Interview questions: tabs To review, In the bank, Rejected; "Add a question".

## Answering and feedback

Each turn is `open`, `transcribing`, `answered`, `skipped` or `voice_failed`. An answer is stored first, then scored by `answerTask` (fast tier):

- `clarity`, `structure` (Situation-Task-Action-Result on HR questions), `correctness` (technical only; always null on HR) and `communication`, each 1 to 5;
- one evidence quote per score, which the service keeps only if it is found in the answer (case and punctuation aside), so no quote is invented;
- a tip of at most 30 words;
- one follow-up question built on the answer, at most one per question and three per session, inserted right after it.

When every turn is answered or skipped (or the member ends early, which skips the rest), `summaryTask` (deep tier) writes an overall note, up to three strengths and three things to work on; averages per dimension are computed from the scored answers. Without AI (not configured, budget, daily limit, provider failure), answers are kept unscored and a rules summary says so. No pass or fail, and nothing about any company's decision: the prompts forbid it and the screen says so.

Writes are optimistic (`rev`): an answer for a turn that is no longer the current one is refused (409), so a double submit never answers twice.

## Voice (E3)

The browser records with MediaRecorder (Opus in WebM or Ogg, AAC in MP4 on Safari; mono, 24 kbps, at most three minutes) and uploads the answer (`POST /interviews/:id/turns/:turn/audio`, ≤ 4 MB). It is stored as an `interview_audio` file with a one-hour deletion date, and `interviews.transcribe` runs in the worker: ffmpeg to 16 kHz mono MP3, then the platform's Whisper service (`WHISPER_URL`) or OpenAI with the college's own key (consent given, transcription on). The file is deleted whatever happens. A transcript becomes the answer (`answeredBy: voice`) and is scored like a typed one; an empty or failed one marks the turn `voice_failed` and the text box takes over. Transcription usage is recorded under `transcription` for the member.

## The human mock

The report links to the mentor list filtered to mock interviews (and to the drive's company when there is one). A `mock_interview` request may carry `interviewId`, one of the mentee's own finished sessions; its mentor may read the report while the request is open or accepted (anyone else gets 404). Every mock interview request records `human_mock_booked`.

## Progress

`GET /interviews` returns the sessions, today's allowance, whether voice is available, and the trend: per finished session, the average of each dimension. The page shows the latest averages with sparklines and a table of every session.

## API

| Route                                          | What                                                  |
| ---------------------------------------------- | ----------------------------------------------------- |
| `GET /interviews`                              | history, trend, today's allowance, voice availability |
| `POST /interviews`                             | start (idempotent)                                    |
| `GET /interviews/:id`                          | owner, or the mentor it was shared with               |
| `POST /interviews/:id/answers`                 | `{turn, text}`                                        |
| `POST /interviews/:id/skip`                    | `{turn}`                                              |
| `POST /interviews/:id/turns/:turn/audio`       | a recording (multipart `audio`)                       |
| `POST /interviews/:id/finish`                  | end now                                               |
| `GET/POST /admin/interview-questions`          | the bank by status; add a question                    |
| `POST /admin/interview-questions/:id/decision` | approve (optionally edited) or reject a pending one   |

## Events

`mock_started` (track, mode, language), `mock_completed` (track, answers), `human_mock_booked` (whether a report was shared).

## Privacy

Export (`interviews`): every session with its questions, answers (typed or transcribed), scores, evidence, tips and summary, and the bank questions the member wrote. Erasure deletes their sessions and any recording still waiting; questions they wrote or reviewed stay with the college without their name. Recordings are never kept.

## Tests

`apps/api/test/interviews.test.ts`: the draw (language, branch, introduction first); scoring with quotes from the answer, a follow-up, the double-submit guard and the summary; the rubric output schema; ending early; voice transcribed then deleted (file record, storage and the turn's file id); a failed transcript falls back to text and the recording is still deleted; non-audio refused; the bank (faculty only, pending never drawn, approve with edits, decided once); a drive session writes role questions into the review queue; the shared report (owner's finished session only, mentor reads, others 404, the event); isolation; the daily allowance; export and erasure. `interviews-text.test.ts`: a college without AI or transcription (voice off, everything unscored, rules summary). `apps/web/e2e/interviews.spec.ts`: an HR practice by typing to the report, and the faculty bank, with axe on each screen.
