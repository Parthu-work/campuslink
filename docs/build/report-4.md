# Prompt 4 report: deployable at zero unnecessary cost

Branch `claude/clever-hypatia-cpgn8m`. Details per phase: [`progress-4.md`](progress-4.md).

## Where things stand

Everything that can be built and proven without the owner's accounts is done: the production
bootstrap, the one-server compose, the edge, the scheduler and idle rules, the cost report, the
release and deploy workflow, backups and the restore drill, alerts, settings and secrets, provisioning,
the pilot preset and the launch checklist. The production compose came up on this machine from
generated secrets and passed the full smoke test. What remains needs the owner: an Oracle account and
a domain (P10, P12) and the provider accounts (§4 of the brief). ADR 0014 was accepted on 11 Nov 2026.

## Built, per phase

| Phase | What                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | `NETWORK_ENABLED` (ADR 0014 accepted on 11 Nov 2026; on in production by setting, off when unset); `pnpm audit --prod` clean (Mongoose high advisories fixed; `archiver` gone); pen-test focus areas             |
| P1    | `platform:bootstrap`: the platform tenant and one super admin, a single-use 30-minute link, two-factor at first sign-in                                                                                          |
| P2    | `deploy/prod/compose.yml` (authenticated MongoDB replica set, Redis password, Qdrant key, ClamAV, encrypted S3, Ollama; limits, health checks, log rotation, non-root, read-only); `smoke.sh`; `deploy-check.js` |
| P3    | the edge template on `APP_ROOT_DOMAIN`; Origin CA TLS; `CF-Connecting-IP` from Cloudflare only; one trusted hop; origin locked at three layers; minimal access log                                               |
| P4    | free embeddings on the server (`nomic-embed-text`, 768 dimensions) through the private-endpoint allowlist; vector size checked at every deploy                                                                   |
| P5    | one scheduler with a Redis lock per task and slot; idle colleges get no job; a 48-hour idle test with zero paid calls; `costs:report`                                                                            |
| P6    | `release.yml`: arm64 and amd64 images to GHCR with SBOM, worker tools and Hindi OCR checked on Arm; owner-approved deploy with automatic rollback; `rollback.sh`                                                 |
| P7    | nightly age-encrypted backups and `rclone crypt` file copies to R2 (7/4/3); restore drill; storage limits per plan and college                                                                                   |
| P8    | Sentry, uptime checks, host alerts by email, `/metrics` hidden at the edge, runbook section                                                                                                                      |
| P9    | `.env.production.example`, `gen-secrets.sh`, three new production refusals, empty values as unset, `deployment.md` pilot-first                                                                                   |
| P10   | `provision.sh` and `docs/deploy-oracle.md` (ready to run)                                                                                                                                                        |
| P11   | `college:pilot-preset` and `docs/build/launch-checklist.md`                                                                                                                                                      |

**Bugs found on the way** (each would have stopped a real deployment): the production API image could
not start (`fflate` declared as a devDependency); nginx refused both existing configs (an unquoted
`{24}` regex); ClamAV's Alpine image has no arm64 build; a roster-sync test started failing on `main`
on 9 Nov (fixed dates); two high Mongoose advisories appeared.

## Measured numbers

| Measure                                           | Result                                                                                                                                                               | Where measured                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Memory per container at idle                      | edge 6 MB, web 5 MB, api 179 MB, worker 188 MB, mongo 309 MB, redis 6 MB, qdrant 27 MB, clamav 969 MB, seaweedfs 40 MB; **about 1.7 GB total** (limits sum 11.25 GB) | rehearsal, x86, 11 Nov 2026                                 |
| Idle CPU, 5-minute average                        | about 13% of one core across the stack (MongoDB 6.6%, API 3.3%, the rest under 1% each)                                                                              | rehearsal (machine also busy); **re-measure on the server** |
| Idle cost in a simulated 48 hours                 | 0 AI usage rows, 0 channel messages, 0 outbound calls, 0 jobs queued                                                                                                 | `apps/api/test/scheduler.test.ts`                           |
| Smoke test                                        | all 8 steps pass (embeddings skipped: model not downloadable here)                                                                                                   | rehearsal                                                   |
| Embedding time, quality, RAM                      | **not measured**: the model registry is blocked in this session                                                                                                      | P12 on the server                                           |
| Load test (300 concurrent), Lighthouse from India | **not measured**: needs the server                                                                                                                                   | P12                                                         |
| Backup and restore times                          | **not measured**: needs the R2 bucket and the age key                                                                                                                | P12                                                         |

## Monthly cost

Prices of pay-per-use services are not quoted here: they change, and this report must not invent
figures. Set the per-unit prices in `.env` (`AI_PLATFORM_PRICE_*`, `COST_WHATSAPP_MESSAGE_PAISE`,
`COST_SMS_MESSAGE_PAISE`, `COST_USD_INR`) from each provider's current price list, and
`costs:report` shows the month in rupees.

| Line                        | Free-tier limit or cap                                          | Idle month                       | Pilot month (1 college, 1,000 students, the pilot preset)                                                      | How close to the limit                                           |
| --------------------------- | --------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Oracle A1 server            | Always Free: 2 OCPU, 12 GB, 200 GB block, 10 TB out             | ₹0                               | ₹0                                                                                                             | idle 1.7 GB of 12; 200 of 200 GB allocated (50 boot + 150 block) |
| Cloudflare (DNS, TLS, WAF)  | free plan                                                       | ₹0                               | ₹0                                                                                                             | one rate-limit rule (the free plan's one)                        |
| Cloudflare R2 (backups)     | 10 GB-month, 1M class A, 10M class B ops                        | ₹0                               | ₹0 while under 10 GB: files capped at 4 GB per college, alert at 8 GB                                          | 7 + 4 + 3 compressed archives plus one file copy                 |
| GitHub Actions and GHCR     | free for public repositories                                    | ₹0                               | ₹0                                                                                                             | about 12 runner jobs per release                                 |
| Email (SMTP free tier)      | the provider's daily limit (Brevo: 300 a day when written)      | ₹0                               | ₹0; cohort invites go in batches under the daily limit                                                         | sign-up and reset mails only                                     |
| Sentry, UptimeRobot         | free plans                                                      | ₹0                               | ₹0                                                                                                             | scrubbed errors only                                             |
| Embeddings                  | on the server (Ollama)                                          | ₹0                               | ₹0                                                                                                             | CPU only while indexing                                          |
| Chat answers (Claude Haiku) | the Anthropic monthly spend limit; the college's allowance      | **₹0** (no call)                 | at most 3,000 tokens × 1,000 students = 3 M tokens, × the platform's price; then answers fall back to passages | enforced before every call (`AiSettingsService.runtime()`)       |
| WhatsApp (Meta)             | the college's allowance; each member's weekly cap; Meta's limit | **₹0**                           | at most 1 × 1,000 = 1,000 messages × Meta's per-message rate                                                   | enforced before every message (`ChannelService`)                 |
| SMS (MSG91)                 | the prepaid balance                                             | **₹0**                           | codes only, × the DLT rate; cannot exceed the balance                                                          | low-balance alert at MSG91                                       |
| Razorpay                    | not used (bank transfer)                                        | ₹0                               | ₹0                                                                                                             |                                                                  |
| Domain                      | the only fixed charge (approved)                                | about ₹60–85 (₹700–1,000 a year) | the same                                                                                                       |                                                                  |

**An idle day costs ₹0 apart from the domain**: no timer calls a paid service when nobody uses the
product (proved by the 48-hour test), and every paid service is pay-per-use with a cap enforced both
at the provider and in the application.

## The owner's remaining actions

1. ~~Answer on ADR 0014~~: accepted on 11 Nov 2026; the ADR and the production template are updated.
2. Merge this branch into `main` (after its CI run is green). Turn on the `production` environment
   with yourself as the required reviewer.
3. Start the slow accounts now: Meta WhatsApp business verification and templates; the DLT entity,
   header and templates with MSG91; the chartered accountant (GSTIN or unregistered, SAC code); the
   lawyer's review; the pen-test vendor.
4. Create the Oracle account (Pay As You Go, Hyderabad or Mumbai) and move the domain's DNS to Cloudflare.
5. Follow `docs/deploy-oracle.md` steps 1 to 12, then the P12 checks below, then
   `docs/build/launch-checklist.md` once prompt 3 is merged and deployed.

## The command sequence for KNRCER

On your computer:

```bash
age-keygen -o campuslink-backup-key.txt
```

On the server (`ssh ubuntu@<ip>`, after attaching the block volume):

```bash
sudo SSH_ALLOW=<your-ip>/32 DEPLOY_KEY="<your ssh public key>" BLOCK_DEVICE=/dev/sdb bash provision.sh
```

As `deploy` (`ssh deploy@<ip>`):

```bash
cd /srv/campuslink/deploy/prod && ./gen-secrets.sh --domain <domain>
```

Fill in `.env` and `backup.env` (owner values), save `tls/fullchain.pem` and `tls/privkey.pem` from
Cloudflare, then:

```bash
docker compose pull && docker compose up -d --wait && ./smoke.sh
```

```bash
sudo systemctl enable --now campuslink-backup.timer campuslink-drill.timer && ./backup.sh
```

```bash
BACKUP_IDENTITY=<path to the key, brought for the run> ./drill.sh
```

```bash
docker compose exec api node dist/scripts/platform-bootstrap.js --email <you> --name "<your name>"
```

Open the link, set the password, sign in at `https://admin.<domain>`, turn on two-factor, create the
college `knrcer` in the console, then:

```bash
docker compose exec api node dist/scripts/pilot-preset.js --slug knrcer --dry-run
```

```bash
docker compose exec api node dist/scripts/pilot-preset.js --slug knrcer
```

```bash
docker compose exec api node dist/scripts/costs-report.js
```

Then the launch checklist (roster import with a dry run, legal details, one cohort's invites).

## P12 checks to run on the server (record the results here)

1. `./smoke.sh` on a college host and on `admin.`; Lighthouse from India on a college host (LCP, INP).
2. Load: `pnpm loadtest` from another machine against the demo college, 300 concurrent members
   (p95, error rate) while `docker stats` records the peak per container.
3. Embeddings: upload a 50-page PDF to the demo college; time it from the worker log; `docker stats`
   for Ollama's peak; 20 questions against the seeded study material, compared with `mock`.
4. Backup to R2, then the restore drill with the key (times are in the drill's email).
5. Live providers, each only with its key: `ai:smoke`; one WhatsApp authentication and one utility
   template to your phone with a quick-reply round trip; one SMS code; Razorpay only if payments are on.
6. Idle: leave the demo college untouched for 24 hours, then the 5-minute idle CPU and `costs-report.js`
   (expect ₹0 for the day).
