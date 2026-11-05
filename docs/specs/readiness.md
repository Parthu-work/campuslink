# Readiness score and the TPO readiness board (prompt 2, G5)

Goal: one honest number per student that tells the student what to do next and the placement cell whom to help.

## The score

The score (0 to 100) is the sum of weighted components. Each component reports a **fraction** (0 to 1) of its points, the **facts** behind it (counts and numbers only) and its **next step**. Nothing else goes into the score: no hidden model, no comparison with other students.

```
max(c)    = weight(c) ÷ (sum of the weights of the scored components) × 100
points(c) = max(c) × fraction(c)
score     = Σ points(c)
```

Points and maxima are whole numbers apportioned by largest remainder, so the points shown always add up to the score and the maxima to 100 (`modules/readiness/score.ts › compose`).

A component is **skipped** and the remaining weights are scaled up to 100 when:

| Status           | When                                                                                      | The student sees                                           |
| ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `off`            | the college gave it weight 0                                                              | "Your college does not count this part."                   |
| `not_available`  | no component is registered for it in this build (practice, until G4 registers one)        | "Coming soon", plus a note that the score is scaled to 100 |
| `not_applicable` | the component has nothing to measure for this member (no college drive set a cut-off yet) | "Nothing to measure yet", plus the same note               |

Missing data that the student can add (no résumé, no academic record) is **not** skipped: it scores 0, and the next step says how to add it.

### Components

Each lives in its own file under `apps/api/src/modules/readiness/components/` and is registered in `app.ts` with `readinessService.register(component)`, like privacy hooks. A component reads only through the owning module's service and computes for all members of a request at once.

| Id            | Source (service method)                                       | Fraction                                                                                                                                                                      | Next step and its gain                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resume`      | `ResumesService.bestReportsFor` (G2)                          | best ATS score among the member's résumés ÷ 100; no résumé or never checked: 0                                                                                                | failed parseability checks: "fix N issues", gain = their missing points (× 100/60 when no role was given, as the ATS score itself is scaled); else up to five missing keywords (40 × k ÷ keywords); else check against a role (gain unknown) |
| `interviews`  | `InterviewsService.completedFor` (G3)                         | 0.4 × min(completed in 90 days, 3) ÷ 3 + 0.6 × (rubric average of the last three sessions − 1) ÷ 4                                                                            | under three mocks: "do one mock", gain = 0.4 ÷ 3 of the component (certain); else work on the weakest rubric dimension (gain unknown)                                                                                                        |
| `practice`    | G4 (`modules/practice/`), not in this build                   | —                                                                                                                                                                             | —                                                                                                                                                                                                                                            |
| `roadmap`     | `RoadmapsService.targetsFor`                                  | steps done ÷ steps of the published version of the **target roadmap**: the one with a weekly goal, else the one touched last                                                  | finish up to three more steps, gain = steps ÷ total; no roadmap followed: pick one (gain unknown)                                                                                                                                            |
| `mentorship`  | `SessionsService.completedAsMentee`                           | min(completed sessions as mentee in the last year, 2) ÷ 2                                                                                                                     | one more session, gain = 1/2                                                                                                                                                                                                                 |
| `eligibility` | `PlacementsService.cutoffsSince`, `AcademicsService.factsFor` | share of the college's own drives of the last two years with a CGPA or backlog cut-off (those for the member's branch, or all when none were) whose cut-offs the member meets | clear backlogs, or reach the nearest CGPA that opens more drives; gain = the share of drives it opens. No record: add it. A self-reported record waiting for verification scores 0 with no step until verified.                              |

Gains are shown in points (`gain × max`, at least 1, never more than the points left). A gain that cannot be known in advance (what a mock does to the average, an ATS check not yet run) is shown without a number. The student view lists the three next steps that add the most.

### Weights

`ReadinessConfig` (one document per college): `weights` (each 0 to 50; at least one above 0), `threshold` (default 50) and `closingDays` (default 7). Defaults (`DEFAULT_READINESS_WEIGHTS`): résumé 25, mock interviews 20, practice 15, roadmap 15, mentorship 10, eligibility 15. Changes are audited (`readiness.config_changed`, before and after).

## Who sees what

| Route                         | Permission         | Who                               |
| ----------------------------- | ------------------ | --------------------------------- |
| `GET /me/readiness`           | `readiness:view`   | students (not alumni, not staff)  |
| `GET /admin/readiness`        | `readiness:board`  | faculty, TPO, college admin       |
| `GET /admin/readiness/config` | `readiness:board`  | faculty, TPO, college admin       |
| `PUT /admin/readiness/config` | `readiness:manage` | TPO, college admin                |
| `POST /admin/readiness/nudge` | `readiness:manage` | TPO, college admin (`idempotent`) |
| `GET /admin/readiness/export` | `readiness:manage` | TPO, college admin (audited)      |

All routes belong to the `placements` feature switch. There is no route to another member's score: the score is never visible to other students or employers (G12 consent will be the only exception, through its own ADR).

**Minors** are never ranked: they are left out of the board's counts, the "needs help" list, nudges and the export. A minor still sees their own score.

## The board

- **Distribution** by batch and branch: students per band (0–19, 20–39, 40–59, 60–79, 80–100), every count through `suppress()`; the median only for groups of five or more.
- **Average points by part**, only when five or more students are counted.
- **Needs help**: students below the threshold whose next eligible drive (open, eligible by the drive's rules or an override, not registered) closes within `closingDays`, soonest first, at most 500. Each row: name, branch, batch, score, the drive and when it closes, the next step of the component with the most points left, when they were last nudged.
- **Filters**: branch and batch.
- **Export** (CSV or Excel): name, branch, batch, score, each scored component's points and the next drive closing; minors never; audited as `readiness.exported` with the row count and filters. No contact details.

## Nudges

The placement cell selects students on the "needs help" list and nudges them (at most `READINESS_NUDGE_BATCH_MAX` = 200 at once). Each nudge is a `readiness_nudge` notification (category `placements`) carrying the first name, the company, the drive id and the closing time, **never the score**. It goes:

- in the app, and by push or email per the member's preferences;
- by WhatsApp (`cl_readiness_nudge`, with the existing `drive_register` button) only to members who opted in with a verified number, within their weekly cap of two non-critical messages and the college's allowance (it is not critical), as for every WhatsApp message (`ChannelService`).

**The nudge cap**: a student is nudged at most once in `READINESS_NUDGE_COOLDOWN_DAYS` (7), whoever sends it. The nudge is recorded first (`ReadinessNudge`), and of two sent at once only the earlier one goes out. Students not on the list now (score up, drive closed, not a student, a minor, another college's) are skipped. The result says how many were sent, cooling off and not listed; the batch is audited (`readiness.nudged`).

## Data and privacy

Scores are computed on every read and never stored, so they cannot go stale or outlive the data behind them. Stored per member: `ReadinessNudge` (`userId`, `driveId`, `createdAt`), exported with the member's data and deleted on erasure (`privacyService.register('readiness', …)`). `ReadinessConfig` holds no member data.

## Product events

`readiness_nudged` (the nudged student, prop `driveId`), recorded after the nudge is sent, under the usual B9 rules (adults with the `analytics_aggregate` consent only).

## Web

- `/readiness` (`features/progress/readiness.tsx`, avatar menu › Readiness for students): the ring with the score, "You're at N.", the top next steps with their points, the note when parts were skipped, each part with its points, facts and next step, and the privacy line.
- Admin › Placements › Readiness board (`features/admin/readiness-admin.tsx`): figures, the "needs help" table with selection and the nudge dialog, distribution, averages by part, the weights dialog and the exports.
- Strings in the `readiness` language pack (`i18n/packs/readiness.<locale>.json`); core holds only the nav labels and the notification text.

## Tests

- `test/readiness-score.test.ts`: composition (points add up to the score, maxima to 100), skipping and re-normalising, weight 0, gains and their caps, every component's rule.
- `test/readiness.test.ts`: the student's own score; permissions (student, alumni, faculty, TPO); suppression and minors on the board; the "needs help" list; nudges, the cool-off and two nudges at once; the batch limit; weights and validation; export; privacy export and erasure; the feature switch.
- `test/isolation/readiness.test.ts`: scores, board, export, nudges, weights and erasure stay in their college.
- `test/privacy.test.ts`: the `readiness` exporter, export and erasure of nudges.
- `packages/shared/src/navigation.test.ts`, `apps/web/src/lib/readiness.test.ts`, `apps/web/e2e/readiness.spec.ts` (student view, board, weights dialog, faculty read-only; axe).

## Practice mastery (G4)

G4 is being built in parallel. When `modules/practice/` lands, add `components/practice.ts` (a fraction from the member's practice mastery through the practice service, and a `do_practice` next step with its link) and register it in `app.ts`. Until then the practice weight stays in the configuration, the component shows "Coming soon" and the rest are scaled to 100.
