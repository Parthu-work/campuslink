# Threat model (STRIDE)

Scope so far: Phase 1 (tenancy, auth, RBAC, audit, consent, branding, platform console). Each later phase adds its own section before code is written.

**Assets:** personal data of students and alumni (names, emails, later phone numbers and roll numbers), credentials and sessions, admin capabilities, each college's isolation, and audit integrity.

**Actors:**

- an anonymous internet user
- a signed-in student of college A attacking college B or peers
- a malicious or compromised alumnus
- a compromised admin account
- a curious platform operator

## Tenancy

|     | Threat                                                       | Mitigation                                                                                                                    | Test                                  |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| S   | A token from college A is used on B's host                   | Token `tid` must equal the tenant resolved from the Host header (401 `TENANT_MISMATCH`)                                       | `isolation/http.test.ts`              |
| T   | A query omits the tenant filter (developer error)            | The Mongoose plugin injects `tenantId` into every query and aggregate and throws without context; lint bans raw driver access | `isolation/plugin.test.ts` (35 cases) |
| T   | `tenantId` is changed by an update or replace                | The field is immutable; update and replace hooks throw                                                                        | same                                  |
| I   | IDOR: an id from B is used inside A                          | Lookups are tenant-scoped, so they return 404                                                                                 | `isolation/http.test.ts`              |
| I   | Cross-collection `$lookup`/`$unionWith` reads another tenant | Refused in tenant context                                                                                                     | `isolation/plugin.test.ts`            |
| E   | The same email exists in two colleges                        | Two separate accounts; credentials don't carry across                                                                         | `isolation/http.test.ts`              |
| S   | Host header spoofing                                         | Only `<label>.<APP_ROOT_DOMAIN>` resolves; `X-Forwarded-Host` is trusted only behind `TRUST_PROXY_HOPS`                       | `auth.test.ts` (unknown hosts)        |

## Authentication

|     | Threat                   | Mitigation                                                                                                                                          |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| S   | Credential stuffing      | Per-IP rate limit, per-account lockout (5 failures → 15 min, growing), HIBP check at sign-up and reset, zxcvbn score ≥ 3                            |
| S   | Account enumeration      | Identical responses for sign-up, forgot-password and resend; argon2 dummy verification equalises timing                                             |
| S   | Stolen refresh token     | Rotation on every use; replaying an old token revokes the session and is audited; httpOnly + SameSite=Strict + path-scoped cookie                   |
| S   | Stolen access token      | 15-minute lifetime, held in memory only; session and `tokenVersion` are checked on every request (suspension and password change apply immediately) |
| T   | CSRF on cookie endpoints | Double-submit token plus Origin allowlist on refresh and logout; every other endpoint is bearer-only                                                |
| S   | Admin phishing           | TOTP is mandatory for admins (no permissions until enrolled); replay guard via `lastTimeStep`; single-use recovery codes stored as hashes           |
| I   | TOTP secret at rest      | AES-256-GCM application encryption (`FieldCipher`)                                                                                                  |
| R   | "I didn't do that"       | Append-only audit of logins, failures, lockouts, reuse detection, MFA changes and password resets                                                   |

## Authorization

|     | Threat                                                         | Mitigation                                                                                | Test                                           |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| E   | A student calls admin endpoints                                | Deny-by-default permission per route                                                      | Registry-driven matrix (`permissions.test.ts`) |
| E   | Override abuse (TPO granted `users:manage` suspends the admin) | Only a college admin may act on a college admin; platform permissions are never grantable | `permissions.test.ts`                          |
| E   | Self-promotion to SUPER_ADMIN                                  | Not in the tenant role enum; stripped by `authenticate` outside the platform host         | `permissions.test.ts`                          |
| D   | Locking out a college by demoting the last admin               | 409 guard                                                                                 | `permissions.test.ts`                          |

## Platform console

|     | Threat                          | Mitigation                                                                                                                     |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| I   | The operator reads college data | Cross-tenant reads happen only in named `withPlatformScope` blocks returning aggregates; no message or profile endpoints exist |
| R   | A college is suspended silently | The action is audited in the platform log **and** mirrored into the college's own log                                          |

## Residual risks and planned work

- **Phase 2:** the tenant cache (30 s TTL) means a suspension takes up to 30 s to apply on other instances. Plan: Redis pub/sub invalidation.
- **Phase 8:** no WebAuthn yet.
- **Phase 2:** no CAPTCHA (the `BotProtection` adapter is planned).
- **Phase 2:** in-memory rate limiting is used only in unit tests; dev and prod use Redis.
