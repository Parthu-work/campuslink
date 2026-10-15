# CampusLink

A private guidance network for a college community, connecting students with alumni from their own college. It is multi-tenant: each college gets its own branded, isolated space.

> Status: **Phase 1 (secure core)**: multi-tenancy, auth with 2FA, roles and permissions, audit, consent, college branding and the platform console. See `docs/phases/`.

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
