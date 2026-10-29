# Mentorship loop that never dead-ends (build B5)

Goal: every request gets an answer, or a better option, within 48 hours.

## Nudge and rematch

Each request now has a `version` (bumped on every change of status), `nudgedAt`, `rematchOfferedAt` and `rematchOf`. Sending a request schedules two delayed jobs next to the existing expiry job. Their job ids carry the request id (`reqnudge-<id>`, `reqrematch-<id>`), their data carries the version, and both do nothing unless the request is still `pending` at that version. Accepting, declining, withdrawing, expiring or blocking cancels them.

| After | Job                  | What happens                                                                                                                                                                                                                 |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24 h  | `mentorship.nudge`   | One reminder to the mentor (`request_nudge`): on WhatsApp with Accept and Decline buttons (template `cl_request_waiting`, signed actions from B3) when the mentor opted in, otherwise push or email. Sent once (`nudgedAt`). |
| 48 h  | `mentorship.rematch` | The mentee's matches are computed as them (`backgroundAuth`). If any mentor is likely to reply, the mentee is told (`request_rematch`) and the request is marked `rematchOfferedAt`. No suggestions, no message.             |

**Who is suggested** (`MentorsService.alternatives`, at most three): the mentee's Alumni Match list without the mentor they are waiting on, without mentors at their weekly cap (only open mentors are matched), and without mentors whose median reply time is over 72 hours. Mentors without enough history are not excluded.

**One tap** (`POST /mentorship/requests/:id/rematch` with a mentor id): allowed once the request is two days old or the offer was made. The new mentor is checked first (requestable, not the same mentor), then the waiting request is withdrawn and the same message (and session type) goes to the new mentor. The new request has `rematchOf` set and does not count against the college's `mentorshipRequestsPerWeek`. If sending fails, the old request goes back to pending.

## Mentor stats

`MentorsService.baseStats()` computes, per mentor, over 90 days, cached for an hour per college and mentor:

| Figure             | From                                                                 | Shown                    |
| ------------------ | -------------------------------------------------------------------- | ------------------------ |
| Median reply hours | accepted or declined requests: `respondedAt − createdAt`             | from 3 answered requests |
| Reply band         | answered ÷ (answered + expired): high ≥ 80%, medium ≥ 50%, low below | from 3 decided requests  |
| Sessions completed | completed bookings (`SessionsService.completedCounts`)               | always                   |
| Rating             | average rating of published reviews                                  | from 3 reviews           |
| Review count       | published reviews                                                    | always                   |

The next free slot is computed for the viewer (both calendars, 14 days) and is not cached. Cards in Browse and Alumni Match, the mentor page and the rematch sheet show these as `MentorCard.stats`; each piece is hidden while it is null.

## Reviews

After private feedback on a completed session, the mentee may publish one short public review (`POST /bookings/:id/review`, 10 to 280 characters, plain text through `plainText()`). It carries the feedback's rating, the session type and the reviewer's first name only. The private feedback (tags, comment) stays private.

- Model `MentorReview` (one per booking), `ModeratableHandler` registered as content target `review`, report target `review`. Removal carries a reason the author sees; appeals work as for posts.
- Reviews are listed on the mentor page (`GET /mentors/:id/reviews`, same visibility as the mentor page) with a report menu.
- Privacy: `exportFor` returns the reviews a member wrote; `eraseFor` deletes the reviews they wrote and the reviews about them.

## Matching quality

`scoreMatch()` takes optional signals and adds bounded, deterministic terms:

- reply speed: +10 when the median reply is within a day (reason "Replies within a day"), +5 within two days, +2 within three;
- load: −10 once pending requests reach the weekly cap, −5 for each one over, at most −15;
- the score stays within 0 to 100.

The "works at a company you're targeting" term already existed (+30, Phase 3, using the mentor's normalised company against the mentee's target companies). It is not added a second time.

## Tests

`test/mentorship-loop.test.ts` (job timing and versioning, rematch exclusions, the weekly limit untouched by a rematch, stats suppression, scoring, reviews and moderation, reports), `test/isolation/mentorship-loop.test.ts`, a privacy case, and `e2e/mentorship-loop.spec.ts`.
