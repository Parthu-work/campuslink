# Habit loops (prompt 2, G7)

Goal: a reason to come back every week, built from things students need anyway.

## The weekly Next Step

From **Monday 19:00 India time**, one job per college and ISO week (`habits.next_step`, job id `next-step-<college>-<YYYY-Www>`, queued by an hourly tick in `server.ts`) gives every active, verified student (`nextstep:view`: students, not alumni or staff) four things, each from the module that owns it:

| Item                | From                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One roadmap step    | `RoadmapsService.nextStepFor`: the target roadmap (the one with a weekly goal, else the one touched last), first step not done whose prerequisites are |
| One drive or job    | an open drive they are eligible for and have not registered for (`placements`), else the top "for you" job (`jobs.radar`)                              |
| One alumnus to ask  | the best match from `MentorsService.match` (peer mentors left out)                                                                                     |
| The readiness delta | G5's score now, against last week's saved score (only when readiness is available)                                                                     |

`nextsteps` holds one document per member and week (unique), so the job, a retry and the member opening Home before the run all end with the same one. Sending is claimed with `notifiedAt` (at most once per member and week). It goes out as `weekly_next_step`: WhatsApp template `cl_weekly_next_step` (first name and the step's title only; not critical, so the weekly cap and the college's allowance apply), and push, else email, when WhatsApp cannot carry it; it is also in the in-app list. Members turn it off in Settings › Notifications (`weeklyNextStep`, on by default). Nothing is sent when there is nothing to suggest.

Home shows the card (lazy, with the `habits` pack); `/next-step` is where the message links. Each item opens with one tap; `POST /me/next-step/open {item}` records `next_step_opened` once per item and week.

## Peer mentors (`peerMentors` switch)

A **final-year with a verified offer**, or a student **a faculty member nominated** (`peers:manage`), can turn peer mentoring on (`PUT /me/peer/mentor`). It grants the `PEER_MENTOR` capability (`mentorship:mentor`) and creates lighter mentor settings: students only, quick chats and short calls, two requests a week by default and at most three (`PEER_WEEKLY_CAP_MAX`, enforced on every settings save). Capabilities are read per request, so nothing about tokens changes (E7).

It is the same request flow as alumni mentoring: requests carry `peer: true`. Peer mentors appear in matching and can be requested only by **juniors** (a later batch, from the profile itself even when the batch is hidden) and only while the college has the switch on; anyone else gets "not found". Withdrawing a nomination ends peer mentoring for a student without an offer.

## The Senior Buddy

Seniors (verified students past their first year) volunteer (`PUT /me/peer/buddy`). Every first-year (`isFirstYear`: graduating 37 to 50 months out) without a buddy is matched by a daily job per college (`peers.buddy_match`, also "Match now" in Admin › Peer mentors and buddies): same branch first, then a shared language, then the least busy senior (`buddyScore`), at most three first-years each (`BUDDY_MAX_JUNIORS`). One live buddy per first-year is a unique index, so two runs never double-match. Both are told (`buddy_matched`) and work through a four-week checklist (hello, campus, study, plan), ticked by either. A senior who steps down hands their first-years back to matching. Staff see counts only, suppressed under five.

## Circles

`circles` and `circlemembers`: communities per batch, branch, club or interest. Staff (`circles:manage`) create active circles; students and alumni (`circles:propose`) propose circles that wait for approval (at most three waiting each) and lead them once approved. A batch circle is for its batch and a branch circle for its branch; clubs and interests are open.

They are built on the existing content, not a new system: **posts, questions and events carry a `circleId`** and one shared `CircleScope` (`lib/circle-scope.ts`, set from `CirclesService`) keeps them to members everywhere they are read: the feed and every post list, a post by id, saved posts, Q&A lists, search and a question by id, events lists and an event by id. Outside members get "not found". Only members post, ask or hold events in a circle; announcements stay college-wide. Moderation is the existing framework's (questions are still approved by a moderator; posts and answers can be reported). Students post in a circle where the college allows student posting (Admin › Features), the college's moderation choice; they can always ask.

## Study groups (`study` switch)

`studygroups`: 3 to 6 members on one study subject the member can read. The group "forms" when the third member joins (`study_group_formed`), and a seventh is refused. Members keep a shared list of questions (ticked when done), set the next session's time and place, and **share one of their own study assistant `/quiz` answers** (`GET /me/quizzes` lists them); every member takes a shared quiz once and sees the answers and explanations only after answering. The question list and quizzes are for members only.

## Voice Q&A

Ask (`POST /questions/voice`) or answer (`POST /questions/:id/answers/voice`) by voice, up to **60 seconds** (the browser stops recording at a minute; the server refuses anything longer). The recording is stored as `qa_audio` for at most an hour and transcribed in the worker (`qa.voice_transcribe`) by the same providers as mock interviews (E3: the Whisper service first, else OpenAI with the college's own key). Then:

- a question's transcript becomes its text (first sentence the title) and goes to moderation like a typed one;
- an answer's transcript is published, counted and the asker told;
- the recording is **deleted unless the author chose to keep it** (`keepAudio=true`), in which case readers who may see the question get a play button beside the text;
- nothing heard, or over a minute: `voice_failed`, the author is told and types it instead.

The author can always correct the transcript (`PUT /questions/:id/transcript`, `PUT /answers/:id/transcript`). The `voice_question` event is recorded for both.

## Events

`next_step_opened`, `buddy_matched`, `circle_joined`, `study_group_formed`, `voice_question`.

## Privacy and isolation

Export: Next Steps, the peer nomination and buddy volunteering, buddy pairs and checklists, circle memberships and proposals, study groups (questions added, quiz results), voice questions and answers. Erasure: all of these go; a first-year whose buddy left is matched again; circles and study-group questions they wrote stay with the college, unattributed; kept recordings are deleted with their questions and answers. Everything is per college (tenant-filtered models); another college's circle, group or pair is "not found".

## Tests

`packages/shared/src/habits.test.ts` (ISO weeks across year ends and in India time, the send time, first-years, buddy scoring, circle and group bodies); `apps/api/test/habits.test.ts` (12: the week in the job id, one Next Step per week however often the job runs, built early, opens recorded once, staff excluded; peer eligibility by offer and nomination, juniors only, peer requests, the caps, withdrawal; buddy volunteering, matching by branch with the cap and once, the checklist by either side only, stepping down; export and erasure); `apps/api/test/circles.test.ts` (10: proposals and approval, batch circles, posts, questions and events for members only everywhere, leaving, isolation; study groups forming and capped, the shared list, quizzes taken once; privacy); `apps/api/test/voice-qa.test.ts` (6: transcript to question and moderation, audio deleted or kept, failures and the length cap, editing, voice answers, permissions, erasure); `apps/web/e2e/habits.spec.ts` (the Next Step from Home, a circle created and joined and asked in, peer mentoring and a study group; axe).
