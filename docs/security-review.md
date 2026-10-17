# Security review (Phase 8)

**Date:** 2026-10-16.

**Scope:** every requirement in section 9 of the product brief (OWASP ASVS-aligned), checked against the code and the tests that exercise it. Each row names the implementation and at least one test.

**Statuses:**

- **Met:** implemented and tested.
- **Met (configure):** works, but needs a production setting.
- **Gap:** listed with an owner in "Gaps and owners".

The control-by-control list is in [`security-checklist.md`](security-checklist.md), and the STRIDE analysis per module is in [`threat-model.md`](threat-model.md).

## Summary

| Requirement                                                                                     | Status | Evidence (short)                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Input validation on every request                                                               | Met    | Route registry parses body, query and params with strict Zod; operator keys rejected at the edge                               |
| Output encoding; allowlist sanitising of rich text                                              | Met    | Plain text stored; markdown subset rendered as React elements; https-only links                                                |
| CSP, HSTS and other headers                                                                     | Met    | API: Helmet. Web: `deploy/nginx/security-headers.conf`, tested, and enforced during the end-to-end run                         |
| Strict CORS allowlist                                                                           | Met    | Exact origins plus single-label wildcard subdomains; spoofing tests                                                            |
| argon2id; rotating refresh tokens with reuse detection; revocation; secure cookies              | Met    | `lib/passwords.ts`, `auth.service.ts`; rotation and replay tests                                                               |
| CSRF for cookie flows                                                                           | Met    | Double-submit token plus Origin check on cookie endpoints                                                                      |
| 2FA for privileged roles                                                                        | Met    | TOTP, mandatory for admins, replay-protected                                                                                   |
| Deny by default; IDOR; horizontal and vertical escalation tests                                 | Met    | Registry-driven role × route matrix; isolation suites                                                                          |
| Rate limits on auth, messaging, requests, referrals, uploads and search                         | Met    | Redis-backed named limiters on each route spec                                                                                 |
| Bot protection hook                                                                             | Met    | Turnstile adapter fails closed; the web app runs the check and retries with `X-Bot-Token` (added after Phase 8)                |
| Upload type sniffing, size limits, random names, no execute from the app origin, antivirus hook | Met    | `FilesService`; sandboxed CSP and nosniff on downloads; ClamAV adapter, fail-closed, tested against a real `clamd`             |
| NoSQL injection defence                                                                         | Met    | `middleware/no-operators.ts`, strict schemas, `strictQuery`, tenancy plugin                                                    |
| SSRF protection for server-side fetches                                                         | Met    | `lib/safe-fetch.ts`: https, public IPs only, pinned DNS, redirect re-validation, size and time caps                            |
| Safe redirect handling                                                                          | Met    | No user-controlled redirects exist; safeFetch re-validates every hop and never follows redirects for POST                      |
| Secrets via env only; none in logs or the repo; secret scanning; dependency audit; lockfile     | Met    | Env validation refuses placeholders; gitleaks and `pnpm audit` in CI; frozen lockfile; access-log allowlist (fixed this phase) |
| Field encryption at rest; TLS-only in production; backup encryption documented                  | Met    | AES-256-GCM `FieldCipher`; HSTS and TLS 1.2+ at the ALB; age-encrypted backups with a drill                                    |
| Append-only audit log                                                                           | Met    | Model hooks refuse every update and delete path (test added this phase)                                                        |
| Security tests, threat model, checklist                                                         | Met    | Suites below; `threat-model.md`; `security-checklist.md`                                                                       |

## Evidence

### Input validation, output encoding, headers, CORS

- `apps/api/src/http/registry.ts`: every route spec declares Zod `body`, `query` and `params`. The handler only ever receives the parsed values.
  - Schemas in `packages/shared` are `z.strictObject`, so unknown keys are rejected.
  - Authorization runs before validation (ADR 0006).
- `apps/api/src/middleware/no-operators.ts`: rejects `$`-prefixed, dotted and prototype keys anywhere in a body.
  - Tests: `test/auth.test.ts` › "rejects unknown fields and operator injection".
- `apps/api/src/lib/text.ts` (`plainText`): user text is stored as plain text, with control and bidi characters stripped. The web app renders a markdown subset as React elements (`apps/web/src/lib/markdown.ts`, `safeHref` allows https only). See ADR 0007.
  - Tests: `test/feed.test.ts` › "stores rich text as plain text and extracts hashtags"; `apps/web/src/lib/feed-lib.test.ts` › "never produces non-https links".
- `apps/api/src/lib/mailer.ts`: email templates escape every interpolated value.
  - Tests: `test/lib.test.ts` › "escapes every interpolated value".
- **API headers:** `apps/api/src/app.ts` uses Helmet with `default-src 'none'`, `frame-ancestors 'none'`, HSTS in production and `Cache-Control: no-store`.
  - Tests: `test/health.test.ts` › "sets security headers, no-store caching and hides the framework".
- **Web headers:** `deploy/nginx/security-headers.conf` sets:
  - CSP `script-src 'self'` with no inline or eval, `object-src 'none'`, `frame-ancestors 'none'` and `upgrade-insecure-requests`;
  - HSTS for two years with subdomains;
  - nosniff, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP and `X-Frame-Options: DENY`.
  - Tests:
    - `apps/web/src/lib/security-headers.test.ts`: strict CSP, HSTS, the other headers, no inline script in `index.html`, and every nginx location includes the snippet.
    - `apps/web/e2e/pwa.spec.ts` › "the app runs under the production CSP without violations". `vite preview` serves the same headers, so the whole end-to-end suite (62 tests) runs under the production CSP.
- **CORS:** `apps/api/src/middleware/cors.ts` uses an exact allowlist with single-label wildcard subdomains. Sockets use the same allowlist.
  - Tests: `test/health.test.ts` › "CORS allowlist" (a tenant subdomain is allowed; `evil.com`, nested subdomains, look-alike suffixes and `null` are refused); `test/realtime.test.ts` › "refuses cross-site origins"; `test/env.test.ts` › "parses the CORS allowlist".

### Authentication

- **Passwords:** `apps/api/src/lib/passwords.ts` uses argon2id (19 MiB, t=2) and zxcvbn ≥ 3 with personal inputs. The HIBP check is k-anonymous (5-character prefix) and fails open.
  - Tests: `test/lib.test.ts` › "argon2id hash verifies and never throws on garbage" and "HIBP: only the 5-char prefix leaves the server…".
- **Tokens:** `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/lib/jwt.ts`, `apps/api/src/http/cookies.ts`.
  - Access JWTs last 15 minutes. Refresh tokens rotate on every use and are stored as hashes; replaying an old one revokes the session.
  - The refresh cookie is httpOnly, `Secure` in production and `SameSite=Strict`.
  - Tests: `test/auth.test.ts` › "rotates on every refresh; replaying an old token revokes the session", "logout revokes the session and clears cookies", "rejects tampered, expired-format and foreign-signed access tokens"; `test/lib.test.ts` › "access tokens and MFA tickets are not interchangeable".
- **CSRF:** a double-submit token plus an Origin check on cookie endpoints (refresh, logout).
  - Tests: `test/auth.test.ts` › "requires the CSRF token and an allowed origin for cookie-authenticated endpoints".
- **2FA:** TOTP, mandatory for `COLLEGE_ADMIN` and `SUPER_ADMIN`, with codes refused on replay. The secret is encrypted at rest and recovery codes are hashed.
  - Tests: `test/auth.test.ts` › "enrols, then requires a TOTP code at sign-in and rejects replay", "stores the TOTP secret encrypted at rest", "admins without 2FA get MFA_REQUIRED on every admin route and cannot disable 2FA".
- **Abuse:** lockout after 5 failures, enumeration-safe sign-up and reset, per-IP login limits.
  - Tests: `test/auth.test.ts` › "uses one generic error for unknown email and wrong password", "locks the account after 5 failures and audits it", "rate-limits login attempts per IP", "is enumeration-safe, single-use, and signs out every device".

### Authorization

- **Deny by default:** permissions are defined in `packages/shared/src/roles.ts` and enforced in `apps/api/src/http/auth.middleware.ts` and `registry.ts`. Accounts pending deletion keep no permissions.
- **Vertical access:** `test/permissions.test.ts` › "matches ROLE_PERMISSIONS exactly (deny by default)" calls every permission-guarded route as every role. "every non-public route rejects anonymous callers" covers the rest.
  - The escalation guards include: a student cannot grant themselves roles; SUPER_ADMIN cannot be assigned through the college API; `platform:*` permissions can never be granted to a college role; the last college admin cannot be demoted.
- **Horizontal access and tenancy:** `apps/api/src/db/tenant-plugin.ts` and `db/models.ts` (the tenancy plugin and model registry) refuse database access without tenant context.
  - Tests:
    - `test/isolation/plugin.test.ts`: reads, writes, updates, deletes, aggregates and text search are scoped; `bulkWrite`, `$lookup` and `estimatedDocumentCount` are refused; every index leads with `tenantId`.
    - `test/isolation/http.test.ts`: tokens, refresh cookies, MFA tickets and email links are bound to their college; IDOR across colleges.
    - Per-module isolation suites: `test/isolation/{feed,jobs,mentorship,people,roadmaps,phase7,privacy}.test.ts`.
    - Object-level checks inside a college sit in each module's tests, for example `test/auth.test.ts` › "lists my sessions and cannot revoke someone else's (IDOR)".

### Rate limiting and bot protection

- **Limits:** `apps/api/src/http/rate-limit.ts` holds Redis-backed named limiters, attached through `limiter:` on each route spec:
  - auth, signup, MFA, refresh;
  - messages, requests, referrals, uploads, search, posting, interactions, Q&A, reports, push;
  - privacy (5 an hour, added this phase).
  - The scale is capped at 2 in production (`config/env.ts`).
  - Tests: `test/auth.test.ts` › "rate-limits login attempts per IP"; the per-module tests exercise their limiters.
- **Bot protection:** `apps/api/src/lib/bot.ts` and `apps/api/src/http/bot.middleware.ts` provide a Turnstile-style adapter, called through the SSRF-safe fetcher and failing closed. It is applied with `bot: true` on sign-up, mentorship requests and social writes.
  - Tests: `test/phase3-lib.test.ts` › "Turnstile verifies through the safe fetcher and fails closed"; `test/mentorship.test.ts` › "requires a bot-protection token when bot protection is on".
  - **Web:** `apps/web/src/lib/bot-check.ts` loads Turnstile only when a write is challenged and retries once with the token. The CSP allows `https://challenges.cloudflare.com` for `script-src` and `frame-src` only. The public site key reaches the app through `GET /tenant`; the secret never leaves the API.
    - Tests: `apps/web/e2e/bot-check.spec.ts` › "a challenged write runs the human check and retries once with its token"; `test/bot-config.test.ts`.

### File uploads

- **Handling:** `apps/api/src/modules/files/files.service.ts`.
  - Every file is magic-byte sniffed and its size capped (`http/upload.ts`).
  - Images are re-encoded with sharp, which strips EXIF. PDFs are rebuilt with scripts and metadata removed. MP4/MOV are sniffed with their duration capped and metadata wiped.
  - Keys are random, and access is purpose-based and single-use.
  - Spreadsheets get a zip-bomb pre-scan (`lib/zip-guard.ts`).
- **Serving:** files are served through the API with `Content-Disposition`, `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, never as executable content.
- **Antivirus:** the `MalwareScanner` hook runs before anything is stored. In production it is ClamAV (`apps/api/src/lib/clamav.ts`, the INSTREAM protocol). It fails closed: when `clamd` is unreachable, times out or errors, uploads answer 503 and nothing is stored. The API will not start in production without a scanner.
  - Tests: `test/clamav.test.ts`. It covers a fake `clamd` for chunking, verdicts and every failure mode, and a real `clamd` (in CI) detecting the EICAR test file and accepting a 25 MB upload.
- **Storage:** S3 (`apps/api/src/lib/s3-storage.ts`) with server-side encryption on every put (SSE-KMS by default), no ACLs, validated keys under a fixed prefix. Production refuses `S3_SSE=none`.
  - Tests: `test/s3-storage.test.ts`, including a real S3-compatible store (SeaweedFS) in CI.
- **Tests:**
  - `test/verification.test.ts` › "rejects non-images and polyglots disguised as images" (it also asserts the sandbox CSP);
  - `test/messaging.test.ts` › "accepts images (metadata stripped) and PDFs (scripts and metadata removed), refuses other files";
  - `test/imports.test.ts` › "rejects non-spreadsheet uploads, zip bombs and missing required mapping", "enforces the upload size limit";
  - `test/infra.test.ts` › "local disk: put/get/delete with random keys only (no traversal)";
  - `test/security-controls.test.ts` › "refuses a file the scanner flags, before anything is stored" (added this phase).

### Injection, SSRF and redirects

- **NoSQL injection:**
  - `middleware/no-operators.ts` rejects operator keys at the edge.
  - Strict Zod schemas cover every input, and Mongoose runs with `strictQuery`, not a global `sanitizeFilter` (ADR 0006).
  - `$text` search goes only through `db/search.ts`.
- **SSRF:** `apps/api/src/lib/safe-fetch.ts` is the only server-side fetcher, used for imports, feeds, link previews, job boards, web push and bot checks. It:
  - allows https only (plus host rules per caller);
  - resolves DNS once and pins the IP;
  - allows public addresses only;
  - re-validates every redirect hop and caps the number of redirects;
  - enforces a timeout and caps size by header and by streamed bytes.
  - Push endpoints are limited to known push services.
  - Tests: `test/safe-fetch.test.ts` (`isPublicAddress`; "re-validates every redirect hop (redirect to a private host is refused)"; "caps size by header and by streamed bytes"); `test/phase3-lib.test.ts` › "…never follows redirects for POST".
- **Redirects:** the API issues no redirects (no `res.redirect` anywhere).
  - The web app takes no `next` or `returnTo` parameter; after sign-in it always goes to `/home`.
  - Outbound links open in a new tab with `rel="noopener noreferrer"`.

### Secrets, logs and dependencies

- **Configuration:** `apps/api/src/config/env.ts` validates every variable.
  - In production it refuses placeholder secrets, `RATE_LIMIT_SCALE` above 2 and disabled mail.
  - Validation errors name variables, never values.
  - Tests: `test/env.test.ts` › "refuses placeholder secrets in production", "does not echo secret values in validation errors".
- **Logs:** `apps/api/src/lib/logger.ts`.
  - Pino redacts authorization, cookies, set-cookie, the CSRF and bot tokens, and password, token, OTP, phone and email fields.
  - The access log uses an allowlist (`httpLogSerializers`): request id, method, path and status only.
  - Tests: `test/lib.test.ts` › "log only id, method, path and status: no headers, query, IP or user agent" (added this phase).
- **CI:** `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile`, `pnpm audit --prod --audit-level=high`, and gitleaks v8.30.1 over the full history with `.gitleaks.toml`.
  - The full audit, including dev dependencies, is clean too. A pnpm override pins `uuid` ≥ 11.1.1 under autocannon (GHSA-w5hq-g745-h8pq).

### Encryption

- **Fields:** `apps/api/src/lib/crypto.ts` (`FieldCipher`) uses AES-256-GCM with a fresh IV per value and a versioned format (`v1.`), plus an HMAC blind index for lookups. It covers TOTP secrets, list emails and phones, and the profile phone.
  - Tests: `test/lib.test.ts` › "round-trips and uses a fresh IV each time", "detects tampering and unknown formats".
- **Transport:** TLS is enforced in production by HSTS (API and web), the ALB HTTPS listener (TLS 1.2+) and the HTTP-to-HTTPS redirect. Cookies are `Secure` in production. See [`deployment.md`](deployment.md).
- **Backups:** `scripts/backup/backup.sh` uses age (X25519 + ChaCha20-Poly1305) with public-key recipients, so the backup host cannot decrypt.
  - `restore.sh` decrypts fully before restoring and refuses to overwrite the source.
  - The drill restored 61 collections and 40,342 documents with 0 mismatches. A tampered file is refused.
  - Documented in [`runbook.md`](runbook.md#backups).

### Audit log

- `apps/api/src/modules/audit/audit.model.ts`: query hooks refuse every update, replace and delete operation, and a save hook refuses re-saving an existing entry.
  - Recorded: logins and lockouts, role and status changes, verification decisions, imports, exports (analytics CSV, `privacy.exported`), deletions (`privacy.deletion_requested`, `privacy.erased`) and platform actions.
  - Tests: `test/security-controls.test.ts` › "refuses every update and delete path, and re-saving an entry" (added this phase); `test/auth.test.ts` › "locks the account after 5 failures and audits it"; `test/privacy.test.ts` (the export and erasure audit entries); `test/moderation.test.ts` › "the moderation log is append-only".

## Findings fixed in this phase

1. **Production web headers were not shipped.**
   - Before, the API had Helmet headers but the web app had no deployable CSP or HSTS.
   - Fixed with `deploy/nginx/security-headers.conf`, the nginx configs, the web image, a unit test, and the end-to-end suite running under the production CSP.
2. **The access log recorded more than it needed:**
   - all request headers, so the CSRF and bot tokens appeared in plain text (authorization and cookies were already redacted);
   - the full query string;
   - the client IP and the user agent.
   - Fixed with an allowlist serializer and two more redaction paths, plus a unit test. Found by running the production image and sending real headers through it.
3. **No direct test for the append-only audit log or the antivirus hook.** Both added (`test/security-controls.test.ts`).
4. **Focus was lost after client-side navigation.** This is accessibility rather than security, but it was found in the same review pass. Fixed in `apps/web/src/lib/route-focus.ts` and covered by `apps/web/e2e/accessibility.spec.ts`.

## Gaps and owners

| Gap                                        | Risk                                                                                    | Owner          | Next step                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| No `FIELD_ENCRYPTION_KEY` rotation         | A leaked key cannot be rotated without a release                                        | API            | Key ring (`v2`), re-encryption job, blind index rebuild ([`runbook.md`](runbook.md#secrets)) |
| `style-src 'unsafe-inline'` in the web CSP | Allows inline styles (not scripts); needed for Radix and motion inline style attributes | Web            | Revisit when the UI libraries support nonce-based styles                                     |
| No external penetration test               | Unknown unknowns                                                                        | Platform owner | Commission one before onboarding the first real college                                      |

## How to re-run

```sh
pnpm test                               # unit and API tests, including the isolation and permission suites
pnpm --filter @campuslink/api exec vitest run --coverage
PW_CHROMIUM_PATH=… pnpm test:e2e        # end-to-end under the production CSP, with axe
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --config /repo/.gitleaks.toml --redact
pnpm audit
pnpm backup:drill
```
