# CampusLink

A private guidance network for a college community, connecting students with alumni from their own college. It is multi-tenant: each college gets its own branded, isolated space.

> Status: **Phase 2 (people)**: college-list imports (CSV, XLSX, Google Sheets, REST), verification, profiles with per-field privacy, the alumni directory and search, on top of the Phase 1 secure core (multi-tenancy, auth with 2FA, roles, audit, consent, branding, platform console). See `docs/phases/`.

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
