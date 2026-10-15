# CLAUDE.md: project rules for AI agents

CampusLink is a multi-tenant college alumni and guidance platform: a private social network per college. The product name lives in one place, `packages/shared/src/brand.ts` (`APP_NAME`). Never hard-code it anywhere else.

**Priority order:** security and privacy, then correctness, then speed, then delight.

## Stack

- **Monorepo:** pnpm workspaces and Turborepo. Node 22 or later, TypeScript ~6.0 (see `docs/adr/0003`).
- **apps/web:** React 19, Vite 8, Tailwind 4 (tokens as CSS variables), PWA (vite-plugin-pwa), React Router, TanStack Query, Zustand, motion, i18next (en, te), React Hook Form with Zod.
- **apps/api:** Express 5, Mongoose 9 (MongoDB 8 replica set), Redis (ioredis), BullMQ, Socket.io, Zod, Pino, Helmet, argon2id, JWT.
- **packages/shared:** Zod schemas, types, constants and permission definitions shared by web and api.
- **Dev infrastructure:** `docker-compose.yml` runs MongoDB, Redis and Mailpit.

## Commands

| Task                                        | Command                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Start everything (infrastructure, API, web) | `pnpm dev`                                                              |
| Infrastructure only, up or down             | `pnpm infra:up`, `pnpm infra:down`                                      |
| Lint, format check                          | `pnpm lint`, `pnpm format:check`                                        |
| Typecheck                                   | `pnpm typecheck`                                                        |
| Unit and API tests                          | `pnpm test`                                                             |
| End-to-end tests (Playwright plus axe)      | `pnpm test:e2e` (set `PW_CHROMIUM_PATH` to use a preinstalled Chromium) |
| Build                                       | `pnpm build`                                                            |
| Seed demo data                              | `pnpm seed` (Phase 1 onwards)                                           |
| Dependency audit                            | `pnpm audit`                                                            |

## Folder structure

```
apps/api/src/
  config/        env validation (app refuses to boot on invalid env)
  lib/           logger, errors, crypto, tenancy context
  middleware/    request-id, cors, auth, tenant, rate-limit, error handler
  modules/<name>/  <name>.routes.ts · .controller.ts · .service.ts · .repository.ts · .schemas.ts · .test.ts
apps/api/test/   API tests (Supertest); tenant-isolation and permission suites live here
apps/web/src/
  app/           routes, layouts, providers
  features/<name>/  screens, components and hooks per feature
  components/ui/ design-system primitives
  styles/        tokens.css (design tokens), index.css
  i18n/          en.json, te.json
apps/web/e2e/    Playwright specs
packages/shared/src/  schemas, permissions, constants
docs/            architecture, ADRs, threat model, privacy, design brief
```

## Architecture rules

- Use a modular monolith. Each module owns its routes, controller, service, repository, schemas and tests. Modules talk to each other through services, never through another module's repository.
- Request flow: `route → validate (Zod) → authenticate → authorize → controller → service → repository`. Controllers stay thin. **Only repositories touch Mongoose models.**
- Responses use the envelope `{ ok: true, data, meta? }` or `{ ok: false, error: { code, message, requestId } }`. Error codes come from `@campuslink/shared`.
- Everything is versioned under `/api/v1`. Feeds use cursor pagination. Sensitive writes accept an `Idempotency-Key`.
- Swappable providers sit behind interfaces: `StorageProvider`, `VideoProvider`, `MailProvider`, `JobSourceAdapter`, `DataSourceAdapter`, `BotProtection`.

## Tenancy rule (non-negotiable)

**No database access without tenant context.** Every tenant-owned document has `tenantId`. A Mongoose plugin reads the request-scoped tenant from AsyncLocalStorage and injects it into every query and aggregate, and stamps it on create. A query without tenant context **throws**. The only exceptions are explicitly named super-admin code paths (`withPlatformScope(...)`). Compound indexes always lead with `tenantId`. The tenant comes from the subdomain and must match the token's tenant claim. Every new tenant-owned collection gets cross-tenant read, write, update, delete and search tests.

## Security rules (OWASP ASVS-aligned)

- Validate every input with Zod (strict objects; unknown keys rejected). Sanitize rich text with an allowlist sanitizer. Encode output.
- AuthZ is deny-by-default. Check object-level access on every resource (IDOR). Define permissions in `packages/shared` and enforce them on the backend; the frontend mirrors them for UX only.
- Auth: argon2id, short-lived access JWTs, and rotating refresh tokens in httpOnly, Secure, SameSite cookies with reuse detection. Use CSRF protection for cookie flows. TOTP 2FA is mandatory for admins.
- Rate-limit (Redis-backed) auth, messaging, requests, referrals, uploads and search.
- Uploads: sniff the type, cap the size, use random names, strip metadata, never serve from the app origin with execute rights, and leave an antivirus hook.
- Defend against NoSQL injection (`sanitizeFilter`, strict schemas). Every server-side fetch goes through the SSRF-safe fetcher (blocks private ranges, enforces timeouts and size caps).
- Secrets come only from env. **Never log secrets or personal data** (Pino redaction is a safety net, not permission). Encrypt sensitive fields (such as phone numbers) with AES-256-GCM.
- The audit log is append-only. Record admin actions, role changes, exports, logins and verification decisions in it.
- The super admin never reads tenant private message content.

## Data and content rules

- **Never invent data.** No fabricated roadmap content, jobs, statistics or alumni. Roadmaps cite sources per roadmap and per major node, with URLs and a `lastReviewedAt` date. Mark anything unverified `needs_review`. Seed and demo data must be obviously fictional and labelled as demo.
- Respect third-party terms. Use official APIs, RSS/Atom feeds and public ATS boards only, with no scraping where the terms forbid it. Show a snippet and a link out, never full articles.
- Apply data minimization (DPDP Act 2023): collect only what is needed, hide contact details by default, and record consent with versions.

## Free tools only

Everything runs on localhost with free, open-source tools. Any paid or external provider sits behind an adapter with a stub implementation. Add no third-party trackers.

## Coding conventions

- Strict TypeScript, with no `any` and no non-null `!` unless justified in a comment. Use `import type` for types.
- Name files in kebab-case. Name React components in PascalCase. Prefer named exports.
- Write no hard-coded UI strings; every string goes through i18next in both `en.json` and `te.json`.
- Styling uses design tokens only (`bg-surface-1`, `text-muted`, `text-brand`), never raw hex values in components.
- Motion animates transform and opacity only and respects `prefers-reduced-motion` (`--motion-scale`).
- Use conventional commits (`feat(auth): …`), enforced by commitlint and Husky.

## Definition of done (every phase)

1. Lint, format, typecheck, unit, API and end-to-end tests pass. The tenant-isolation and permission suites pass.
2. Every new endpoint is listed in `docs/permissions.md` and has authorization and negative tests.
3. No secrets or personal data appear in logs, and `pnpm audit` is clean.
4. UI is checked at 360px and desktop widths, in both themes, with reduced motion and keyboard navigation.
5. Docs and this file are updated. The phase ends with a summary of what was built, decisions, assumptions, gaps and next steps.
