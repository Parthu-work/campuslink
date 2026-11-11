# Prompt 4 progress: deployable and live at zero unnecessary cost

Brief: [`master-prompt-4.md`](master-prompt-4.md). Facts and corrections: [`facts-4.md`](facts-4.md).
Handover to the UI session: [`handover-to-prompt-3.md`](handover-to-prompt-3.md). Final report: [`report-4.md`](report-4.md).

**Branch:** `claude/clever-hypatia-cpgn8m` (this session pushes only here; the owner merges into `main`
after each green push). **Started:** 10 Nov 2026.

| Phase | Title                                | Status                                     |
| ----- | ------------------------------------ | ------------------------------------------ |
| 0     | Set-up, merge of prompt 3            | Done                                       |
| P0    | Carry-over check                     | Done (ADR 0014 question open to the owner) |
| P1    | Production bootstrap                 | Done                                       |
| P2    | Production compose for one server    | Done (rehearsed on x86; arm64 in CI)       |
| P3    | Edge: Cloudflare and nginx           | Done (Cloudflare side: owner, step 3)      |
| P4    | Free embeddings with Ollama          | Built; measurements ready to run on server |
| P5    | Idle discipline                      | Done                                       |
| P6    | Builds and continuous deployment     | Done (first run on `main` after the merge) |
| P7    | Backups and disaster recovery        | Done (first run needs the R2 bucket)       |
| P8    | Observability on free tiers          | Done (accounts: owner)                     |
| P9    | Production settings and secrets      | Done                                       |
| P10   | Server provisioning                  | Ready to run (needs the Oracle account)    |
| P11   | Pilot preset and launch checklist    | Done                                       |
| P12   | Go-live rehearsal on the real server | Ready to run (needs the server and domain) |
| P13   | Final report                         | Done for what can be measured here         |

## Owner inputs needed (start the slow ones now)

| Input                                                                                   | Needed for            | Lead time        | Without it                                          |
| --------------------------------------------------------------------------------------- | --------------------- | ---------------- | --------------------------------------------------- |
| **Answer: did you approve ADR 0014?**                                                   | the network           | none             | `NETWORK_ENABLED=false` in production (the default) |
| Oracle Cloud account (Pay As You Go), SSH public key                                    | P10, P12              | a day (capacity) | nothing to deploy on; rehearse locally              |
| Domain with DNS on Cloudflare                                                           | P3, P10               | a day            | placeholders                                        |
| SMTP account (free tier)                                                                | production mail       | an hour          | the API refuses to start in production              |
| Sentry DSN, uptime monitor account                                                      | P8                    | an hour          | errors only in the server log                       |
| R2 bucket and scoped token; your age public key                                         | P7                    | an hour          | local backups only                                  |
| Anthropic key with a monthly spend limit                                                | chat answers          | an hour          | the assistant answers with passages                 |
| Meta WhatsApp business verification, approved templates, phone number id, token, secret | WhatsApp              | **days–weeks**   | WhatsApp off; email and push                        |
| Legal entity; DLT entity, header and templates; MSG91 prepaid account                   | SMS                   | **weeks**        | SMS off; phone sign-in by WhatsApp or email         |
| Grievance officer; seller GSTIN or unregistered; SAC code (chartered accountant)        | legal pages, invoices | days             | legal notice and invoices stay in draft             |
| Razorpay (only if a college wants to pay online)                                        | online payments       | days             | bank transfer                                       |
| Pen-test vendor                                                                         | before real students  | weeks            | go-live waits                                       |

## Step 0: set-up

- Fetched `claude/vigilant-lamport-rdkzex`. Its newest commit `dcaeedc` is green (CI run 42388325001,
  7 Nov 2026); merged it into this branch as a fast-forward of `main` + prompt 3's Step 0, U0 and U1. No
  conflicts.
- **Baseline gate on the merge:** format, lint and typecheck green; tests: shared 191, web 132 green;
  API 1 failure, `test/reach.test.ts` › the scheduled roster sync, which also fails on `main`: its
  fixture used fixed dates in early November and the pending diff expires after seven days (expired on
  9 Nov). Not web code; fixed in P0 by making the dates relative.
- Saved the brief, created this file, `facts-4.md` and `handover-to-prompt-3.md`.

## P0: carry-over check

**Shipped.**

1. **ADR 0014.** The ADR's status reads "proposed" while `progress.md` and `report-2.md` said
   "approved". The owner's answer is not recorded, so: `NETWORK_ENABLED` (env; unset means **off in
   production**, on in development and tests). While off: an employer host resolves to no tenant (404
   on every request), every route of the `network`, `employers`, `credentials` and `credentials-public`
   modules and every `scope: 'employer'` route answers 404 (even to a super admin), the tenant cache
   revokes every network permission from every role (so `/me` lists none and `useNav()` hides the
   network with no web change), `buildNav()` hides `network`, `recruiter`, `employers` and the
   `network` admin section when `networkEnabled === false` (one condition, plus its test), and the
   reconcile timer queues nothing. Nothing is deleted. `progress.md`, `report-2.md` and the ADR now say
   the same. Tests: `apps/api/test/network-switch.test.ts` (5), `navigation.test.ts` › "the network switch" (2).
2. **Dependency advisories.** `pnpm audit --prod` is clean: `mongoose` ^9.12.1 (two high, four moderate
   advisories in 9.11.2 that appeared since the audit), `fast-xml-parser` ^5.12.0, `write-excel-file`
   ^4.1.1 (drops `archiver`, so the known `glob`/`minimatch` pair is gone; three call sites moved to
   `.toBuffer()`). Export tests green.
3. **Pen-test notes** in `docs/security-review.md` › Master prompt 4: the network-path allowlist in
   `tenant-plugin.ts`, `network-scope.ts`, the employer host boundary, employer visibility and the
   credential routes, each with its tests.
4. `README.md` status line current.

**Owned by prompt 3 (not done here):** initial JS headroom (U0 freed 10.1 of 15 KB), 44 px touch
targets, per-language font loading on English pages. Listed in the handover.

## P1: production bootstrap

**Shipped.** `pnpm --filter @campuslink/api platform:bootstrap --email <e> --name "<n>"`
(`scripts/platform-bootstrap.ts`, in the image as `node dist/scripts/platform-bootstrap.js`), backed
by `PlatformService.bootstrap()`. Creates the platform tenant (`admin`, branding from `APP_NAME`) if
missing and exactly one `SUPER_ADMIN` with an unusable random password, then prints a single-use
set-password link (the existing hashed `password_reset` token, 30 minutes). No password in arguments
(a `--password` flag is refused with an explanation) or env. Refuses when any super admin exists
(concurrent runs: the second is rolled back); `--reissue` gives a new link only to the one account that
has never signed in. Refuses outside production without `--allow-dev`. Audit row `platform.bootstrap`
with the user id only; nothing is mailed. Two-factor enrolment is forced at first sign-in (existing:
no permission until it is on). Tests (`platform-bootstrap.test.ts`, 9): arguments, refusal outside
production, creation and token hash and expiry, audit row without email or name, second run refused,
reissue, expired link, single use, first sign-in with no permission until TOTP.

**Rehearsed** in the production image against the production compose: created, link printed, second run refused.

## P2: production compose (`deploy/prod/`)

**Shipped.** `compose.yml`: `edge` (the only published ports, 80 and 443), `web`, `api`
(`PROCESS_ROLE=api`), `worker`, `mongo` (replica set `rs0`, keyfile copied into place with mode 400,
authentication; `mongo-init` starts the set and creates a `readWrite`-only application user and a
`backup`-only user; root is used by `mongo-init` alone), `redis` (`requirepass`, AOF, `noeviction`),
`qdrant` v1.19.2 (API key), `clamav` (Debian build: the Alpine image has no arm64), `seaweedfs`
(access keys required via `s3.json`, SSE-S3 key from a secret), `ollama`; no Mailpit. Every service:
`restart: unless-stopped`, a health check, `json-file` logs (10 MB × 5), one internal network, named
volumes, a memory limit (sum 11.25 GB), `no-new-privileges`; application and nginx containers run as
non-root with read-only root filesystems and no capabilities. Database root secrets are files in
`secrets/`, never in the application's environment. `README.md` describes each service and volume.

`smoke.sh`: readiness, security headers and cache rules on the web app, HTTP → HTTPS, unknown host
refused, `/metrics` hidden, a WebSocket handshake, `deploy-check.js` (an object stored encrypted and
confirmed by HEAD, ClamAV flags EICAR, a Qdrant vector found only in its own college, the embedding
model's vector size, the database user's limits), worker ready, only the edge publishing ports, and no
headers, addresses or emails in the logs.

**Rehearsal (11 Nov 2026, this machine, x86_64):** the compose came up from generated secrets with
locally built images, and `smoke.sh` passed every step (embeddings skipped: see P4). Found and fixed on
the way: `fflate` missing from the API's dependencies (the production API would not start), the
unquoted `{24}` regex in both nginx configs (nginx refused to start), a smoke-test WebSocket key of the
wrong length. Memory at idle: see `deploy/prod/README.md` (about 1.7 GB in total; ClamAV 970 MB,
MongoDB 310 MB, API and worker 175–190 MB each).

## P3: edge

**Shipped.** `deploy/nginx/campuslink.conf` is now a template on `APP_ROOT_DOMAIN` (the nginx image's
envsubst): `.<domain>` covers college hosts, `admin.` and `emp-` hosts; `/api/` with the WebSocket
upgrade, `/p/`, the credential paths and study uploads to the API; everything else to the web container,
which keeps the security headers and cache rules (`security-headers.conf` unchanged). TLS 1.2+ with the
Cloudflare Origin CA certificate; unknown names get no certificate; port 80 redirects. Client address:
`real_ip_header CF-Connecting-IP` believed only from Cloudflare's ranges, the API trusts one hop
(`TRUST_PROXY_HOPS=1`; nginx overwrites `X-Forwarded-For`). The origin is locked three times: the
Oracle security list (owner, documented), `firewall.sh` (80/443 from Cloudflare's ranges in
`DOCKER-USER`, SSH from the owner; ahead of Oracle's image rules) and nginx (`$from_edge`, 444
otherwise); `cloudflare-ips.sh` regenerates both from cloudflare.com weekly with plausibility checks.
The edge's access log has no address, user agent or query string. Production refuses
`APP_ROOT_DOMAIN=localhost`. Tests: `test/trust-proxy.test.ts` (3), `test/env.test.ts` › production
deployment checks; CI job `deploy-config` runs `nginx -t` on the template.

**Deviation:** none in behaviour. Caching needs no Cloudflare rule: the origin's headers already make
hashed assets immutable for a year, HTML `no-cache`, `/api` `no-store`, `/p/` five minutes.

## P4: free embeddings

**Built.** `ollama` (multi-arch image, `OLLAMA_KEEP_ALIVE=5m` so an idle server holds no model) and
`ollama-init` (pulls the pinned model once). Settings: `AI_DEFAULT_EMBEDDING_PROVIDER=openai_compatible`,
`AI_DEFAULT_EMBEDDING_MODEL=nomic-embed-text`, `AI_DEFAULT_EMBEDDING_BASE_URL=http://ollama:11434/v1`,
`AI_PRIVATE_ENDPOINTS=http://ollama:11434`, and the new `AI_EMBEDDING_DIMENSIONS=768`, which
`deploy-check` compares with what the model returns. The allowlist is the only way a private address
is reached: the existing tests (`safe-fetch.test.ts`, `study.test.ts` with `http://ollama.test:11434`,
`ai-settings` refusing a college's private URL) cover it unchanged. Chat stays on Claude Haiku.

**Gap:** the measurements (a 50-page PDF on 2 Arm cores, RAM at peak, search quality on 20 questions
against the mock provider) could not run here: this session's network blocks `registry.ollama.ai` and
`huggingface.co`, so the model could not be downloaded. They run on the server in P12 (commands in
`report-4.md`). If quality is clearly worse than a paid API, the paid option is one env change
(`AI_DEFAULT_EMBEDDING_PROVIDER=openai`, a key, the model) and a rebuild of the index.

## P5: idle discipline

**Shipped.**

- `lib/scheduler.ts`: one timer (15 s), a table of every timed task with its cadence
  (`scheduledTasks()`), a fixed jitter per task (at most a quarter of the cadence and two minutes), and
  a Redis lock per task and slot (`SET … PX NX`), so two workers never double-run and a restart inside
  a slot does not run again. A failing task is logged by name and the rest continue. `server.ts` runs
  this table and nothing else.
- Per-college tasks queue only colleges with work due (`collegeTasks`): billing (an open invoice, a
  read-only state, seats not counted for a week, or members active in two days), the digest (someone
  opted in), Next Step and Senior Buddy (members active in 30 days; the feature on), the parent digest
  (a confirmed parent), the roster sync (a source on; not read-only), the Placement Graph and Copilot
  index (members active in 7 days), the network (the switch on and a college switch on). Each owning
  service got a small "who has work" method; the existing `enqueue…` methods take an optional set of
  colleges, so their own tests are unchanged.
- **Idle test:** 48 simulated hours over idle colleges through the real scheduler and inline queue:
  zero `AiUsage`, zero `ChannelMessage`, no outbound call (fetcher and fetch both trapped), no mail,
  no job queued at all, the six-hourly sweep at its cadence. Tests: `scheduler.test.ts` (34: scheduler
  mechanics, every task at its cadence, idle colleges get no job per task, the idle 48 hours).
- **Cost report:** `costs:report [--month YYYY-MM] [--json] [--backup-status <file>]`
  (`scripts/costs-report.ts`) on `CostsService.report()`: per college, AI tokens on the platform key
  beside the allowance with the estimated ₹ (the console's AI prices; `COST_USD_INR` converts
  dollars), WhatsApp beside its allowance and SMS with estimated ₹ (`COST_WHATSAPP_MESSAGE_PAISE`,
  `COST_SMS_MESSAGE_PAISE`), stored GB beside the storage limit, and R2 GB from the backup's status
  file beside the 10 GB free tier. A missing price shows "price not set", never ₹0. Audited. Tests in
  `costs-preset.test.ts`. **Console panel deferred to prompt 3** (handover).
- **Idle CPU (rehearsal, x86, 5 minutes, 30-second samples):** about 13% of one core across the whole
  stack, mostly MongoDB (6.6%) and the API (3.3%, health checks and BullMQ's blocking reads), on a
  machine that was also running other work. Measure on the server in P12.

## P6: builds and continuous deployment

**Shipped.** `.github/workflows/release.yml`: after a green `CI` run on `main` (or by hand), builds
`api`, `worker` and `web` for linux/arm64 on GitHub's Arm runners (`ARM_RUNNER`, default
`ubuntu-24.04-arm`) and linux/amd64, from the commit CI tested, pushes by digest to GHCR with an SBOM
and provenance, then tags the multi-arch images with the SHA and `main`. On each architecture the
worker image must run ffmpeg and pdftoppm, list Tesseract `eng`, `tel` and `hin`, and read a
Devanagari line rendered on the runner. `deploy` runs in the protected `production` environment
(owner approval) over SSH; the key is pinned on the server to `deploy-from-ci.sh`, which accepts only
a commit SHA on `main`, checks it out and runs `deploy.sh`: pull, replace web/api/worker, wait,
`smoke.sh`, and `rollback.sh` to the previous tag with an email on any failure. Hindi OCR:
`tesseract-ocr-hin` in the worker image and `OCR_LANGUAGES=eng+tel+hin` (B12 gap closed).

**Arm checks:** image manifests checked here: mongo 8.0, redis 7.4, nginx 1.28, node 22, qdrant
v1.19.2, seaweedfs 4.48, ollama 0.12.6 and clamav-debian 1.5.4 all have arm64; clamav (Alpine) 1.5.4
does not (replaced). The worker's tools run in the release workflow on the Arm runner. **Image sizes:**
recorded on the first release run (the workflow prints the manifests).

## P7: backups and disaster recovery

**Shipped.** `backup.sh` (nightly 02:30 IST by `campuslink-backup.timer`): `mongodump` as the backup
user inside the mongo container, encrypted with age to the owner's public key before it touches disk,
to R2 with `rclone` (remote from environment variables, no config file; token scoped to the bucket),
tiers 7 daily, 4 weekly, 3 monthly, two local copies; the object store's bucket synced to R2 through
`rclone crypt` with a read-only key; `backup-status.json` for the cost report; email on failure and
above 8 GB. Qdrant and Redis are not backed up (runbook says why). `drill.sh` (monthly timer, and by
hand with the private key brought for the run): fetch and verify the newest archive, decrypt, restore
into a throwaway MongoDB on an internal network, open it with the production API image and run the
migrations, count documents per collection, remove everything, email the result.
**Storage limits:** `PLAN_STORAGE` (pilot: 4 GB per college, 50 MB per study video or audio),
overridable per college (`limits.storageMb`, `limits.studyMediaMb`), read through
`EntitlementsService.limit()` and enforced in `FilesService` on members' uploads (413 with a clear
message). Tests in `costs-preset.test.ts`. The billing screen does not show storage yet: handover.

**Not yet run:** the first backup and drill need the R2 bucket and the age key (P12).

## P8: observability

**Shipped.** `ERROR_REPORTER=sentry` in the env example (the existing `scrub()` and its tests apply).
Uptime checks: documented (UptimeRobot, two URLs, 5 minutes). `host-alerts.sh` (every five minutes):
disk over 80%, memory over 90% for 10 minutes, a container restarting more than three times an hour,
the origin certificate within 30 days, the API not ready; one email per alert per six hours.
`/api/v1/metrics` returns 404 at the edge (checked by the smoke test) and still needs `METRICS_TOKEN`
inside. `docs/runbook.md` › Single server: logs, deploy and rollback, backups, every alert with what to do.

## P9: production settings and secrets

**Shipped.** `.env.production.example` (every setting, grouped, each with where its value comes from;
no values). `gen-secrets.sh --domain <d>`: JWT secrets, the field key, the WhatsApp action secret, the
metrics token, VAPID keys (generated with openssl, no Node needed on the host), MongoDB, Redis, Qdrant
and object-store credentials, the keyfile, the SSE key and the rclone crypt passwords into `.env`,
`backup.env` and `secrets/` (600/700); refuses to overwrite; prints no value. All of them are in
`.gitignore`. Env validation: `APP_ROOT_DOMAIN=localhost`, a credential-less `MONGODB_URI` and
`VECTOR_STORE=memory` with `PROCESS_ROLE=api` refused in production (tests); empty values count as
unset (test). `docs/deployment.md`: "Pilot: one Oracle server" first, AWS kept as "Scale-up path".

## P10: server provisioning

**Ready to run.** `provision.sh` (Ubuntu 24.04 arm64, as root, idempotent) and `docs/deploy-oracle.md`
(12 steps for the owner). Needs the Oracle account; nothing here could be run against a real server.

## P11: pilot preset and launch checklist

**Shipped.** `college:pilot-preset --slug <slug> [--dry-run]` on `PilotPresetService.apply()`
(`PILOT_PRESET` in `packages/shared/src/constants/plans.ts`): feature switches on (Alumni Match, job
aggregation, study and the assistant, placements) and off (stories, reels, leaderboards); for modules
with no switch, their permissions revoked from every college role (circles, giving, public pages, the
parent digest, batchmate invites) and the public outcomes page off; the network switches off;
conservative allowances as a custom deal (1 WhatsApp message and 3,000 AI tokens per student a month);
the storage limits. Dry run, idempotent, audit row in the college, keeps the college's other terms and
revokes, deletes nothing. Tests in `costs-preset.test.ts`. **Console button deferred to prompt 3.**
`docs/build/launch-checklist.md` for KNRCER.

**Deviation:** voice Q&A and Campus Captains have no switch. Voice Q&A needs the Whisper service, which
the pilot server does not run (so it is unavailable); Captains exist only when an admin grants the
capability. Neither needed a new switch (the brief: only existing switches).

## P12: go-live rehearsal on the real server

**Ready to run** once the server and domain exist; the command sequence is in `report-4.md`. The
pen-test pack is written (`docs/security-review.md` › Pen-test pack).

## Merges with main and prompt 3

| When        | What                                                  | Conflicts | Resolution |
| ----------- | ----------------------------------------------------- | --------- | ---------- |
| 10 Nov 2026 | `claude/vigilant-lamport-rdkzex` at `dcaeedc` (green) | none      | —          |

## Gate results

| Push | Format                              | Lint | Typecheck | Tests (shared / web / API) | Build | Budget | Coverage | Secret scan | e2e | CI  |
| ---- | ----------------------------------- | ---- | --------- | -------------------------- | ----- | ------ | -------- | ----------- | --- | --- |
| 1    | see the latest row in `report-4.md` |

## Cost impact

| Phase     | Cost                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| P0, P1    | ₹0                                                                                                          |
| P2, P3    | ₹0 (Oracle Always Free, Cloudflare free plan)                                                               |
| P4        | ₹0 (embeddings on the server instead of a paid API)                                                         |
| P5        | ₹0, and it lowers pay-per-use: idle colleges trigger no job                                                 |
| P6        | ₹0 (GitHub Actions and GHCR free for public repositories; see `deploy-oracle.md` step 12 for a private one) |
| P7        | ₹0 while R2 stays under 10 GB (alert at 8, storage limits per college)                                      |
| P8        | ₹0 (Sentry and UptimeRobot free plans)                                                                      |
| P9 to P11 | ₹0; P11 lowers the pilot's pay-per-use allowances                                                           |
