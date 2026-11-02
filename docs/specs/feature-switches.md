# Feature switches (build B1)

## Goal

Each college runs a focused product: Admin › Features turns whole parts of the app on or off without deleting anything, and a switched-off part disappears everywhere (navigation, Create sheet, command palette, saved links) while the API refuses it.

## Data

`Tenant.features` holds one boolean per switch (`packages/shared/src/features.ts`, zod-free so the web app's first load can read it):

| Switch            | What it covers                                                         | New college | Before B1 |
| ----------------- | ---------------------------------------------------------------------- | ----------- | --------- |
| `studentPosting`  | Students may publish feed posts (a permission grant, not a module)     | off         | stored    |
| `stories`         | Stories on Home                                                        | **off**     | stored    |
| `reels`           | Reel posts, video uploads, the Reels page                              | **off**     | on        |
| `leaderboards`    | The leaderboard and its opt-in                                         | **off**     | stored    |
| `alumniMatch`     | The swipe view on Mentors and match preferences                        | on          | stored    |
| `jobsAggregation` | Job sources (admin) and fetched openings in Jobs                       | on          | stored    |
| `contentSources`  | RSS/Atom sources (admin), following sources, outside items in the feed | **off**     | on        |
| `study`           | Study library, assistant, AI settings and their jobs                   | on          | on        |
| `placements`      | Placement drives (B7)                                                  | on          | on        |
| `whatsapp`        | WhatsApp channel (B3)                                                  | on          | on        |
| `peerMentors`     | Reserved for prompt 2                                                  | on          | on        |

"Before B1" is `LEGACY_FEATURES`: a college created earlier keeps what it had. The migration `b1-explicit-feature-switches` (`apps/api/src/db/migrations.ts`) writes those values for every switch a college never stored; `resolveFeatures()` applies the same values on read, so a lean read never sees a missing switch.

Student posting stays off for new colleges even though the brief says "everything else true": it is a moderation policy a college opts into, not a module (security and privacy first). Recorded in the progress log.

## API

- `RouteSpec.feature`: the pipeline checks it right after the tenant scope (`featureGate`), so a switched-off route answers `403 FEATURE_DISABLED` before authentication. `withFeature(feature, specs)` marks a whole module (study, AI settings, study materials, study chat, content sources, job sources).
- Content inside shared routes is checked in the service (`featureEnabled`, `requireFeature` in `modules/tenants/features.ts`): reel posts (create, list, open, feed), source follows and outside items in the feed, fetched openings in Jobs (list, Radar, search, alerts, the job page).
- Background jobs of a switched-off feature do nothing (`gatedJob`): source fetches, job-source fetches, study processing and embedding back-fills.
- The admin overview leaves out Study's queues while Study is off.
- `docs/permissions.md` marks every gated endpoint with its feature.

## UI

- `featureShipped()` removes a switched-off feature's destinations from the shipped set passed to `buildNav()`; admin sections of a switched-off feature are hidden through `NavSubject.features`. Tabs fall back as they do for unshipped screens.
- Screens declare their feature in the router (`inFeature`); a saved link to a switched-off screen shows "Your college has switched this off" instead of failing.
- Home skips the stories read, the composer drops the reel kind, Mentors shows the list alone without Alumni Match, and Progress hides the leaderboard link and opt-in.
- Admin › Features lists every switch with a one-line explanation.

## Privacy

Nothing new is collected. Switching a feature off hides its content; nothing is deleted.

## Tests

- `packages/shared/src/navigation.test.ts`: every switched-off destination is hidden for every role, tabs fall back, admin sections hide, defaults.
- `apps/api/test/features.test.ts`: new-college defaults, every gated route (from the registry) answers `FEATURE_DISABLED`, reels, outside content, fetched jobs, gated jobs, the overview, the migration (values, idempotence, failure retry).
- `apps/web/e2e/features.spec.ts`: an admin switches Study off; a student no longer sees it and a saved link explains why.

## Acceptance

Switching each feature off hides it everywhere and the API refuses it; switching it back on restores everything as it was.
