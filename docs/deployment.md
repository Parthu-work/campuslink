# Deployment (AWS India)

This is the production plan for one deployment that serves every college as a subdomain (`<college>.campuslink.example`, plus `admin.` for the platform console).

- The primary region is AWS Asia Pacific (Mumbai), `ap-south-1`.
- Disaster recovery is in Asia Pacific (Hyderabad), `ap-south-2`.

Everything in this repository runs on free, open-source software. The AWS services named here are what a college or operator pays for in production. Price them in the AWS Pricing Calculator for `ap-south-1`; this guide gives no figures because prices change.

Runbook for day-to-day operations: [`runbook.md`](runbook.md).

## Data residency

- All personal data stays in India, in line with the DPDP Act 2023 baseline in [`privacy.md`](privacy.md):
  - databases, Redis, file storage, backups and logs live in `ap-south-1`;
  - DR copies live in `ap-south-2`.
- No service in the request path stores personal data outside these two regions.
- If CloudFront is added in front of the web app:
  - cache only the static build (`/assets/*`, icons, manifest);
  - never cache `/api/*`, which sends `Cache-Control: no-store`.
- Email goes through Amazon SES in `ap-south-1`. Message bodies carry names and times only, never message or request text (CLAUDE.md).
- Video calls use Jitsi. To keep media in India, self-host Jitsi in `ap-south-1` (`JITSI_BASE_URL`, plus `JITSI_APP_ID` and `JITSI_APP_SECRET` for expiring room links). The public `meet.jit.si` service is for development only. See [`video.md`](video.md).

## Topology

```
Route 53  *.campuslink.example (wildcard)        ACM wildcard certificate
    │
ALB (HTTPS 443, TLS 1.2+; HTTP 80 → 301)  ── AWS WAF (managed common rule set, rate rule)
    │
    ├── default: web tasks, nginx (deploy/web.Dockerfile): static build + security headers
    └── /api/*:  API tasks (deploy/api.Dockerfile, Express + Socket.io), ≥ 2 tasks across 2 AZs
            │    worker tasks (deploy/worker.Dockerfile, BullMQ jobs; no traffic from the ALB), ≥ 2 tasks
            │
            ├── MongoDB 8 replica set: 3 members across 3 AZs (+1 hidden member in ap-south-2)
            ├── Redis (ElastiCache, TLS, noeviction): rate limits, BullMQ, Socket.io adapter
            ├── S3 (SSE-KMS, Block Public Access): files and encrypted backups
            └── SES (SMTP): email
```

- **Compute:** ECS on Fargate (or EC2 with the same containers).
  - Run three services: `web` (nginx serving the Vite build), `api` (`node dist/server.js` with `PROCESS_ROLE=api`) and `worker` (the same code with `PROCESS_ROLE=worker`, from its own image).
  - The API is stateless:
    - sessions are JWTs plus refresh records in MongoDB;
    - rate limits and queues are in Redis;
    - Socket.io fans out through the Redis adapter and is websocket-only, so no sticky sessions are needed.
  - **Workers** run the BullMQ jobs (study processing, embeddings, email and push, ingestion, alerts) and the maintenance timers (retention, ingestion, nudges); API tasks only queue jobs. Job ids dedupe across tasks. A worker serves only `/api/v1/health` and `/api/v1/ready` (for its container check) and emits live updates to members through the Socket.io Redis adapter.
  - The worker image carries `ffmpeg`, `poppler-utils` and Tesseract (English and Telugu); the API image has none of them. Without `PROCESS_ROLE` a process does both (`all`, the default for development and single-host installs).
- **Load balancer:**
  - The ALB terminates TLS with an ACM wildcard certificate for `*.campuslink.example` and the apex.
  - Use the `ELBSecurityPolicy-TLS13-1-2-2021-06` policy and redirect HTTP to HTTPS on the listener.
  - Set the idle timeout to at least 75 seconds, for websockets.
  - Set the deregistration delay to 30 seconds, so in-flight requests finish before a task stops.
- **Security headers:**
  - `deploy/nginx/security-headers.conf` holds the CSP, HSTS (two years, subdomains), nosniff, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP and `X-Frame-Options`. It is checked by `apps/web/src/lib/security-headers.test.ts`, and the end-to-end suite runs under the same policy.
  - The API sets its own headers (Helmet: `default-src 'none'`, HSTS in production, `no-store`).
- **WAF:** attach AWS WAF to the ALB with the managed common rule set and a rate-based rule per IP.
  - This sits in front of the application's own Redis-backed limits; it does not replace them.

## Data stores

### MongoDB

The application needs a replica set: it uses transactions and the unique indexes on booking holds. Choose one of two options:

1. **Self-managed (MongoDB Community 8).**
   - Three EC2 instances in three Availability Zones of `ap-south-1`, on gp3 EBS volumes encrypted with KMS.
   - Add a fourth, hidden, priority-0 member in `ap-south-2` for disaster recovery.
   - Use keyfile or x.509 member authentication, TLS between members and clients, and SCRAM users with least privilege (the app user has `readWrite` on the app database only).
2. **MongoDB Atlas on AWS `ap-south-1`.** Use a dedicated tier (not a shared one) with backups and an `ap-south-2` read-only node for DR.

Indexes are created on boot (`syncIndexes()`), and every compound index leads with `tenantId`.

### Redis

- ElastiCache for Redis (or Valkey), Multi-AZ, in-transit and at-rest encryption, with AUTH.
- Set `maxmemory-policy noeviction`. BullMQ must never lose jobs to eviction, and the rate limiter must never forget counters.
- Redis holds no personal data beyond user ids in rate-limit keys and job payloads (ids only).

### Files

- Files go through `FilesService`. They are sniffed, re-encoded or rebuilt, given random keys and served with `nosniff` and a sandboxed CSP.
- **Storage:** `STORAGE_DRIVER=s3` (`apps/api/src/lib/s3-storage.ts`).
  - Use a private bucket in `ap-south-1` with Block Public Access, SSE-KMS (a customer-managed key in `S3_KMS_KEY_ID`) and versioning.
  - The adapter never sets an ACL, sends server-side encryption on every put and keeps objects under `S3_PREFIX`.
  - Set a lifecycle rule for incomplete multipart uploads.
  - Grant the API's task role only `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/files/*`, `s3:ListBucket` for the readiness check, and `kms:GenerateDataKey` and `kms:Decrypt` on the key.
  - In production the API refuses `S3_SSE=none`. `/api/v1/ready` includes the bucket.
- **Antivirus:** ClamAV `clamd` runs as a sidecar container in each API task (`clamav/clamav:1.5.4`).
  - Set `CLAMD_CONF_StreamMaxLength=210M` and `CLAMD_CONF_MaxFileSize=210M`, above the largest upload (200 MB study videos), `CLAMD_CONF_MaxScanSize=420M`, `CLAMD_CONF_MaxScanTime=170000` (under the API's three-minute scan timeout), and `CLAMD_CONF_AlertExceedsMax=yes` so a file over a limit is reported (and refused) instead of passing unscanned.
  - Request bodies: the ALB has no body limit; with nginx in front (`deploy/nginx/campuslink.conf`) the general bound is 30 MB and only the study upload routes allow 210 MB (`/api/v1/study/materials` and `…/versions`).
  - Let `freshclam` update signatures; leave `CLAMAV_NO_FRESHCLAMD` unset.
  - The API uses `MALWARE_SCANNER=clamav` and `CLAMAV_ADDRESS=127.0.0.1:3310` (`apps/api/src/lib/clamav.ts`, INSTREAM protocol).
  - Scanning fails closed: if `clamd` is down, uploads answer 503 and nothing is stored. `/api/v1/ready` includes the scanner, so the ALB stops routing to a task whose scanner is down.
  - The API refuses to start in production without a scanner.
  - Give the sidecar about 1.5 GB of memory for the signature database.
- **Study material processing** (`docs/ai-assistant.md`) runs on the workers: the worker image includes `ffmpeg`, `poppler-utils` and Tesseract with English and Telugu. Set `OCR_LANGUAGES=eng+tel` to read Telugu scans. For transcripts without a provider key, run a Whisper service (the `whisper` profile in `docker-compose.yml` shows one) and set `WHISPER_URL` on the workers; Whisper is its own service, never part of either image.
- **Vector index:** with more than one API task, run Qdrant (`qdrant/qdrant:v1.19.2`, a managed Qdrant, or the `qdrant` profile locally) and set `QDRANT_URL` (and `QDRANT_API_KEY`); `VECTOR_STORE=qdrant` makes the API refuse to start without it. The default in-memory index suits one server only. Vectors are also stored in MongoDB, so a new or wiped Qdrant is filled again with **Rebuild the index** (Admin › AI assistant) at no provider cost.

## Configuration and secrets

- All configuration comes from environment variables, validated at boot (`apps/api/src/config/env.ts`). The API refuses to start in production on:
  - placeholder secrets;
  - `RATE_LIMIT_SCALE` above 2;
  - `MAIL_DRIVER=disabled`;
  - `MALWARE_SCANNER=none`;
  - `S3_SSE=none` with S3 storage;
  - `PAYMENT_PROVIDER=stub`.
- Store secrets as SecureString parameters in SSM Parameter Store (KMS-encrypted).
  - Inject them through the ECS task definition `secrets` field.
  - Never put them in images, task definition plain-text environment, or logs.

| Variable                                                                                | Production value                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                              | `production`                                                                                                                                                                                    |
| `APP_ROOT_DOMAIN`                                                                       | `campuslink.example`                                                                                                                                                                            |
| `WEB_ORIGIN`, `CORS_ALLOWED_ORIGINS`                                                    | `https://campuslink.example`, `https://*.campuslink.example`                                                                                                                                    |
| `TRUST_PROXY_HOPS`                                                                      | `1` (the ALB routes `/api/*` straight to the API); `1` on a single host behind nginx                                                                                                            |
| `MONGODB_URI`, `REDIS_URL`                                                              | SSM SecureString; TLS (`tls=true`, `rediss://`)                                                                                                                                                 |
| `JWT_ACCESS_SECRET`, `JWT_TICKET_SECRET`                                                | SSM; 32+ random bytes each; different values                                                                                                                                                    |
| `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEYS_PREVIOUS`                                | SSM; 32 random bytes, base64 (`openssl rand -base64 32`); previous keys only during a rotation (runbook)                                                                                        |
| `COOKIE_SECURE`                                                                         | unset (defaults to `true` in production)                                                                                                                                                        |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`                         | SES SMTP endpoint for `ap-south-1`, port 587, SES SMTP credentials, a verified sender                                                                                                           |
| `STORAGE_DRIVER`, `S3_BUCKET`, `S3_REGION`                                              | `s3`, the private files bucket, `ap-south-1`                                                                                                                                                    |
| `S3_SSE`, `S3_KMS_KEY_ID`, `S3_PREFIX`                                                  | `aws:kms` (default), the customer-managed key, `files/` (default)                                                                                                                               |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                               | unset on AWS (the task role supplies credentials); only for S3-compatible stores                                                                                                                |
| `MALWARE_SCANNER`, `CLAMAV_ADDRESS`                                                     | `clamav`, `127.0.0.1:3310` (the sidecar)                                                                                                                                                        |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                                | from `pnpm --filter @campuslink/api vapid`; subject `mailto:` the operator                                                                                                                      |
| `JITSI_BASE_URL`, `JITSI_APP_ID`, `JITSI_APP_SECRET`                                    | the self-hosted Jitsi in `ap-south-1`                                                                                                                                                           |
| `BOT_PROTECTION`, `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY`                              | `turnstile`, the secret (SSM), the public site key for the college domains                                                                                                                      |
| `BILLING_SELLER_NAME`, `BILLING_SELLER_ADDRESS`                                         | the platform owner's registered business name and address (printed on every invoice)                                                                                                            |
| `BILLING_GST_REGISTERED`, `BILLING_SELLER_GSTIN`, `BILLING_SELLER_STATE`                | `true`, the GSTIN, its two-digit state code (the GSTIN must start with it)                                                                                                                      |
| `BILLING_SAC_CODE`, `BILLING_GST_RATE`                                                  | as confirmed by a chartered accountant (the console warns while the SAC code is empty)                                                                                                          |
| `BILLING_INVOICE_PREFIX`, `BILLING_PAYMENT_TERMS_DAYS`, `BILLING_BANK_DETAILS`          | `CL`, `30`, the account, IFSC and bank for transfers                                                                                                                                            |
| `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `razorpay` (or `disabled`; `stub` is refused), the live key id, the key secret and webhook secret (SSM). Webhook URL `https://admin.<root>/api/v1/webhooks/razorpay`, event `payment_link.paid` |
| `HIBP_ENABLED`                                                                          | `true` (k-anonymity; only a 5-character hash prefix leaves the server)                                                                                                                          |
| `LOG_LEVEL`                                                                             | `info`                                                                                                                                                                                          |

## Monitoring

- **Logs:** the API writes JSON to stdout (Pino, with redaction as a safety net, never as permission to log personal data). Ship them to CloudWatch Logs in `ap-south-1` with 30-day retention. Every request has an `x-request-id`.
- **Health:**
  - `GET /api/v1/health` is liveness and is used by the container health check;
  - `GET /api/v1/ready` checks MongoDB and Redis and is used by the ALB target group.
- **Alarms (CloudWatch):**
  - ALB 5xx rate above 1% for 5 minutes;
  - target p99 latency above 1.5 s for 10 minutes (the For You feed is the slowest route, see [`performance.md`](performance.md));
  - unhealthy targets;
  - MongoDB replication lag above 60 s, or a member down;
  - Redis memory above 70%;
  - BullMQ failed jobs increasing;
  - the backup job not succeeding for 26 hours;
  - certificate expiry under 30 days.
- **Tracking:** there are no third-party trackers or analytics; product analytics are the first-party aggregates in the admin dashboard.

## Sizing

From the load test ([`performance.md`](performance.md)): one API process on one vCPU handles roughly 80–90 For You feed requests a second and hundreds of other reads a second for a 1,000-member college.

- Two tasks of 1 vCPU and 2 GB, each running one Node process, give a large margin for several colleges of that size and survive the loss of one Availability Zone.
- Scale out on CPU above 60%.
- MongoDB: start with three members of 2 vCPU and 8 GB each, and grow when the working set (indexes plus hot posts and notifications) outgrows memory.

## Backups and disaster recovery

- **Backups:** `scripts/backup/backup.sh` runs as a scheduled ECS task (EventBridge Scheduler).
  - It runs every 6 hours, plus daily at 02:00 IST.
  - It dumps from a secondary and encrypts with `age` to the recovery public key, so the backup task cannot decrypt.
  - It writes to an S3 bucket in `ap-south-1` with SSE-KMS and Object Lock in compliance mode (35-day retention).
  - The bucket replicates to `ap-south-2`.
- **Second layer:** EBS snapshots of the MongoDB volumes (Data Lifecycle Manager, daily, 14 kept, copied to `ap-south-2`).
- **Targets:**

  | Scenario                                   | Recovery point (RPO)           | Recovery time (RTO)                                                    |
  | ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------- |
  | One AZ lost                                | 0 (the replica set fails over) | under 1 minute                                                         |
  | Region lost, hidden member in `ap-south-2` | seconds of replication lag     | about 1 hour: promote the member, start the stack from IaC, switch DNS |
  | Region lost, backups only                  | 6 hours                        | about 2 hours                                                          |

- **Restore:** see the runbook. Restores always go into a separate database first and are verified there.
- **Drill:** `pnpm backup:drill` (backup, restore and per-collection comparison) runs monthly. Record the result in the runbook.

## Staging rehearsal

`deploy/staging/` runs the production images in production mode, with every production adapter against a real service:

- a TLS edge in place of the ALB;
- the web container (nginx with the security headers);
- the API (`NODE_ENV=production`, `PROCESS_ROLE=api`) and a worker (`PROCESS_ROLE=worker`, the worker image);
- MongoDB as a replica set, Redis, ClamAV `clamd`, an S3-compatible store (SeaweedFS, SSE-S3), and Mailpit for email.

```sh
deploy/staging/up.sh --build   # secrets and a self-signed certificate go to .staging/ (gitignored)
deploy/staging/smoke.sh        # see below
deploy/staging/down.sh         # --purge also deletes .staging/
```

The smoke test checks:

- every dependency reports ready (MongoDB, Redis, ClamAV, the bucket);
- the web and API security headers are present;
- sign-in works under the production CSP;
- a photo goes through sniffing, re-encoding, ClamAV and S3, then back out through the API;
- the service worker registers over HTTPS;
- study material uploaded through the API is processed by the worker (the API only queues it) and reaches **Ready**;
- the API and worker logs hold no request headers, client details or email addresses.

The rehearsal seeds the FLAT demo subject without its files (`SEED_STUDY_MATERIAL=false`): files belong in the bucket, and the smoke test uploads its own.

**Rehearsal on 2026-10-17:**

- The images built from this repository; the API passed its production configuration checks and became ready.
- The smoke test passed.
- The stored photo had `scanStatus: clean`, and the object was encrypted (SSE-S3, AES256).
- With `clamd` stopped, `/api/v1/ready` answered 503 (`clamav: false`) and recovered once `clamd` was back.

Not covered by the rehearsal: AWS itself. The ALB, ACM, KMS, IAM policies, SES, and the Hyderabad standby need a real account; use the checklist under "Deploying".

## Deploying

1. CI must be green on `main`: lint, typecheck, unit and API tests, coverage, build, end-to-end, gitleaks and `pnpm audit`.
2. Build three images from the repository root and push them to ECR in `ap-south-1`, tagged with the commit SHA:
   - `docker build -f deploy/api.Dockerfile -t campuslink-api:<sha> .`: the API, run as the non-root `node` user, with a health check.
   - `docker build -f deploy/worker.Dockerfile -t campuslink-worker:<sha> .`: the background worker with the media tools, non-root, with a readiness check.
   - `docker build -f deploy/web.Dockerfile -t campuslink-web:<sha> .`: the Vite build behind nginx on port 8080, with the security headers.
3. Update the ECS services with a rolling deployment: minimum healthy 100%, maximum 200%, and the circuit breaker with rollback on.
4. Smoke test:
   - `/api/v1/ready` succeeds;
   - sign in on a demo college;
   - check the security headers with `curl -sI https://<college>.campuslink.example/ | grep -i content-security-policy`.
5. Rolling back means redeploying the previous image tag. Migrations are additive, and indexes are created on boot, so an older image runs against a newer database.

## Gaps before launch

| Gap                                                 | Owner           | Next step                                                                   |
| --------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| An external penetration test                        | Platform owner  | Before the first real college                                               |
| Infrastructure as code                              | Ops             | Terraform or CDK for the topology above, including the `ap-south-2` standby |
| Legal review of the Privacy Policy and Terms drafts | College / legal | [`legal/`](legal/) templates; name the grievance officer                    |
| SAC code and GST treatment of the plans             | Platform owner  | Confirm with a chartered accountant; set `BILLING_SAC_CODE` and the rate    |
| Razorpay webhook payload against a live test event  | Platform owner  | Send the dashboard's test `payment_link.paid` to staging before going live  |
