# Product analytics, first party (build B9)

Goal: answer "is it working?" with numbers, inside the app, with no third-party tracker. Colleges see their own product metrics; the platform sees every college side by side, from per-college counts only.

## Events

`ProductEvent {day, userId, anonKey, name, props, createdAt}` is a tenant collection (`modules/insights/insights.model.ts`).

- **`name`** comes from the closed list `PRODUCT_EVENTS` (`packages/shared/src/constants/insights.ts`): `visited`, `signed_up`, `invite_accepted`, `verified`, `request_sent`, `request_answered`, `session_completed`, `drive_registered`, `offer_verified`, `study_question`, `roadmap_step`.
- **`props`** keeps only ids (24 hex characters) and enum values (`[a-z0-9_]`, at most 40), at most five, with plain keys; anything else is dropped before saving. No text is ever recorded.
- **`day`** is the UTC day. `visited` is recorded at most once per member per day: deduplicated in memory, with a partial unique index (`one_visit_a_day`) as the backstop.

Services receive a `track` callback (`lib/product-events.ts`, like `award`) and call it after the confirmed write:

| Event               | Where                                                                   | Props                      |
| ------------------- | ----------------------------------------------------------------------- | -------------------------- |
| `visited`           | `UsersService.me()` (the app reads it on start)                         | none                       |
| `signed_up`         | `auth.onUserCreated` (email, phone and invite sign-ups), after consents | none                       |
| `invite_accepted`   | `OnboardingService.joinConfirm`                                         | `method`                   |
| `verified`          | `VerificationService.claim()` and the invite path                       | `method`                   |
| `request_sent`      | `RequestsService.create`                                                | `requestId`, `sessionType` |
| `request_answered`  | `RequestsService.respond` (accept or decline), for the mentor           | `requestId`, `outcome`     |
| `session_completed` | `SessionsService` when a booking completes, for the mentee              | `requestId`, `bookingId`   |
| `drive_registered`  | `PlacementsService.register`                                            | `driveId`                  |
| `offer_verified`    | `OffersService.decide` (verify) and `fromDrive`                         | `source`, id               |
| `study_question`    | `ChatService` after an answer is saved (not on regenerate)              | `subjectId`                |
| `roadmap_step`      | `RoadmapsService` when a step is marked done                            | `roadmapId`                |

**Who is recorded.** Only active adults (`UsersService.isActiveAdult`: B2's `adultOn`, never members under 18 or waiting for a guardian) who hold the `analytics_aggregate` consent. The answer is cached for 10 minutes per member and cleared when the member changes a consent in Settings. `track` never throws: analytics never breaks a write.

**Consent withdrawn.** Recording stops, and the member's past events are detached: `userId` is removed and one random `anonKey` keeps them countable without saying who they were. Erasure does the same.

**Retention.** Events are kept 13 months (`PRODUCT_EVENT_RETENTION_DAYS`, 395 days). The retention timer then rolls each expired day into `ProductEventDaily {day, name, count, members}`, which has no member in it, and deletes that day's events. The roll-up is idempotent: a day's counts are written once (`$setOnInsert`), so a crash between writing and deleting is safe to rerun.

## Metrics

`InsightsService.dashboard()` covers the last 12 weeks (Monday to Sunday, UTC). Every count leaves through `suppress()`; percentages and ratios are shown only when the counts behind them are 0 or at least 5.

- **Activation:** invite links sent (B4), sign-ups, of those verified, and of sign-ups at least 7 days old, those with a meaningful action (`MEANINGFUL_EVENTS`: request sent or answered, session, drive registration, study question, roadmap step) within 7 days.
- **Weekly actives by role:** members with any event in a week (students, alumni, staff), as a chart with a table view.
- **Retention:** for each of the last 8 signup weeks, the share of the cohort active 1 to 7 weeks later; cohorts under 5 show no percentages.
- **Mentorship:** requests sent, those that led to a completed session (by `requestId`), the conversion, and the median reply time (from `RequestsService.replyHoursSince`, shown from 5 replies). Quick chats have no session, so they never convert.
- **Placements:** for the graduating batch, the share of the college list that registered for a drive, verified job offers per 100 final-years, and study questions per active student.

Events start when B9 ships: there is no backfill, so the numbers grow from the first day.

## Views

- **Admin › Analytics** gains the tabs Activation, Retention, Mentorship and Placements for `analytics:tenant` (TPO, college admin), from `GET /admin/insights`. Faculty keep the overview they had.
- **Platform › Traction** (`/platform/traction`, `GET /platform/insights`, `platform:tenants`): each college's active members (7 and 28 days), sign-ups, requests, sessions, drive registrations, verified offers and study questions over 12 weeks, with totals. It reads through the named platform path `withPlatformScope('insights:platform-aggregates', …)`: one grouped pipeline over every college's events whose output is counts per college (member ids are collected and sized inside the database and never returned). Every read is audit-logged (`platform.insights_viewed`). It has its own screen, so the audited read happens only when someone opens it.

## Tests

`test/insights.test.ts`: adults with consent recorded and once a day for visits, minors and the unconsented never; props cleaned; consent withdrawal stops and detaches; activation, weekly actives by role, retention and conversion on a fixed fixture; the 13-month roll-up (once); permissions; college isolation; the platform path returns per-college counts only (no member ids) and is audited. `e2e/insights.spec.ts`: the TPO reads the tabs; the platform admin opens Traction.
