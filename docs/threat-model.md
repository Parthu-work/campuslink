# Threat model (STRIDE)

Scope so far: Phases 1–3 (tenancy, auth, RBAC, audit, consent, branding, platform console; people; mentorship). Each phase adds its own section.

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

- ~~Tenant cache lag after suspension~~: Redis pub/sub invalidation shipped in Phase 2.
- **Phase 8:** no WebAuthn yet.
- `BotProtection` (Turnstile-style) shipped in Phase 3 on sign-up and mentorship requests; it is disabled locally, so production must configure it.
- In-memory rate limiting is used only in unit tests; dev and prod use Redis.

---

# Phase 2: People (imports, verification, profiles, directory, uploads)

**New assets:** the college's whitelist (roll numbers, names, emails, phones), ID-card photos, profiles.

## Imports

|     | Threat                                                                             | Mitigation                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T   | Malicious spreadsheet (formula injection when the error report is opened in Excel) | Error report holds only row numbers, field names and messages (no values); every cell starting with `= + - @ \t \r` is prefixed with `'`                                                                         |
| D   | XLSX zip bomb or huge files                                                        | 5 MB upload cap; central-directory pre-scan rejects more than 50 MB uncompressed or a compression ratio above 100; 20,000-row cap                                                                                |
| I   | SSRF via a Google Sheets or REST URL                                               | `safeFetch`: https only, DNS resolved and pinned, private, loopback, link-local, CGNAT, multicast and ULA ranges blocked, redirects re-validated (max 3), 10 s timeout, 5 MB cap; Sheets limited to Google hosts |
| T   | Re-import silently overwrites a claimed identity                                   | Claimed records keep roll number, name and graduation year; conflicting rows are reported, not applied                                                                                                           |
| R   | Who imported or rolled back what                                                   | Audit `import.started`, `import.completed`, `import.rolled_back` with counts                                                                                                                                     |
| E   | Job data is used to switch tenant                                                  | The job payload's `tenantId` is set server-side from the request context; the worker re-enters `runInTenant`                                                                                                     |

## Verification

|     | Threat                                              | Mitigation                                                                                                                                                                  |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S   | Claiming someone else's roll number                 | The OTP goes to the email on the college's record (not the claimant's); records can be claimed once (atomic); every claim is audited; admins can revoke                     |
| S   | Brute-forcing the OTP                               | 6 digits, 10-minute TTL, 5 attempts per challenge, 5 challenges per user per day, rate limit                                                                                |
| I   | Enumerating roll numbers to harvest names           | Responses never reveal names, only a masked email when matched; rate limits plus audit                                                                                      |
| I   | ID photo exposure                                   | Stored outside the web root; served only to the owner and holders of `verification:review` in the same college; `no-store`; deleted 30 days after the decision              |
| T   | Polyglot upload (HTML or SVG disguised as an image) | Magic-byte sniffing (JPEG, PNG, WebP only); re-encoded with sharp (also strips EXIF/GPS); served with `nosniff`, a sandbox CSP and an attachment disposition for non-images |

## Profiles and directory

|     | Threat                             | Mitigation                                                                                                                                     |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Contact details scraped by members | Contact fields default to "only me"; field-level visibility is applied server-side; directory search is rate-limited and requires verification |
| I   | Cross-college search               | Tenant plugin; isolation tests for search, profiles and files                                                                                  |
| T   | Stored XSS in bio or links         | Plain text only (React escapes); links must be https with a host allowlist pattern; no HTML accepted                                           |

---

# Phase 3: Mentorship (requests, bookings, chat, video, notifications)

**New assets:** private 1:1 messages and attachments, session times and video rooms, private session feedback, notification and push endpoints, block lists and reports.

## Requests and bookings

|     | Threat                                                   | Mitigation                                                                                                                                                                                           | Test                                         |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| D   | Request spam towards popular mentors                     | Mentor weekly cap, mentee limit of 3 open requests and the college's weekly limit, one open request per pair (unique index), `requests` rate limit, bot check, 7-day expiry                          | `mentorship.test.ts`                         |
| E   | Cold DMs that bypass consent                             | Conversations are created only when a mentor accepts; no endpoint creates one otherwise                                                                                                              | `mentorship.test.ts`, `messaging.test.ts`    |
| T   | Double booking through concurrent accepts                | Each booking holds a string per person and 15-minute block under a unique partial index (both people, mentor buffer included); the request is claimed atomically first and reverted if booking fails | `mentorship.test.ts` (concurrent accepts)    |
| T   | Replayed or duplicated writes on flaky networks          | `Idempotency-Key` on request creation, responses, reschedules and messages: same key + body replays, a different body is refused (422)                                                               | `mentorship.test.ts`                         |
| I   | Someone else's booking, request or feedback by id (IDOR) | Every lookup filters by participant; others get 404 (including admins for bookings and chats)                                                                                                        | `mentorship.test.ts`, `isolation/mentorship` |
| I   | Mentor sees fields the mentee hid                        | Match scoring and mentor cards use the visibility-filtered profile; mentee goals and target companies are private match inputs                                                                       | `mentorship.test.ts` (Alumni Match)          |
| R   | Disputes about cancellations and no-shows                | Late cancellation flag, who cancelled, single no-show record within 48 h, reschedule count                                                                                                           | `mentorship.test.ts`                         |

## Chat and attachments

|     | Threat                                             | Mitigation                                                                                                                                                                                             |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I   | Database dumps or operators reading messages       | Bodies are AES-256-GCM encrypted at rest; no admin or platform endpoint returns message content; moderators see only a snapshot of a reported message                                                  |
| T   | Malicious PDF (JavaScript, auto-actions, payloads) | Magic-byte sniffing; the PDF is rebuilt from its pages only (document JavaScript, open actions, embedded files, forms, metadata and non-URI link actions are not carried over); encrypted PDFs refused |
| I   | Attachment fetched by a non-participant            | Files with purpose `message_attachment` are served only after the messaging module confirms the viewer is a participant; always `Content-Disposition: attachment`, `nosniff`, sandbox CSP              |
| D   | Message flooding                                   | `messages` rate limit (30/min/user), 2,000-character cap, idempotency against double sends                                                                                                             |
| S   | Harassment continues after a block                 | A block closes the conversation, withdraws pending requests, cancels future sessions and hides both people from each other's mentor lists, in both directions                                          |

## Realtime (Socket.io)

|     | Threat                                        | Mitigation                                                                                                                           | Test               |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| S   | Socket with a token from another college      | Same checks as HTTP (`authFromToken`): token tenant must match the Host's tenant; session, status and token version are live-checked | `realtime.test.ts` |
| S   | Cross-site WebSocket hijacking                | Token in the handshake payload (no cookies); `Origin` must be on the allowlist                                                       | `realtime.test.ts` |
| I   | Events delivered to the wrong user or college | Rooms are `u:<tenantId>:<userId>`; the server emits only after a REST write was authorised; clients can only send `typing`           | `realtime.test.ts` |
| E   | Long-lived socket outlives revocation         | Socket closes at access-token expiry (≤ 15 min) and immediately on suspension                                                        | `realtime.test.ts` |
| D   | Event floods                                  | 4 KB max payload; one typing event per second per socket; typing validated with a strict schema and participant check                | `realtime.test.ts` |

## Video

|     | Threat                          | Mitigation                                                                                                                                                                                                                                            |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Guessing or reusing a room link | 160-bit random room names per booking, rotated on reschedule; the link is handed out only to the two participants from 10 minutes before to 15 minutes after the session; with self-hosted Jitsi the link carries a JWT that expires with that window |
| I   | Room link in calendar files     | `.ics` exports contain no video link                                                                                                                                                                                                                  |

## Notifications and push

|     | Threat                                    | Mitigation                                                                                                                                                                |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | SSRF through a push subscription endpoint | Endpoint must be on a known push service (schema and sender check), delivery goes through `safeFetch` (public IPs only, pinned DNS, timeouts) and never follows redirects |
| I   | Sensitive content in emails or pushes     | Payloads carry names, session types and times only, never message or request text                                                                                         |
| I   | Push endpoint theft from the database     | Endpoint and keys encrypted at rest, blind index for uniqueness                                                                                                           |
| D   | Notification fatigue / email flooding     | Per-category channel preferences, quiet hours, at most one message email per conversation per 30 minutes and only while offline                                           |

## Residual risks (Phase 3)

- Public `meet.jit.si` cannot enforce our link expiry; production should self-host Jitsi with JWT (see `docs/video.md`).
- No malware scanning provider is configured (hook only); attachments rely on type checks and PDF rebuilding.
- Bot protection is off locally; deployments must set `BOT_PROTECTION=turnstile`.
