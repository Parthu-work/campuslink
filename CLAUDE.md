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

| Task                                         | Command                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Start everything (infrastructure, API, web)  | `pnpm dev`                                                              |
| Infrastructure only, up or down              | `pnpm infra:up`, `pnpm infra:down`                                      |
| Lint, format check                           | `pnpm lint`, `pnpm format:check`                                        |
| Typecheck                                    | `pnpm typecheck`                                                        |
| Unit and API tests                           | `pnpm test`                                                             |
| End-to-end tests (Playwright plus axe)       | `pnpm test:e2e` (set `PW_CHROMIUM_PATH` to use a preinstalled Chromium) |
| Build                                        | `pnpm build`                                                            |
| Web bundle budget (after a build)            | `pnpm --filter @campuslink/web budget`                                  |
| Regenerate the default palette CSS           | `pnpm --filter @campuslink/web palette`                                 |
| Seed demo data                               | `pnpm seed` (Phase 1 onwards)                                           |
| Dependency audit                             | `pnpm audit`                                                            |
| Check roadmap library links                  | `pnpm --filter @campuslink/api roadmaps:verify`                         |
| Load test (1,000 demo members, own database) | `pnpm loadtest`                                                         |
| Backup and restore drill                     | `pnpm backup:drill`                                                     |
| ClamAV and S3 locally (adapter tests)        | `docker compose --profile clamav --profile s3 up -d --wait`             |
| Staging rehearsal (production images)        | `deploy/staging/up.sh --build`, `smoke.sh`, `down.sh`                   |
| Re-encrypt after a field key rotation        | `pnpm --filter @campuslink/api rotate-field-key [--dry-run \| --check]` |

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
docs/            architecture, ADRs, threat model, privacy, design brief, deployment, runbook
deploy/          production Dockerfiles and nginx (security headers live here); staging/ rehearsal
scripts/backup/  encrypted backup, restore and drill
```

## Architecture rules

- Use a modular monolith. Each module owns its routes, controller, service, repository, schemas and tests. Modules talk to each other through services, never through another module's repository.
- Request flow: `rate limit → tenant scope → CSRF (cookie routes) → authenticate → authorize → validate (Zod) → handler → service`. Authorization runs before validation (ADR 0006).
- Routes are declared as specs in `modules/<name>/<name>.routes.ts` via `defineModule()` (`http/registry.ts`). The registry generates OpenAPI and `docs/permissions.md` and drives the permission test. Handlers are the thin controllers and call services. Use `authOf(req)` and `tenantOf(req)`, never `req.auth!`.
- Only services touch models, and models are created only through `defineTenantModel` or `definePlatformModel` (`db/models.ts`).
- Responses use the envelope `{ ok: true, data, meta? }` or `{ ok: false, error: { code, message, requestId } }`. Error codes come from `@campuslink/shared`.
- Everything is versioned under `/api/v1`. Feeds use cursor pagination. Sensitive writes accept an `Idempotency-Key`.
- Swappable providers sit behind interfaces: `StorageProvider`, `VideoProvider`, `MailProvider`, `JobSourceAdapter`, `DataSourceAdapter`, `BotProtection`, `SmsProvider`.
- Files go through `FilesService` only (sniff, re-encode, ClamAV scan that fails closed, purpose-based access, `deleteAfter` retention). Declare uploads with `upload` on the route spec so multer runs after authorize. Storage is local disk or S3 (`lib/storage-factory.ts`); never write files anywhere else.
- Bot checks: mark abuse-prone writes `bot: true`; the web client runs the human check on `BOT_CHECK_FAILED` and retries once (`lib/bot-check.ts`), so call sites need nothing extra.
- Background work goes through `JobQueue` (`lib/jobs.ts`); handlers run inside `runInTenant`, so the tenancy rules hold in jobs too. Tests use `InlineJobQueue`.
- The profile is a read model of the user: after changing a user's name, roles, status or verification, call `ProfilesService.sync()`. New import sources follow `docs/data-sources.md`.
- Realtime: clients only send `typing`. Every other socket event is emitted by a service after an authorised REST write, to `userRoom(tenantId, userId)` (`http/realtime.ts`). New socket events need isolation tests in `test/realtime.test.ts`.
- User text is stored as plain text (`lib/text.ts › plainText`) and rendered by the web app's markdown subset as React elements (ADR 0007). Never store or render HTML.
- New moderatable content registers a `ModeratableHandler` with `ModerationService` and a report target with `SafetyService`; removals carry a reason the author sees, and appeals go to a second moderator.
- Media for posts and stories is uploaded first and attached with `FilesService.claim()` (owner, purpose, single use). Validate every file before claiming any.
- Outside content comes only from RSS/Atom through `content-sources` (robots.txt, `safeFetch`, snippet + link-out). Starter feeds stay disabled until `feeds:verify` passes in CI; record results in `docs/content-sources.md`.
- Jobs: never invent listings. New job sources implement `JobSourceAdapter` (`modules/job-sources/adapters.ts`) on documented public APIs only. Starter boards stay disabled until `jobs:verify` passes in CI. "Alumni at this company" must respect profile field visibility (`ProfilesService.alumniAtCompanies`).
- Roadmaps: never invent roadmap content. Library roadmaps live in `modules/roadmaps/library/` (cite every step or mark it `needsReview`; no dates, fees or cut-offs); record sources and link-check results in `docs/roadmap-sources.md`. Publishing goes through review, and nobody approves a version they edited.
- Study and AI: who may read a subject is decided only by `SubjectsService.readableFilter()` (retrieval and chat reuse it). AI providers live in `modules/study/ai/` (one file each, implementing `LLMProvider`/`EmbeddingProvider`) and call out only through `callJson()` (`safeFetch`, mapped errors, redacted keys). Provider keys are read only by `AiSettingsService`; never return, log or audit them. Nothing goes to an external provider before the college accepts the current `AI_CONSENT_VERSION`. Study files are served only through signed links (`FilesService.signedUrl`: five minutes, access re-checked on every request), and material text goes through `neutraliseInstructions()` before it is chunked (`modules/study/extract/chunker.ts`); processing is one `study.process` job per material version.
- Points: award only through the `award` callback (`lib/awards.ts`) after a confirmed write, with a stable item id (the dedupe key) and `from` set to the other member; never write the ledger elsewhere. Rules, caps and badges live in `packages/shared` (`schemas/gamification.ts`).
- Analytics are aggregates only: new metrics come from a service method that returns counts or ids, and every count goes through `suppress()`.
- Background work on a member's behalf (alerts, roadmap nudges) uses `backgroundAuth()` so current permissions and blocks apply.
- Notify people only through `NotificationsService.notify()`. Payloads carry ids, names, session types and times, never message or request text.
- Bookings: never write `holds` by hand; use `holdsFor()` (`modules/mentorship/slots.ts`). The unique index on holds is what prevents double booking. Delayed jobs carry the booking `version` and must no-op when it changed.
- Mark sensitive POSTs `idempotent: true` (signed-in JSON routes) and abuse-prone public or social writes `bot: true`.
- Privacy rights: every module that stores personal data exposes `exportFor(userId)` and `eraseFor(userId)` on its service and registers them with `PrivacyService.register()` in `app.ts`. Erasure deletes private data and detaches shared content ("Former member"); consent records and the audit log are kept. New collections get a case in `test/privacy.test.ts`.
- Web navigation: every navigation surface (tabs, rail, avatar menu, Create sheet, command palette) comes from `buildNav()` (`packages/shared/src/navigation.ts`) through `useNav()` (`apps/web/src/lib/nav.ts`). Never hard-code tabs or menus per screen.
- Web routes: declare screens with `screen()` and `layout()` in `app/router.tsx` (React Router `lazy` with `importWithRetry` and an error element). Never add per-route `Suspense` wrappers or full-screen spinners; the shell never unmounts.
- Overlays a member opens are history entries, so Back closes them: linkable ones (sheets, step panels) keep their open state in the URL through `useUrlOverlay()` (`lib/use-url-overlay.ts`); the `Dialog` primitive does the rest through `useDialogHistory()` (pass `history={false}` when the URL already holds the state).
- Web bundle budget: initial JS at most 170 KB gzipped and at most 70 KB per screen on top of what is already loaded (`pnpm --filter @campuslink/web budget` after a build; CI fails over it). Toasts come from `lib/toast.ts` and animation from `lib/motion.ts` (`LazyMotion` with `m.*`), never from `sonner` or `motion/react` directly (lint rule). Heavy parts a screen does not need for its first paint load with `lazy()`. Constants the web needs live in zod-free `packages/shared/src/constants/<area>.ts`; schema files import them.
- Web data: server reads are defined once in `lib/queries.ts` (keys and fetchers). Screens read through them, and the route's static `loader` in `app/router.tsx` prefetches the same keys, so code and data load in parallel. Detail screens seed from the list row (`lib/query-seed.ts`); filtered lists keep previous data while refetching. Links to detail screens use `IntentLink`; "back" links use `BackLink`.
- Web security headers (CSP, HSTS and the rest) live only in `deploy/nginx/security-headers.conf`. `vite preview` serves the same file, so the end-to-end suite runs under the production CSP. Anything that needs a new source (a script, frame or connection) changes that file and its test.

## Tenancy rule (non-negotiable)

**No database access without tenant context.** Every tenant-owned document has `tenantId`. A Mongoose plugin reads the request-scoped tenant from AsyncLocalStorage and injects it into every query and aggregate, and stamps it on create. A query without tenant context **throws**. The only exceptions are explicitly named super-admin code paths (`withPlatformScope('area:reason', fn)`). Compound indexes always lead with `tenantId` (enforced by a test). The tenant comes from the subdomain and must match the token's tenant claim. Every new tenant-owned collection gets cross-tenant read, write, update, delete and search tests.

Watch for these traps:

- `runInTenant` and `withPlatformScope` await inside the context; never return an un-awaited query from elsewhere.
- Get the tenant from `requireTenantId()` or `req.tenant`, never from a loaded document (a field selection can omit it).
- `$lookup`, `$unionWith`, `bulkWrite` and `estimatedDocumentCount` are refused in tenant context.
- `$text` only through `db/search.ts`.

## Security rules (OWASP ASVS-aligned)

- Validate every input with Zod (strict objects; unknown keys rejected). Sanitize rich text with an allowlist sanitizer. Encode output.
- AuthZ is deny-by-default. Check object-level access on every resource (IDOR). Define permissions in `packages/shared` and enforce them on the backend; the frontend mirrors them for UX only.
- Auth: argon2id, short-lived access JWTs, and rotating refresh tokens in httpOnly, Secure, SameSite cookies with reuse detection. Use CSRF protection for cookie flows. TOTP 2FA is mandatory for admins.
- Rate-limit (Redis-backed) auth, messaging, requests, referrals, uploads and search.
- Uploads: sniff the type, cap the size, use random names, strip metadata, never serve from the app origin with execute rights, and leave an antivirus hook.
- Defend against NoSQL injection: strict Zod schemas, `middleware/no-operators.ts` and `strictQuery` (not global `sanitizeFilter`; see ADR 0006). Every server-side fetch goes through the SSRF-safe fetcher (blocks private ranges, enforces timeouts and size caps).
- Secrets come only from env. **Never log secrets or personal data** (Pino redaction is a safety net, not permission). The access log is an allowlist (`httpLogSerializers`: id, method, path, status); keep it that way. Encrypt sensitive fields (such as phone numbers) with AES-256-GCM through `FieldCipher`: name them `…Enc` and list them in `ENCRYPTED_COLLECTIONS` (`scripts/field-rotation.ts`; a test enforces it). Store `blindIndex()`, but look up with `{ $in: blindIndexes() }` so key rotation never breaks lookups.
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
- Styling uses design tokens only (`bg-surface-1`, `text-fg-2`, `text-brand-ink`, `text-title`, `shadow-elev-2`, `bg-aurora`), never raw colour values in components. Every colour is generated from the college's hue by `packages/shared/src/palette.ts` (ADR 0008): `styles/palette.css` is its output (regenerate with `pnpm --filter @campuslink/web palette`, never edit by hand) and `applyBranding()` swaps in each college's palette at runtime. Use `*-ink` tokens for coloured text; they are contrast-checked to 5.5:1 by `palette.test.ts`. Aurora is for the moments ADR 0008 lists, never for plain text or buttons.
- Web files that export components export only components (fast refresh): put hooks and helpers in `lib/`.
- New tokens and primitives appear in the living style guide (`/design`, development builds only, `features/design/style-guide.tsx`) in both themes.
- Build screens from `components/ui/` primitives: `PageHeader` for every screen title (a lint rule rejects `text-[clamp(` in features), `Sheet` for menus, filters and pickers and `Dialog` for focused tasks, `Switch`, `ChoiceGroup` (or `useRovingRadio` for custom radios), `Tabs`, `Segmented`, `ProgressBar`/`ProgressRing`, `StatCard` in a `StatGrid`, `Table`, `EmptyState`/`ErrorState` with an `Illustration`, `Card variant="interactive"` for link cards. Merge classes with `cn()` (it knows the type scale), never by string concatenation.
- Motion animates transform and opacity only and respects `prefers-reduced-motion` (`--motion-scale`).
- Celebrate only the moments ADR 0008 lists (request accepted, step done, badge, referral given, verification, quiz complete), through `celebrate()` (`lib/celebrate.ts`), once per device (`firstSighting`); never declines, cancellations or failures. Haptics go through `haptic()` and stay off unless the member turns them on.
- Use conventional commits (`feat(auth): …`), enforced by commitlint and Husky.

## Git workflow (owner's instruction)

- Work directly on `main` for every phase; no feature branches or pull requests.
- Before every push, run locally: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, the API coverage gate (`pnpm --filter @campuslink/api exec vitest run --coverage`) and the secret scan (`docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --config /repo/.gitleaks.toml --redact`; the same pinned version runs in CI).
- Push with `git push origin main`, then run the end-to-end suite (`pnpm test:e2e`) and confirm the GitHub Actions run for that commit is green (`gh run watch`). A red run is fixed immediately with a follow-up commit on `main`.

## Definition of done (every phase)

1. Lint, format, typecheck, unit, API and end-to-end tests pass. The tenant-isolation and permission suites pass.
2. Every new endpoint is listed in `docs/permissions.md` and has authorization and negative tests.
3. No secrets or personal data appear in logs, and `pnpm audit` is clean.
4. UI is checked at 360px and desktop widths, in both themes, with reduced motion and keyboard navigation.
5. Docs and this file are updated. The phase ends with a summary of what was built, decisions, assumptions, gaps and next steps.
