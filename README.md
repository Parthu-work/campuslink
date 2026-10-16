# CampusLink

A private guidance network for a college community, connecting students with alumni from their own college. It is multi-tenant: each college gets its own branded, isolated space.

> Status: **Phase 3 (mentorship)**: Alumni Match, structured mentorship requests, booking with timezone-aware availability, live chat, Jitsi video, feedback and notifications (in-app, email, push), on top of Phase 2 (imports, verification, profiles, directory) and the Phase 1 secure core. See `docs/phases/`.

## Quick start (under 5 minutes)

Prerequisites: Node 22.12 or later, pnpm 10 (`corepack enable`), and Docker.

```bash
pnpm install
pnpm dev            # creates .env from .env.example, starts Mongo/Redis/Mailpit, then API and web
pnpm seed           # (in another terminal) two demo colleges, every role, platform admin
```

Demo sign-ins (password `Demo-Campus-Link-2026`, fictional people):

| Where                       | Email                                                                          | Role                                                        |
| --------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| http://dpit.localhost:5173  | `admin@dpit.example`                                                           | College admin (sets up 2FA on first sign-in)                |
| http://dpit.localhost:5173  | `tpo@` · `faculty@` · `rahul@` · `ananya@` · `vikram@` · `newbie@dpit.example` | TPO · Faculty · Alumni · Student · Contributor · Unverified |
| http://mrce.localhost:5173  | same names `@mrce.example`                                                     | second college, different branding                          |
| http://admin.localhost:5173 | `superadmin@campuslink.example`                                                | Platform console                                            |

Emails (verification, reset, invites) land in Mailpit at http://localhost:8025.

### Try Phase 2

1. **Import:** sign in as `admin@dpit.example`, open Admin → Imports and upload `docs/samples/sample-students.csv`. Check the suggested column mapping, tick "dry run" if you like, and run it: 6 new records and 3 reported problems. Download the error report, or roll the import back.
2. **Verify:** sign in as `newbie@dpit.example`, choose Verify now and enter roll number `24DP1A0577`. The 6-digit code goes to the email on the college's record; open it in Mailpit.
3. **Browse:** open People to filter the directory, open a profile, and press Ctrl/Cmd+K to search. Edit your own profile under Profile; email and phone stay private unless you change their visibility.

### Try Phase 3

1. **Video:** right after `pnpm seed`, sign in as `ananya@dpit.example` and open Sessions. Her demo mock interview with Rahul starts in 5 minutes, so Join video is already open (it opens Jitsi in a new tab).
2. **Request and accept:** as Ananya, open Mentors → Browse → Sneha Reddy, pick a 1:1 video call and a time, and send the request. In another browser (or a private window), sign in as `sneha@dpit.example`, open Requests and accept. Chat opens for both; messages and typing appear live.
3. **Mentor side:** `rahul@dpit.example` → Mentoring shows the impact card, the pause switch, weekly hours and private feedback.
4. **Push (optional):** run `pnpm --filter @campuslink/api vapid`, add the two keys to `.env`, and use the production build (`pnpm build && pnpm --filter @campuslink/web preview`) so the service worker is active. Then turn on push in Settings → Notifications.

Video uses the public `meet.jit.si` locally; for production, self-host Jitsi with JWT (`docs/video.md`).

### Try Phase 4

1. **Feed:** sign in as `ananya@dpit.example`. Home shows stories, today's One Useful Thing, For you and Following. React, save and comment; open a story and pause it with Space.
2. **Post:** as `rahul@dpit.example`, use the composer to share a text tip, photos (alt text required), a Tips reel (MP4 up to 60 s), a poll or a link.
3. **Q&A and moderation:** as Ananya, ask in Q&A. As `faculty@dpit.example`, open Admin → Moderation to approve it (Vikram's demo question is already waiting), handle reports and decide appeals.
4. **News sources:** as `admin@dpit.example`, open Admin → Sources, paste any RSS or Atom feed URL, Test, then Add. Fetching needs internet access and `INGESTION_ENABLED=true` (the default outside tests). Starter feeds can be added once CI has verified them (`docs/content-sources.md`).

### Try Phase 5

1. **Job Radar:** as `ananya@dpit.example`, open Jobs. Filter, save a job, open it and choose Apply, then mark it as applied; My applications tracks it. Filter and choose “Alert me” for a daily alert.
2. **Referrals:** on the Nimbus Labs demo job, ask Rahul for a referral (optionally attach a PDF). As `rahul@dpit.example`, open Referrals to refer or decline; referral settings set the weekly limit.
3. **Post an opening:** alumni and staff use Jobs → Post an opening.
4. **Job sources:** as `tpo@dpit.example`, open Admin → Job sources to test and add a Greenhouse, Lever, Ashby or SmartRecruiters board, or an RSS notice feed (needs internet access). Adzuna needs `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.

### Try Phase 6

1. **Career Galaxy:** as `ananya@dpit.example`, open Roadmaps. Switch between Galaxy and List, open a roadmap, and mark steps done in the step panel. Set a weekly goal; My roadmaps shows your progress.
2. **Write a roadmap:** as `rahul@dpit.example` (alumni), choose New roadmap. Cite sources or mark steps "needs review", then save and submit.
3. **Review:** as `faculty@dpit.example`, open Roadmaps → Review roadmaps. Approve Rahul's DEMO draft or ask for changes. History shows each version's changes. The researched library is installed and updated from the same page.

| Service             | URL                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Web app             | http://dpit.localhost:5173, http://mrce.localhost:5173, platform: http://admin.localhost:5173 |
| API health          | http://localhost:4000/api/v1/health, readiness at `/api/v1/ready`                             |
| Mailpit (dev email) | http://localhost:8025                                                                         |

`*.localhost` resolves to 127.0.0.1 in modern browsers without editing `/etc/hosts`. For `curl`, use `--resolve dpit.localhost:5173:127.0.0.1`.

## Everyday commands

```bash
pnpm lint && pnpm typecheck && pnpm test   # what CI runs, minus e2e
pnpm test:e2e                              # Playwright plus axe accessibility checks
pnpm build
pnpm infra:down                            # stop Docker services
```

## Repository layout

`apps/web` (React PWA), `apps/api` (Express API), `packages/shared` (schemas, types, permissions), `docs/` (architecture, ADRs, security, privacy, design). See `CLAUDE.md` for rules and conventions.

## Troubleshooting

- **Docker Hub rate limit (429):** pull through a mirror, e.g. `docker pull mirror.gcr.io/library/mongo:8.0 && docker tag mirror.gcr.io/library/mongo:8.0 mongo:8.0` (the same for `redis:7.4-alpine` and `axllent/mailpit:v1.27`), then `docker compose up -d --wait --pull never`.
- **Playwright browser missing:** run `pnpm --filter @campuslink/web exec playwright install chromium`, or set `PW_CHROMIUM_PATH` to an existing Chromium.
