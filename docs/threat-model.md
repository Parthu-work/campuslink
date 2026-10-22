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

# Phase 4: Feed and content (posts, stories, Q&A, ingestion, moderation)

**New assets:** posts, comments, reactions and saves; post and story media; stories; follows; questions and answers; content sources and ingested items; moderation actions and appeals.

## User content

|     | Threat                                               | Mitigation                                                                                                                                                                               | Test                                       |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| T   | Stored XSS through posts, comments or questions      | Plain text only: `sanitize-html` with an empty allowlist on write; the client renders a markdown subset as React elements, never HTML; only `https:` links (ADR 0007)                    | `feed-lib.test.ts`, web `feed-lib.test.ts` |
| T   | Trojan Source / bidi spoofing in text                | Control and bidi-override characters stripped on write                                                                                                                                   | `feed-lib.test.ts`                         |
| E   | Students posting where the college hasn't allowed it | `feed:post` only for alumni and staff; students gain it only through the tenant's `studentPosting` toggle; announcements need `announcements:post`                                       | `feed.test.ts`, `permissions.test.ts`      |
| I   | Attaching someone else's upload                      | Uploads are bound to owner and purpose (`post_media`, `story_media`); attaching validates every file first, then claims each once (`attachedAt`); unattached files are purged after 24 h | `feed.test.ts`, `isolation/feed`           |
| I   | Location leaks in photos and videos                  | Images re-encoded (EXIF dropped); MP4/MOV `udta`, `meta` and `uuid` boxes renamed to `free` and zeroed                                                                                   | `feed.test.ts`                             |
| D   | Oversized or very long reels                         | 25 MB cap, container duration read from `mvhd` and capped at 60 s, MP4/QuickTime only by magic bytes                                                                                     | `feed.test.ts`, `feed-lib.test.ts`         |
| I   | Link previews used for SSRF or tracking              | `safeFetch` (public IPs, 512 KB, 5 s); only title, description and site name kept; no remote images                                                                                      | `feed.test.ts`                             |
| D   | Posting, reaction and Q&A floods                     | Rate limits: posting 20/h, interactions 120/min, Q&A 10/h; bot check on posts, stories and questions; idempotency on posts, questions and answers                                        | `permissions.test.ts`                      |
| T   | Count inflation (double reactions, saves, votes)     | Unique indexes per user and post (reaction, save, poll vote, answer vote); counters change only when the unique write succeeds                                                           | `feed.test.ts`, `qa.test.ts`               |
| I   | Seeing blocked people's content                      | Blocks hide posts, comments, stories, questions and answers both ways and end follows                                                                                                    | `feed.test.ts`, `qa.test.ts`               |

## Moderation

|     | Threat                                         | Mitigation                                                                                                                                     | Test                 |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| R   | Silent or unexplained removals                 | Every removal has a reason code shown to the author with the moderator's note; the action log (`moderationActions`) is append-only and audited | `moderation.test.ts` |
| E   | A moderator rubber-stamping their own decision | One appeal per removal; the moderator who removed it cannot uphold the appeal (they can still reverse)                                         | `moderation.test.ts` |
| T   | Questions bypassing review                     | Questions start `pending`, visible only to the asker until a moderator approves; answers are refused until then                                | `qa.test.ts`         |
| I   | Moderators browsing private content            | Reports carry a snapshot of the reported item; private messages remain reachable only through a report (Phase 3)                               | `moderation.test.ts` |

## Ingestion

|     | Threat                                   | Mitigation                                                                                                                                             | Test                     |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| I   | SSRF via a feed URL                      | HTTPS only, `safeFetch` with public-IP pinning, size and time caps; admins only (`sources:manage`)                                                     | `ingestion.test.ts`      |
| T   | XXE or billion-laughs in feed XML        | Documents with DOCTYPE or ENTITY declarations refused before parsing                                                                                   | `feed-lib.test.ts`       |
| T   | Spam, clickbait or duplicate items       | Spam rejected, low-quality held for review, canonical-URL and content-hash dedupe                                                                      | `ingestion.test.ts`      |
| R   | Violating publisher terms or robots.txt  | robots.txt per RFC 9309, identifying user agent, conditional requests, Retry-After and back-off, snippet + link-out only, starter feeds verified first | `ingestion.test.ts`      |
| I   | One college's sources leaking to another | Sources and items are tenant-owned; the scheduler is a named platform path that only reads due ids and enqueues per-tenant jobs                        | `isolation/feed.test.ts` |

## Residual risks (Phase 4)

- Videos are not transcoded; a crafted MP4 still reaches browsers' decoders (mitigated by type sniffing, size and duration caps, attachment-only downloads and the AV hook).
- Keyword spam filters are basic; moderators remain the backstop.
- Starter feeds depend on CI verification; publishers can change terms or URLs, so the weekly workflow re-checks them.

# Phase 5: Jobs and referrals

**New assets:** job listings (posted and imported), private application trackers and alerts, job sources, referral settings, referral requests and résumés.

|     | Threat                                           | Mitigation                                                                                                                                                                                       | Test                                      |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| S   | Fake or scam openings                            | Only verified alumni and staff post (`jobs:post`); https apply links only; members report jobs and moderators remove them with a reason; bot check, rate limit, idempotency                      | `jobs.test.ts`                            |
| D   | Referral spam towards a few alumni               | Opt-in only (off by default), alumnus weekly cap, 3 open and the college's weekly limit per requester, one open request per job and alumnus (unique index), rate limit, bot check, 14-day expiry | `referrals.test.ts`                       |
| I   | Revealing where someone works when they hid it   | "Alumni at this company" counts and referrer lists only include people whose company field the viewer may see                                                                                    | `jobs.test.ts`                            |
| I   | Résumés read by others                           | PDF only, rebuilt without metadata; purpose `referral_resume`; readable only by the requester and the chosen alumnus; always downloaded, never rendered                                          | `referrals.test.ts`, `isolation/jobs`     |
| I   | Tracker and alerts exposing job-hunting          | Tracker entries and alerts are private to the member; nobody else (including the poster) sees them; alert notifications carry no listings                                                        | `jobs.test.ts`                            |
| I   | SSRF through a board name or feed URL            | Board names are a strict pattern and URL-encoded into fixed vendor hosts; feeds use `safeFetch` (public IPs, caps); only `jobs:sources` may add sources                                          | `jobs-lib.test.ts`, `job-sources.test.ts` |
| T   | Malicious or oversized source payloads           | 8 MB cap, defensive JSON parsing, plain-text stripping, https-only apply links, 500 postings per fetch                                                                                           | `jobs-lib.test.ts`                        |
| R   | Violating source terms                           | Documented public APIs only, identifying user agent, Retry-After and back-off, snippet + link-out, Adzuna attribution, starter boards verified first                                             | `job-sources.test.ts`                     |
| I   | One college's jobs or referrals reaching another | Tenant-owned collections; schedulers are named platform paths that only enqueue per-tenant jobs                                                                                                  | `isolation/jobs.test.ts`                  |

## Residual risks (Phase 5)

- Inferred experience level and skills can be wrong for imported jobs (shown as "about"; the employer's page is authoritative).
- Company matching is by normalised name; two different companies with the same name would share a badge.

# Phase 6: Roadmaps and Career Galaxy

**New assets:** roadmaps and their version history, review decisions, per-step comments, members' progress and weekly goals.

|     | Threat                                                      | Mitigation                                                                                                                                                                              | Test                         |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| T   | Self-published or unreviewed advice                         | Draft → submit → review; only `roadmaps:review` publishes; anyone who saved a version (including a reviewer) cannot approve it; publishing needs two roadmap sources and a project step | `roadmaps.test.ts`           |
| S   | Misleading or fabricated guidance                           | Every step cites a source or is marked "needs review" (shown to students); researched library cites per roadmap and step; CI link check; members can report a roadmap                   | `roadmaps.test.ts`           |
| T   | Script or markup in roadmap text                            | Strict Zod schema (unknown keys rejected), plain text stored (`plainText`), https-only links rendered with `rel="noopener noreferrer"`; React escapes output                            | `roadmaps.test.ts`           |
| T   | Broken graphs (cycles, dangling prerequisites)              | `graphProblems()` rejects duplicates, unknown prerequisites, self-references and cycles at the schema level; at most 40 steps                                                           | `roadmaps.test.ts`           |
| T   | Concurrent edits overwriting each other                     | One open version per roadmap, claimed with an atomic conditional update; submitted versions are read-only; reviews are conditional on status                                            | `roadmaps.test.ts`           |
| I   | Drafts or review comments leaking to students               | Unpublished roadmaps are visible only to their editors and reviewers; open versions are hidden from version history for others; comments need `roadmaps:write`                          | `roadmaps.test.ts`           |
| I   | Progress revealing a member's plans                         | Progress and goals are private to the member; nudges carry only the roadmap's name and slug                                                                                             | `roadmaps.test.ts`           |
| R   | Disputed publication or archive                             | Create, approve, request changes, discard, flag changes and library installs are written to the audit log                                                                               | `roadmaps.test.ts`           |
| I   | One college's roadmaps, drafts or progress reaching another | Four tenant-owned collections with isolation tests; the nudge scheduler is a named platform path that only enqueues per-tenant jobs                                                     | `isolation/roadmaps.test.ts` |

## Residual risks (Phase 6)

- Cited pages can change after review; the weekly link check catches pages that disappear, not pages whose content changes. Each roadmap shows when it was last reviewed.
- Some official Indian sites refuse overseas automated checks, so their links are re-checked by hand (`docs/roadmap-sources.md`).

# Phase 7: Gamification, events and analytics

**New assets:** the points ledger, badges and opt-ins, the rewards catalogue and redemptions, events with RSVPs and Q&A, and aggregated analytics.

|     | Threat                                                   | Mitigation                                                                                                                                                                                                  | Test                       |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| T   | Farming points (repeating or self-created actions)       | Points only come from other modules' confirmed writes; a unique dedupe key per action, member and item; daily caps; no award when the other party is the recipient; admin revocation (append-only, audited) | `gamification.test.ts`     |
| T   | Overspending points or stock in concurrent requests      | A per-member redemption lock, atomic stock decrement, raw (unclamped) balance check; declines and cancellations refund through ledger entries                                                               | `gamification.test.ts`     |
| I   | Leaderboards exposing members who don't want it          | Leaderboard and Wall of Mentors are opt-in (off by default); only name, photo, branch and points appear                                                                                                     | `gamification.test.ts`     |
| D   | Over-booking an event                                    | Seats claimed with a conditional update against capacity; a waitlist ordered by time; promotion re-checks the seat                                                                                          | `events.test.ts`           |
| I   | Online meeting links leaking                             | The link is returned only to the host, staff, and people going, from 15 minutes before the start; it is never in listings or the .ics for others                                                            | `events.test.ts`           |
| T   | Stale reminders after a change                           | Reminder jobs carry the event version and no-op when it changed or the event was cancelled                                                                                                                  | `events.test.ts`           |
| T   | Calendar injection through event text                    | RFC 5545 escaping of commas, semicolons, backslashes and newlines; line folding; plain text only                                                                                                            | `events.test.ts`           |
| E   | Alumni creating staff events                             | Alumni (`ama:host`) may create only AMAs and office hours; other kinds need `events:create`; only the host or staff manage an event                                                                         | `events.test.ts`           |
| I   | Re-identifying people from analytics                     | Aggregates only; counts under 5 shown as "<5"; faculty get the cohort view without activity or ratings; exports are audited                                                                                 | `analytics.test.ts`        |
| T   | Spreadsheet formula injection in exports                 | Every CSV cell is quoted and cells starting with `=`, `+`, `-`, `@` or tabs are prefixed                                                                                                                    | `analytics.test.ts`        |
| I   | One college's points, rewards or events reaching another | Nine tenant-owned collections with isolation tests                                                                                                                                                          | `isolation/phase7.test.ts` |

## Residual risks (Phase 7)

- Point values and caps are a first tuning; admins can revoke unfair awards, but there is no automatic anomaly detection yet.
- Attendance depends on the host's check-in.

## AI study assistant (Phase 9, step 1)

| Threat                                                                 | Control                                                                                                                                                                                                                                                                               | Evidence                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A provider API key leaks through a response, log, audit entry or error | Encrypted at rest with `FieldCipher` (`keys.*.apiKeyEnc`, rotated by `rotate-field-key`); only `last4` is returned; the key route is not idempotent (the idempotency store keeps request bodies); provider errors pass through `redactSecrets()`; audit entries carry only the target | `test/study.test.ts` (responses, captured logs, audit rows, raw document), `test/ai-providers.test.ts` (redaction) |
| An admin points the "custom endpoint" at the internal network (SSRF)   | Tenant endpoints must be public `https`; private or plain-http origins only through the platform owner's `AI_PRIVATE_ENDPOINTS`; every call goes through `safeFetch` (DNS pinning, redirects off for POST, size and time caps)                                                        | `test/study.test.ts` (custom endpoints), `test/safe-fetch.test.ts`                                                 |
| A student reaches a subject they do not take                           | One readable-subject filter (`SubjectsService.readableFilter`) for every route; unreadable subjects are 404; overrides composed with `$and` so an exclusion cannot be bypassed with a direct id                                                                                       | `test/study.test.ts`, `test/isolation/study.test.ts`                                                               |
| Another college's settings or keys are read or changed                 | Tenant-scoped `AiSettings` (one per college, unique on `tenantId`)                                                                                                                                                                                                                    | `test/isolation/study.test.ts`                                                                                     |
| Material or questions leave the college without the college agreeing   | External providers stay off until an admin accepts the current, versioned notice (audit-logged); the kill switch stops every call                                                                                                                                                     | `test/study.test.ts` (consent and kill switch)                                                                     |

## AI study assistant (Phase 9, step 2: material)

| Threat                                                                | Control                                                                                                                                                                                                                                                                   | Evidence                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A malicious file (script in a PDF, a polyglot, a zip bomb, malware)   | Content sniffing (never the name or the declared type), size caps, PDFs re-saved without scripts, images re-encoded, video metadata stripped, Office files read through the zip guard (entry count, ratio and size caps), archives refused, ClamAV scan that fails closed | `test/study-materials.test.ts`, `test/study-extract.test.ts`, `test/imports.test.ts` (zip guard)        |
| A shared link to a file outlives the member's access                  | Signed links (HMAC over college, file, purpose, member and expiry) last five minutes, and every request re-checks the member's current access (`backgroundAuth`); responses are `private, max-age=300`                                                                    | `test/study-materials.test.ts` (signed links, ranges, tampered tokens, another college, access removed) |
| Text inside uploaded material steers the chatbot (prompt injection)   | Instruction-like lines are neutralised before chunking; passages are later sent only inside delimiters (step 4) and the mock provider proves nothing escapes them (step 6)                                                                                                | `test/study-extract.test.ts` (neutralising)                                                             |
| A student reads unpublished, taken-down or another subject's material | Every material route and keyword search applies the readable-subject filter and `visibility: published` for readers; the pipeline re-reads visibility before it writes passages, so a takedown during processing is not undone                                            | `test/study-materials.test.ts`, `test/isolation/study.test.ts`                                          |
| Another college's material, pages, passages, segments or jobs         | Five new tenant-owned collections with cross-tenant read, write, update, delete and search tests                                                                                                                                                                          | `test/isolation/study.test.ts`                                                                          |
| An embedded video player tracks students                              | Click-to-load facade (no request to the provider before play), privacy-enhanced embeds only, no provider thumbnails; `frame-src` allows exactly the two embed origins and `img-src` is unchanged                                                                          | `apps/web/src/lib/security-headers.test.ts`                                                             |
| Upload floods                                                         | `studyUpload` rate limit (120 an hour per member) and the per-file caps                                                                                                                                                                                                   | `http/rate-limit.ts`, `test/study-materials.test.ts` (caps)                                             |

## AI study assistant (Phase 9, step 3: vectors and retrieval)

| Threat                                                                  | Control                                                                                                                                                                                                                                                | Evidence                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| A vector search returns another college's or another subject's passages | `VectorIndex` takes the tenant from the request or job context (throws outside one); every store refuses a call without tenant, readable subjects, model and visibility; Qdrant points carry the tenant in a tenant-partitioned index and every filter | `test/vector-store.test.ts` (memory and real Qdrant), `test/study-index.test.ts` |
| A stale vector (missed takedown, re-chunked material) leaks a passage   | Retrieval re-reads every passage from MongoDB with the readable-subject, published and filter rules before returning it; the embedder re-checks visibility after writing and drops vectors of passages that no longer exist                            | `test/study-index.test.ts` (takedown with a forced stale vector, deletion)       |
| Vectors of two embedding models compared (nonsense results)             | Every vector carries `provider:model`; searches filter on the current one; a change re-indexes and removes the old model's vectors                                                                                                                     | `test/study-index.test.ts` (model change)                                        |
| The vector store is reachable by colleges (SSRF) or leaks its key       | `QDRANT_URL` and `QDRANT_API_KEY` come only from the platform's environment; calls go through `safeFetch`; the key is sent as a header and never logged                                                                                                | `test/vector-store.test.ts` (requests)                                           |
| Questions reach the embedding provider without the college agreeing     | Query embedding uses the same runtime as indexing: external providers only after the versioned notice; the kill switch stops it; failures fall back to keyword search                                                                                  | `test/study.test.ts` (consent), `test/study-index.test.ts` (outage, revoked key) |
| `$text` operators in a search term                                      | The keyword term keeps letters, marks and digits only (no quotes or minus), at most 100 characters, through `db/search.ts`                                                                                                                             | `test/vector-store.test.ts` (keyword terms)                                      |

The chatbot's prompt defences arrive with step 4 and are tested with the injection suite in step 6.
