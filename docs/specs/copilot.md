# The Career Copilot (prompt 2, G11)

Goal: a student's 11 pm question ("Can I get into X with a 6.8 CGPA? What did seniors do?") gets a cited answer from the college's own data, then a human.

Students only (`copilot:use`), behind the `placements` feature switch. Screen: `/copilot` (strings in the `copilot` pack).

## Sources

Every answer is built only from numbered sources, each checked for the asking member **on every read**:

| Kind         | What                                                                                      | How it is found                     | Re-checked by                                              |
| ------------ | ----------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `company`    | The Placement Graph's company page as text, with the page's own rules (suppressed counts) | indexed                             | `GraphService.hasCompanies` + `companies:view`             |
| `experience` | Published Interview Experience Bank write-ups (never the author)                          | indexed                             | `ExperiencesService.publishedAmong` + `companies:view`     |
| `roadmap`    | Published roadmaps (library and the college's): summary and every step                    | indexed                             | `RoadmapsService.list` (what the member may read)          |
| `drive`      | Drives students can see: roles, announced pay range, rounds, who can apply                | indexed                             | `PlacementsService.list` + `placements:view`               |
| `mentor`     | Alumni mentor cards: name, title, company, topics, reply time (the member's visibility)   | live, per question                  | `MentorsService.list` / `match` (visibility, blocks, caps) |
| `me`         | The member's own résumé score, CGPA and backlogs, eligible drives, readiness              | live, per question, private to them | the owning services, as the member                         |

**The index** (`modules/copilot/`, `copilotchunks`): the four college-wide kinds as passages of up to 1,200 characters, rebuilt from 03:00 India time by one job per college and day (`copilot.index`, job id per college and day, an hourly tick in `server.ts`; `pnpm seed` builds it). Unchanged passages are kept; new or changed ones are embedded with the college's embedding model (usage under the `copilot` feature) and their vectors kept on the passage; sources that went away are deleted with their vectors. Nothing private to a member is indexed.

**Search** goes through `VectorIndex` with new source kinds: each kind has a per-college scope id (a hash of the college and the kind) that the store's required subject filter takes, and the vector's `materialType` is `copilot_<kind>`; the store's tenant, subject and model checks are unchanged. Words (`$text` through `db/search.ts`) and meaning are fused (reciprocal rank fusion), a company named in the question brings its own passages first, and every passage is re-read from MongoDB and dropped unless its source passes the check above. An in-memory store gets the college's copilot vectors back from the passages once per process.

## Answering (E1, E2)

1. **Commands** (`parseCopilotCommand`): `/eligible` lists the drives the member can register for now; `/mock <company>` links to mock interviews (G3) for it; `/resume [role]` to the résumé builder (G2); `/plan` is a four-week plan of roadmap steps, the daily practice set, mock interviews and an alumnus (no AI); `/prep <company>` is answered like a question about preparing for that company, with a link to its page.
2. **Predictions are refused** (`asksForPrediction`: a salary someone will get, a guarantee, chances, "will I get selected"), before any AI call.
3. **Not covered**: nothing found, or what was found does not cover the question (similarity under 0.3 and word coverage under 60%, unless a company is named) is refused before any AI call.
4. **The answer** goes through `AiTasksService.stream` (`copilotAnswerTask`, fast tier, feature `copilot`, at most 700 tokens): the college's model or the platform default, the plan's allowance and budget, the member's daily limit (`AI_FEATURE_LIMITS.copilot`, 40), the breaker. Sources are numbered `<source kind="document">` blocks first (`documentsFirst`), the question last as the member's block after `redactPersonal()`; documents go through `neutraliseInstructions()`. The rules: only the sources, cite each fact `[n]`, never predict salaries, selection or admission or promise outcomes, never invent companies, people, numbers, cut-offs or questions, answer in the question's language (`detectLanguage`), no links or HTML.
5. **Citations are required**: an answer with no valid `[n]`, or `NOT_COVERED`, becomes the not-covered refusal. Only cited sources are kept with the answer.
6. **Without AI** (not set up, budget, today's limit, an outage) the best three sources are shown themselves, cited (`sources_only`), never an error.
7. **Up to two human next steps** under every answer and refusal: an alumnus to ask (at the company in question when there is one, with their median reply time), then the soonest drive the member can still register for (that company's first), else the next office hours.

Minors get the same copilot without personalised ranking signals: no readiness score among their sources, and no mentors from personal matching (only the company's alumni by name).

Streaming: `POST /copilot/chat` sends the study assistant's server-sent events (`start`, `sources`, `delta`…, `done`, `error`); the web reader is `features/copilot/stream.ts` and answers render with the study assistant's `AnswerText` (citations carry their own link).

## Conversations

`copilotsessions` and `copilotmessages`, the member's own (another member, staff or another college gets 404/403), deleted 180 days after the last message (TTL), deletable by the member. Model text is stored with `modelText()`.

## Events

`copilot_question` (the command, if any) and `copilot_handoff` (the kind of next step opened, only on the member's own answer).

## API

| Route                          | What                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `GET /copilot`                 | conversations, questions left today, whether AI is on |
| `POST /copilot/chat`           | ask or run a command (server-sent events)             |
| `GET /copilot/sessions/:id`    | one of my conversations                               |
| `DELETE /copilot/sessions/:id` | delete it                                             |
| `POST /copilot/handoff`        | a human next step was opened                          |

## Cost

Measured on the demo model with the app's four-characters-a-token estimate: one answer with eight sources is about 1,330 input tokens and up to 700 output (a real model writes about 150 words, roughly 250 tokens), plus a question embedding of about 20 tokens. Refusals and commands cost nothing. The daily index embeds only new or changed passages. Details: `docs/ai-assistant.md`.

## Privacy

Export (`copilot`): conversations and messages. Erasure deletes both. The index holds college-wide content only (no privacy hooks needed).

## Tests

`apps/api/test/copilot.test.ts` (the index and its schedule; citations required and every citation linked; human next steps; prediction and not-covered refusals with no AI call; no-AI fallback; each indexed kind taken down after indexing is never shown; the member's own facts private to them; minors without ranking signals; the five commands; handoff events on one's own answers only; private conversations; permissions; export and erasure), `test/copilot-injection.test.ts` (hostile text in every source kind and in the question, at the prompt and end to end), `test/isolation/copilot.test.ts` (index, search by words and meaning across colleges in one vector store, conversations, next steps), the privacy exporter list, `apps/web/e2e/copilot.spec.ts` (answer, refusal, command, history; axe).
