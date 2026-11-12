# Master prompt 4 (final): make CampusLink deployable and live at zero unnecessary cost

You are the engineering lead for CampusLink. Prompts 1, 1b and 2 built every feature. Prompt 3 (the UI/UX rebuild) is **still running in another session, in parallel with this one**. This is the **deployment prompt**: after it, the owner has a live, hardened server; Prompt 3's screens land on top of it, and the KNRCER pilot starts. Your job is to close every remaining gap between "all tests pass" and "real students use it safely", on infrastructure that costs nothing while idle.

**The motto: build and deploy at zero unnecessary cost.** Fixed infrastructure runs on free tiers. Anything that costs money is pay-per-use, capped, and never called while nobody is using the product. Nothing is traded against security, privacy or correctness to save money.

Do not add product features. **Do not change `apps/web` screens**: Prompt 3 owns them and is changing them right now. Where this prompt needs a new screen, build a command-line tool instead and say so in the progress file; the screen comes with Prompt 3.

---

## Step 0: Set up

1. **This prompt runs in parallel with Prompt 3.** Prompt 3 works on branch `claude/vigilant-lamport-rdkzex` (at `dcaeedc` on 7 Nov 2026 it had Step 0, U0 and U1 done, CI green) and keeps pushing U2–U13 while you work. Prompt 3 does not need to be finished for you to start or to finish. Follow the coordination rules in §0 below.
2. **Bring in what Prompt 3 has pushed so far.** Fetch `claude/vigilant-lamport-rdkzex`, merge its latest **green** commit (check its CI run; if the tip is red, use the newest green commit) into your working branch, run the full gate, and record the commit and result. If the merge conflicts outside the shared files in §0, or the gate fails in web code, do not fix web code: stop and tell the owner.
3. **Branch.** This session pushes only to its own branch (for example `claude/sleepy-babbage-cyptl6`). Work there instead of `main` (this overrides `CLAUDE.md` › Git workflow for this prompt only). Commit per phase, run the full gate before each push, and confirm CI is green on the branch. The owner merges the branch into `main` after each green phase. Record the branch name in `progress-4.md`.
4. **Save this prompt** verbatim to `docs/build/master-prompt-4.md`; create `docs/build/progress-4.md` (one section per phase: shipped, decisions, deviations, gaps, gate results, cost impact) and `docs/build/facts-4.md` (copy §2 and keep it current).
5. **List the owner inputs you will need** (§4) in `progress-4.md` at the start, so the owner can start the slow ones (Meta, DLT, entity) while you build.

## 0. Working alongside Prompt 3 (both sessions run at the same time)

**File ownership.**

| Owner                               | Files                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt 4 (you)**                  | `deploy/`, `scripts/backup/`, `.github/workflows/`, `apps/api/src/scripts/`, `apps/api/src/server.ts`, the new `apps/api/src/lib/scheduler.ts`, backend services you add for P1/P5/P11, `docs/deployment.md`, `docs/deploy-oracle.md`, `docs/runbook.md`, `docs/security-review.md`, `docs/build/*-4.md`, `docs/build/launch-checklist.md`, `docs/build/handover-to-prompt-3.md` |
| **Prompt 3**                        | everything under `apps/web/` (screens, components, styles, `i18n/*.json`, e2e specs), `docs/build/progress-3.md`, its design docs and ADR 0015                                                                                                                                                                                                                                   |
| **Shared (expect small conflicts)** | `packages/shared/src/navigation.ts` (your `NETWORK_ENABLED` hide vs Prompt 3's U2 navigation rebuild), `apps/api/src/config/env.ts` (both may add settings), `pnpm-lock.yaml` and `package.json` files, `CLAUDE.md`, `README.md`                                                                                                                                                 |

**Rules.**

- Never edit a Prompt 3 file. If a phase seems to need one, build the backend or CLI part only and list the screen in `handover-to-prompt-3.md`.
- In shared files, keep changes small and additive: add a field or an entry, never reorder or reformat existing code. In `navigation.ts`, express the network hide as one condition inside `buildNav()` (plus its test) so it survives Prompt 3's rewrite.
- New translation keys: none. Any new user-facing string goes in the handover for Prompt 3 to add in all three locales.
- **Merge protocol.** Before each push of a phase, merge the latest `main` into your branch (Prompt 3 may have merged a phase meanwhile), resolve shared-file conflicts by keeping both sides' intent, rerun `pnpm install` instead of hand-merging `pnpm-lock.yaml`, and run the full gate. Whichever session finishes a phase first gets merged into `main` by the owner; the other merges `main` before its next push.
- Each time you merge `main`, re-check that the `NETWORK_ENABLED` hide in `buildNav()` and its test are still present; if Prompt 3's rewrite dropped them, restore them in a fix commit.
- Record every merge (commit, conflicts, how resolved) in `progress-4.md`.

## 1. Decisions already made (do not re-open)

- **Z1. Zero unnecessary cost.** A paid resource is allowed only if it is (a) pay-per-use, (b) capped at the provider, and (c) never invoked by an idle product. Fixed monthly charges are not allowed except the domain (about ₹700–1,000 a year). Every paid account gets a hard cap or a prepaid balance plus an alert.
- **Z2. Target topology (pilot): one server.** Oracle Cloud **Always Free** Ampere A1, home region **Hyderabad (`ap-hyderabad-1`) or Mumbai (`ap-mumbai-1`)**: 2 OCPUs, 12 GB RAM, 200 GB block storage, 10 TB outbound a month (Oracle's free-tier page, checked 10 Nov 2026; the A1 allowance was halved from 4/24 in August 2026, so design for 2/12). The account is upgraded to **Pay As You Go**, which keeps Always Free resources free and avoids idle-instance reclamation and capacity refusals. Data stays in India.
- **Z3. Always on, not sleep-and-wake.** The product has live chat, minute-level session reminders, and Meta/Razorpay webhooks that must be answered within seconds. A sleeping server breaks all three, and on Oracle's free tier a stopped server saves nothing (and idle free servers can be reclaimed). "Nothing charged when idle" is met by free tiers plus pay-per-use, and idle work is made near zero (P5).
- **Z4. Free services around the server:**
  - **Cloudflare free plan:** DNS, wildcard proxied records, Universal SSL at the edge, Origin CA certificate to the server, WAF managed rules, caching of static assets, WebSockets.
  - **Cloudflare R2:** off-site encrypted backups only (10 GB-month, 1M Class A and 10M Class B operations free, no egress fees; checked 10 Nov 2026).
  - **GitHub:** CI, Arm image builds on GitHub's free Arm runners for public repositories, GitHub Container Registry for public images.
  - **Email:** a free SMTP tier (for example Brevo; record the daily limit you sign up with). **Errors:** Sentry free plan (`ERROR_REPORTER=sentry`). **Uptime:** a free uptime monitor (for example UptimeRobot).
- **Z5. Paid, pay-per-use, capped:**
  - **Chat answers:** Anthropic Claude Haiku (`DEFAULT_CHAT_MODEL`) on the platform key, with a monthly spend limit set in the Anthropic console and the plan allowance enforced in `AiSettingsService.runtime()` (ADR 0009).
  - **Embeddings: free by default.** A local **Ollama** container serving a small open embedding model through the existing `openai_compatible` provider and the owner allowlist `AI_PRIVATE_ENDPOINTS` (already supported by `lib/safe-fetch.ts` › `allowPrivateNetwork`). OpenAI or Gemini embeddings stay available as a paid option. Never use a free API tier whose terms allow training on submitted data.
  - **WhatsApp** (Meta Cloud API) and **SMS** (MSG91 on a **prepaid** balance) through `ChannelService`, with each college's allowance and each member's weekly cap.
  - **Payments:** bank transfer first (free). Razorpay only when a college asks to pay online.
- **Z6. Portability.** Everything runs from containers, `deploy/prod/compose.yml` and one env file. Moving to a paid server or a managed database later is a config change plus a restore, documented and rehearsed.
- **Z7. Security does not get cheaper.** Every rule in `CLAUDE.md` stands: TLS everywhere, encrypted files at rest, ClamAV required, no default credentials, secrets only in env, no personal data in logs, tenancy rules unchanged. The pilot runs with no internal service reachable from the internet.
- **Z8. No third-party trackers in the product.** Marketing pixels, if ever used, live on a separate marketing site, never in the app.
- **Z9. Stop and ask** before changing tokens or sessions, tenancy enforcement, encryption, or the SSRF rules beyond what this prompt names.

## 2. Verified facts (`main` at `094acfc`, CI green, 10 Nov 2026; re-check anything a Prompt 3 merge moved)

**Deploy files today.** `deploy/`: `api.Dockerfile`, `worker.Dockerfile` (adds `ffmpeg poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-tel`; **no Hindi OCR**), `web.Dockerfile` (Vite build behind nginx 1.28 on 8080), `nginx/{campuslink.conf, security-headers.conf, static.conf, web-container.conf}`, `staging/{compose.yml, edge.conf, up.sh, smoke.sh, down.sh}`. All base images are `mirror.gcr.io/library/node:22-slim` and `nginx:1.28-alpine` (multi-arch).

**Staging compose is a rehearsal, not production.** Services: edge (nginx), web, api, worker, `mongo:8.0` (`--replSet rs0 --bind_ip_all`), `redis:7.4-alpine` (AOF, `noeviction`), `clamav/clamav:1.5.4`, `chrislusf/seaweedfs:4.48` (S3), `axllent/mailpit`. It has **no MongoDB authentication, no Redis password, no restart policies, no memory limits, no log rotation**, and **no Qdrant**.

**nginx.** `deploy/nginx/campuslink.conf` uses the placeholder `server_name .campuslink.example` and certificates at `/etc/ssl/campuslink/{fullchain,privkey}.pem`; `staging/edge.conf` uses `.localhost`.

**Deployment guide.** `docs/deployment.md` (245 lines) describes an AWS topology (ALB, ECS tasks in two AZs, a 3-member replica set across AZs plus a hidden member in `ap-south-2`, ElastiCache, S3 with SSE-KMS, SES). Its "Gaps before launch" table lists the pen test, infrastructure as code, legal review, SAC and GST treatment, and a live Razorpay test event.

**Production refusals** (`apps/api/src/config/env.ts` lines 355–375): placeholder `JWT_ACCESS_SECRET`, `JWT_TICKET_SECRET` or `FIELD_ENCRYPTION_KEY`; `RATE_LIMIT_SCALE > 2`; `MAIL_DRIVER=disabled`; WhatsApp cloud without `WHATSAPP_ACTION_SECRET`; `PAYMENT_PROVIDER=stub`; console SMS or WhatsApp; `STORAGE_DRIVER=s3` with `S3_SSE=none`; `MALWARE_SCANNER=none`. Other relevant settings: `APP_ROOT_DOMAIN` (default `localhost`), `WEB_ORIGIN`, `TRUST_PROXY_HOPS` (default 0; `app.set('trust proxy', …)` in `app.ts` line 351), `PROCESS_ROLE` (`all | api | worker`), `VECTOR_STORE` (`auto | memory | qdrant`) with `QDRANT_URL`/`QDRANT_API_KEY`, `S3_ENDPOINT`/`S3_SSE`/`S3_*`, `METRICS_TOKEN` (≥ 32 chars), `ERROR_REPORTER` (`disabled | console | sentry`) with `ERROR_REPORTER_DSN`, `AI_DEFAULT_PROVIDER`, `AI_DEFAULT_EMBEDDING_PROVIDER` (`mock | openai | gemini | openai_compatible`) with `AI_DEFAULT_EMBEDDING_MODEL` and `AI_DEFAULT_BASE_URL`, `AI_PRIVATE_ENDPOINTS` (exact origins). `.env.example` has about 101 settings and targets development.

**No production bootstrap.** The only code that creates a super admin is `apps/api/src/scripts/seed.ts`, which creates a platform tenant (`slug: 'admin'`, `kind: 'platform'`) and a `SUPER_ADMIN` user with two-factor set up on first sign-in, and **refuses to run in production** (line 74). Colleges are created by a super admin through `POST /platform/tenants` (`modules/platform/platform.routes.ts`). A fresh production database therefore has no way in.

**Health.** `GET /api/v1/health` and `GET /api/v1/ready` (`modules/health/health.routes.ts`).

**Background work while idle.** The worker (`apps/api/src/server.ts` lines 130–240) runs about 15 `setInterval` timers: a 60-second tick (reminders and due jobs), a 5-minute nudge tick, a 15-minute network tick, a 6-hour retention sweep, and hourly ticks for adults turning 18, billing, the weekly digest, Next Step, Senior Buddy matching, the parent digest, roster sync, the Placement Graph and the Copilot index. The Copilot index embeds only new or changed passages (`copilot-index.service.ts`: SHA-1 per passage, unchanged ones skipped). The Placement Graph makes no AI calls.

**Backups.** `scripts/backup/{backup.sh, restore.sh, drill.sh, lib.sh}`: `mongodump --archive --gzip | age` to a local file (public-key recipients only). Nothing copies it off the server, rotates it, schedules it, or backs up stored files.

**CI.** `.github/workflows/ci.yml` (lint, typecheck, tests against a `mongo:8.0` container, ClamAV/S3/Qdrant profiles, e2e, gitleaks) and `feeds.yml`. **No image build, no registry push, no deploy.**

## 3. Phases

Run the full gate (`CLAUDE.md` › Before every push) for every phase, plus the phase's own checks. Record the cost impact of each phase in `progress-4.md` (₹0, pay-per-use, or a fixed charge with the owner's approval).

### P0. Carry-over check

Close these items from the 7 November conformance audit (they are Prompt 3's F-phase items that touch no screen):

1. **ADR 0014.** Ask the owner once: "Did you approve ADR 0014?" If yes, set its status to `accepted (owner, <date>)`. If no, or no answer, add `NETWORK_ENABLED` (env, default `false`) that makes the employer host and every `scope: 'employer'` route return 404 and hides the network destinations from `buildNav()`, with tests. Make `docs/build/progress.md` and `docs/build/report-2.md` match.
2. **Dependency advisories.** `pnpm audit --prod` shows no moderate or higher advisory (the two known ones are `glob` and `minimatch` through `write-excel-file` → `archiver`), or each remaining one is justified in `docs/security-review.md`. Re-run the export tests.
3. **Pen-test notes.** Add to `docs/security-review.md` the focus areas `apps/api/src/db/tenant-plugin.ts` (the network-path allowlist), `lib/network-scope.ts`, the employer host boundary and the credential routes, with the tests that cover each (feeds P12's pen-test pack).
4. `README.md` status line current.

Record as **owned by Prompt 3 (not done here)**: initial JS headroom (U0 freed 10.1 of the 15 KB target), 44 px touch targets, and per-language font loading on English pages. Note them in `progress-4.md` and the handover so Prompt 3 picks them up.

### P1. Production bootstrap (the blocker)

Add `pnpm --filter @campuslink/api platform:bootstrap --email <email> --name "<name>"` (`apps/api/src/scripts/platform-bootstrap.ts`):

- Runs with `NODE_ENV=production`; idempotent. It creates the platform tenant (`slug: 'admin'`, `kind: 'platform'`, branding from `APP_NAME`) if missing and **one** `SUPER_ADMIN`. It **refuses if any super admin already exists**.
- No password in arguments or env. It prints a single-use setup link (hashed token, 30-minute expiry, reusing the invite or reset machinery), and two-factor enrolment is forced on first sign-in (existing behaviour for `SUPER_ADMIN`).
- Writes an audit row, prints nothing personal beyond the email it was given, and documents creating the first college through the platform console afterwards.
- Tests: refuses a second run, refuses outside production unless `--allow-dev`, token single-use and expiry, audit row present, MFA required on first sign-in.

### P2. Production compose for one server (`deploy/prod/`)

Create `deploy/prod/compose.yml` from the staging file, hardened:

- **Services:** `edge` (nginx, the only service with published ports: 80 and 443), `web`, `api` (`PROCESS_ROLE=api`), `worker` (`PROCESS_ROLE=worker`), `mongo` (single-member replica set `rs0` with a keyfile and authentication; an init step creates the replica set and a least-privilege application user; the root user is used only by the init step), `redis` (`requirepass`, AOF, `noeviction`), `qdrant` (`qdrant/qdrant:v1.19.2`, API key), `clamav`, `seaweedfs` (S3 with access keys and encryption at rest so `S3_SSE=AES256` is honoured; verify with a test upload and `HEAD`), `ollama` (P4). **No Mailpit.**
- **Every service:** `restart: unless-stopped`; health checks; `json-file` logging with `max-size` and `max-file`; one internal network; named volumes on the block volume. Memory limits that fit 12 GB with headroom. Start from this budget and measure: MongoDB 3 GB (`--wiredTigerCacheSizeGB 1.5`), ClamAV 1.5 GB, Qdrant 1 GB, Ollama 1.5 GB, API 1 GB, worker 1.5 GB, Redis 0.5 GB, SeaweedFS 0.5 GB, nginx and web 0.25 GB. Record the measured peak per service.
- **Run as non-root** where the image allows. Read-only root filesystems for `web` and `edge`.
- `deploy/prod/README.md`: what each service does, its volume, and how to restart it.
- A **smoke script** `deploy/prod/smoke.sh` (from `staging/smoke.sh`): `/api/v1/ready`, the security headers on a college host, a WebSocket handshake, an upload that ClamAV scans and SeaweedFS stores encrypted, a study search hitting Qdrant.

### P3. Edge: Cloudflare in front, nginx at the origin

- Template `deploy/nginx/campuslink.conf` on `APP_ROOT_DOMAIN` (envsubst at container start): college hosts `*.<domain>`, the platform host `admin.<domain>`, employer hosts `emp-*.<domain>`, `/p/*` public pages, the credential paths, `/api/*` with WebSocket upgrade. `security-headers.conf` unchanged (its test still passes).
- **TLS:** Cloudflare "Full (strict)" with a **Cloudflare Origin CA** certificate on nginx (free, long-lived). HSTS stays.
- **Client IPs:** nginx `real_ip_header CF-Connecting-IP` with `set_real_ip_from` for Cloudflare's published ranges, kept in a generated include file refreshed by a weekly job. Set `TRUST_PROXY_HOPS` so rate limits and audit rows see the member's IP, not Cloudflare's. Add a test that the API reads the forwarded IP only through the configured hops.
- **Lock the origin:** the Oracle security list and the host firewall accept 443 only from Cloudflare's IP ranges (and SSH only from the owner's IP or Oracle Cloud Shell). Port 80 redirects. Document Oracle's Ubuntu images' default iptables rules, which must be opened explicitly.
- **Cache:** hashed static assets cached at Cloudflare for a year; HTML and `/api/*` never cached; `/p/*` honours the API's 5-minute cache header.
- **Domain settings:** `WEB_ORIGIN=https://<college>.<domain>` pattern documented; production refuses `APP_ROOT_DOMAIN=localhost` (add the env check and its test).

### P4. Free embeddings with Ollama

- Add the `ollama` service (Arm build) and a one-time model pull of a small open embedding model (for example `nomic-embed-text`). Pin the model name and its dimension in the env.
- Configure `AI_DEFAULT_EMBEDDING_PROVIDER=openai_compatible`, `AI_DEFAULT_EMBEDDING_MODEL=<model>`, `AI_DEFAULT_BASE_URL=http://ollama:11434/v1`, `AI_PRIVATE_ENDPOINTS=http://ollama:11434`. Confirm `callJson()` reaches it only because of the allowlist, and that a college-supplied URL can still never reach a private address (existing tests, plus one for this host).
- Check Qdrant collection dimensions and **Rebuild the index** (Admin › AI) when the model changes; vectors on `contentChunks` stay the source of truth.
- Measure: embedding time for a 50-page PDF on 2 Arm cores, RAM at peak, and search quality on 20 real questions against the seeded study material versus the mock provider. If quality is clearly worse than a paid embedding API, record it and leave the paid option one env change away.
- Chat stays on Claude Haiku (a local chat model is too slow on 2 cores); document the cost per 100 answers from `AiUsageService`.

### P5. Idle discipline (near-zero work when nobody uses the product)

- **Skip colleges with nothing to do.** Each hourly or daily tick queries only colleges that are active (not suspended, not read-only for billing reasons where the job does not apply) and have the relevant work due. For example: the digest only for colleges with members opted in; the roster sync only for colleges with a configured source; the network tick only when the network is enabled. Add tests that an idle college produces no jobs.
- **One scheduler.** Replace the scattered `setInterval` calls in `server.ts` with a small `lib/scheduler.ts` (one timer, a table of due tasks with their cadence, jitter, and a per-task lock in Redis so two workers never double-run). Keep every task's behaviour and its tests; add a test per task that it still runs at its cadence.
- **Prove the idle cost is ₹0:** a test that runs the scheduler for a simulated 48 hours over seeded colleges with no member activity and asserts zero `AiUsage`, zero `ChannelMessage` and zero outbound HTTP calls to paid providers. Also record idle CPU (5-minute average) on the real server in `report-4.md`.
- **Cost report (command now, screen later):** add `pnpm --filter @campuslink/api costs:report [--month YYYY-MM] [--json]` (`apps/api/src/scripts/costs-report.ts`), backed by a service method that a future console screen can reuse. It prints month to date per college: AI tokens and estimated ₹ (existing `AiUsageService` prices), WhatsApp and SMS messages and estimated ₹ (`ChannelUsage`), stored GB (files), plus R2 backup GB from the backup job's log, each beside its free-tier limit or cap. Aggregates only, with tests. Record "console panel deferred to Prompt 3" in `progress-4.md`.

### P6. Builds and continuous deployment

- **Images:** a workflow `release.yml` builds `api`, `worker` and `web` for `linux/arm64` on GitHub's free Arm runners (`ubuntu-24.04-arm`; amd64 on the default runners too, for portability), tags them with the commit SHA and `main`, pushes them to **GHCR** (public), and attaches an SBOM. Runs only after `ci.yml` is green on `main`.
- **Deploy:** a `deploy` job in a protected GitHub **environment** (`production`, owner approval required) connects over SSH with a deploy key, runs `docker compose pull && docker compose up -d` in `deploy/prod/`, waits for `/api/v1/ready`, runs `smoke.sh`, and rolls back to the previous tag automatically if the smoke test fails. Secrets live only in the environment's secrets and the server's env file, never in the repo or logs.
- **Rollback script** `deploy/prod/rollback.sh <sha>`; migrations stay additive (existing rule), so an older image runs against a newer database.
- **Arm checks:** the worker image's `ffmpeg`, `poppler-utils` and `tesseract` run on arm64 (add **`tesseract-ocr-hin`** for Hindi OCR, fixing the B12 gap, with an OCR test on a Devanagari scan); `mongo:8.0` on Ampere A1; `clamav/clamav` on arm64 (fall back to `clamav/clamav-debian` if not multi-arch); `qdrant` and `ollama` on arm64. Record image sizes.

### P7. Backups and disaster recovery

- **Nightly** (systemd timer on the host, documented): `backup.sh` (MongoDB, age-encrypted to the owner's public key), then upload to R2 with `rclone` (S3 remote, R2 endpoint, scoped API token); stored files synced to R2 with `rclone crypt`. Retention: 7 daily, 4 weekly, 3 monthly. Qdrant is not backed up (rebuilt from MongoDB); Redis is not backed up (queues and rate limits only), and the runbook says so.
- **Stay inside the free tier:** alert by email when R2 storage passes 8 GB. Set pilot entitlements (`EntitlementsService.limit()`: per-college storage and study-video limits) so total files plus backups stay under 10 GB. The limits already surface wherever the existing billing screen reads `EntitlementsService.limit()`; if they do not, list "show storage limit on the billing screen" in the handover (no web change here).
- **Restore drill** `deploy/prod/drill.sh`: restore the latest R2 backup into a scratch MongoDB container on the same server, run `/api/v1/ready` against it with a throwaway env, report counts per collection, and delete it. Run it once in P12 and monthly by timer, emailing the result.
- **Failure alerts:** a failed backup or drill emails the owner (through the app's mailer or `msmtp`).

### P8. Observability on free tiers

- `ERROR_REPORTER=sentry` with the DSN in env; check that `scrub()` runs before sending (existing tests).
- Uptime checks on `https://<college>.<domain>/` and `/api/v1/ready` every 5 minutes, with email alerts.
- Host alerts by cron: disk over 80%, memory over 90% for 10 minutes, any container restarting more than 3 times an hour, certificate expiry within 30 days, emailed to the owner.
- `/metrics` reachable only with `METRICS_TOKEN` and only from the server itself (nginx denies it from outside).
- `docs/runbook.md` gains a single-server section: where logs are, how to read them (`docker compose logs`), and what each alert means and what to do.

### P9. Production settings and secrets

- `deploy/prod/.env.production.example`: every setting production needs, grouped (domain, database, Redis, Qdrant, storage, mail, AI, channels, payments, billing seller details, monitoring), each with a comment saying where its value comes from. No real values.
- `deploy/prod/gen-secrets.sh`: generates `JWT_ACCESS_SECRET`, `JWT_TICKET_SECRET`, `FIELD_ENCRYPTION_KEY`, `WHATSAPP_ACTION_SECRET`, `METRICS_TOKEN`, the MongoDB, Redis, Qdrant and SeaweedFS credentials, the MongoDB keyfile and VAPID keys (`pnpm --filter @campuslink/api vapid`), into a file with mode 600. It refuses to overwrite an existing file.
- Env validation additions with tests: production refuses `APP_ROOT_DOMAIN=localhost`, `VECTOR_STORE=memory` with `PROCESS_ROLE=api` (the worker's index would differ), and a `MONGODB_URI` without credentials.
- `docs/deployment.md`: keep the AWS section as "Scale-up path" and add "Pilot: one Oracle server" as the primary path, linking `deploy/prod/`.

### P10. Server provisioning (`deploy/prod/provision.sh` and `docs/deploy-oracle.md`)

A script for Ubuntu 24.04 (arm64) plus a step-by-step owner guide:

1. **Oracle:** create the A1 instance (2 OCPU, 12 GB) in the home region with a 150 GB block volume; upgrade the account to Pay As You Go; create a budget alert at ₹1.
2. **Host:** non-root deploy user, SSH keys only, root login off, `unattended-upgrades`, `fail2ban`, a 4 GB swap file, time sync, Docker Engine and the compose plugin, the block volume mounted for Docker volumes, and the firewall rules from P3.
3. **Cloudflare:**
   - DNS: wildcard proxied `*` plus the apex and `admin`.
   - SSL: Full (strict), with the Origin CA certificate installed on the server.
   - Security: WAF managed rules on, plus a rate-limit rule on `/api/v1/auth/*` within the free plan.
4. **Email DNS:** SPF, DKIM and DMARC records for the SMTP provider.
5. **Webhooks:** the Meta WhatsApp callback URL and verify token, and the Razorpay webhook URL (only when payments are on).
6. **First boot:**
   - `gen-secrets.sh`, then fill the env file;
   - `docker compose up -d`, then `smoke.sh`;
   - `platform:bootstrap`, then the first sign-in with two-factor;
   - create the demo college and run the live checks (P12).

### P11. Pilot preset and launch checklist

- A **pilot preset command** `pnpm --filter @campuslink/api college:pilot-preset --slug <slug> [--dry-run]` (`apps/api/src/scripts/pilot-preset.ts`), backed by a service method a future console button can reuse, writing an audit row in that college. It sets these switches and limits:
  - **On:** mentorship, jobs, referrals, placements, study, roadmaps, readiness, practice and the assistant.
  - **Off:** circles, voice Q&A, giving, captains, public pages, parent digest, stories, reels, leaderboards and the network.
  - **Limits:** a conservative WhatsApp allowance and AI budget, and the storage limits from P7.

  It only sets switches and limits that already exist, and never deletes data. `--dry-run` prints the changes. Tests cover the switches, the audit row, idempotency and a college that does not exist. Record "console button deferred to Prompt 3" in `progress-4.md`.

- `docs/build/launch-checklist.md` for the KNRCER college:
  - College set-up: create the college, branding, the legal details (grievance officer), the billing seller details, and the roster import with a dry run.
  - Preset and invites: apply the pilot preset, run the WhatsApp invite batch for one cohort, and send the principal's alumni invitation.
  - Day-one watch list: activation, codes delivered, errors in Sentry, AI and WhatsApp spend.

### P12. Go-live rehearsal on the real server

With a demo college on the real server (demo data clearly labelled):

1. `smoke.sh` green; Lighthouse from India on a college host (record LCP and INP); `pnpm loadtest` adapted to target the server with 300 concurrent demo members (record p95 and error rate, and the memory peak per container).
2. Backup to R2, then restore drill, both green.
3. **Live provider checks, each gated on the owner's keys** (skip and record if not provided): `ai:smoke` with the Anthropic key; an embedding and search round trip through Ollama; one WhatsApp authentication template and one utility template delivered to the owner's phone, with a quick-reply button round trip through the webhook; one SMS code through MSG91; a Razorpay test-mode payment link and its signed webhook (only if payments are on).
4. A **pen-test pack** in `docs/security-review.md`: scope (hosts, roles, test accounts on the demo college), the areas to focus on (tenant isolation including the network paths, auth and phone codes, uploads, webhooks, employer hosts), and the rules of engagement.
5. Idle check: leave the demo college untouched for 24 hours and record idle CPU and that no paid call happened (`costs:report` shows ₹0).

### P13. Final report

`docs/build/report-4.md`:

- What was built per phase, and the measured numbers: memory per container, idle CPU, load test, Lighthouse, backup and restore times.
- **The monthly cost table at idle and at pilot load**, line by line, with each free-tier limit and how close the pilot comes to it.
- The owner's remaining actions, and the exact command sequence for deploying KNRCER.

## 4. Owner inputs (prepare everything without them; never fake them)

| Input                                                                                          | Needed for            | Without it                                                                     |
| ---------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| Oracle Cloud account (Pay As You Go) and the SSH public key                                    | P10, P12              | Build and test with the staging compose locally                                |
| Domain, with DNS on Cloudflare                                                                 | P3, P10               | Use `APP_ROOT_DOMAIN` placeholders and document                                |
| SMTP account (free tier)                                                                       | Mail in production    | Production refuses to boot (`MAIL_DRIVER`), so this is required before go-live |
| Sentry DSN, uptime monitor account                                                             | P8                    | `ERROR_REPORTER=console` on staging only                                       |
| R2 bucket and scoped token; owner's age public key                                             | P7                    | Local backups only, flagged in the report                                      |
| Anthropic key with a spend limit                                                               | Chat answers          | Assistant falls back to passages (existing behaviour)                          |
| Meta WhatsApp business verification, approved templates, phone number id, token, app secret    | WhatsApp              | `WHATSAPP_PROVIDER=disabled`; email and push only                              |
| Legal entity; DLT entity, header and templates; MSG91 prepaid account                          | SMS                   | `SMS_PROVIDER=disabled`; phone sign-in via WhatsApp or email                   |
| Grievance officer, seller GSTIN or unregistered status, SAC code (from a chartered accountant) | Legal pages, invoices | Legal notice and invoices stay in draft                                        |
| Razorpay account (only if a college wants to pay online)                                       | Online payments       | `PAYMENT_PROVIDER=disabled`; bank transfer                                     |
| Pen-test vendor                                                                                | Before real students  | Go-live waits                                                                  |

## 5. Gates (every phase)

- `CLAUDE.md` › Before every push, unchanged (format, lint, typecheck, unit and API tests including isolation and permissions, coverage, build, bundle budget, secret scan, e2e), with green CI on your working branch (Step 0.3).
- Plus: `deploy/prod/compose.yml` comes up locally on arm64 (or under emulation in CI) and `smoke.sh` passes; no secret in the repo (gitleaks); every paid account in §4 has its cap documented; P5's idle test passes.
- Never weaken a test to pass, never disable ClamAV, encryption or a security header to save memory or money. If something does not fit in 12 GB, reduce caches and concurrency, not protections, and report it.

## 6. Phase order

Step 0 → P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 → P11 → P12 → P13. Update `progress-4.md` after each phase with its commit, CI run and cost impact, and tell the owner the branch is ready to merge into `main` (after merging the latest `main` and a green gate, per §0).

P10 and P12 need the owner's Oracle account and domain; if those are not ready, finish every other phase, mark P10/P12 "ready to run" with the exact commands, and continue.

**Handover.** Keep `docs/build/handover-to-prompt-3.md` current from P0 onwards (the Prompt 3 session reads it whenever it merges `main`). It lists: the screens to build on your backend (the cost panel on the `costs:report` service, the pilot-preset button on the `college:pilot-preset` service, the storage limit on the billing screen if missing), any user-facing strings to add in all three locales, the P0 items Prompt 3 owns, the `NETWORK_ENABLED` rule in `buildNav()` it must keep, new env settings or routes, and that the live server deploys from `main` through P6, so every merged Prompt 3 phase reaches production after owner approval.

**Go-live rule.** Real students arrive only after **both** prompts are merged into `main` and deployed. Until Prompt 3 is finished, the live server hosts only the demo college and the owner's own checks.

**Acceptance for the whole prompt:**

- On one Oracle Always Free server behind Cloudflare, a fresh production deployment comes up from `deploy/prod/`, and the owner bootstraps the platform admin with two-factor.
- The owner creates KNRCER's college, applies the pilot preset, and can invite a cohort as soon as Prompt 3 is deployed.
- Backups land encrypted in R2 nightly and restore cleanly.
- Nothing internal is reachable from the internet.
- An idle day costs ₹0 apart from the domain.
- Every paid call is capped and visible in `costs:report` (the console panel follows with Prompt 3).
- The final report gives the owner a one-page command sequence to go live.
