# Phase 8: Hardening and launch readiness

Phase 8 is done when:

- Every requirement in the security section of the brief has evidence (code and tests), or a documented gap.
- Members can export their data and delete their account themselves.
- The platform has been load-tested at 1,000 members per college.
- A backup has been taken, encrypted, restored and verified.
- Deployment and operations are documented for an India region.
- The PWA installs and updates cleanly.
- The documentation is complete.

## Plan

### 1. Privacy rights (DPDP)

- **Export:** `GET /me/export` returns one JSON file of everything the platform holds about me: account, profile, consents, my posts and answers, messages I sent, requests, bookings, the job tracker and alerts, referrals, roadmap progress, points, RSVPs and notifications.
  - Each module contributes through a registered exporter; no module reads another's models.
  - Exports are rate-limited and audited.
- **Deletion:**
  - `POST /me/deletion` (password re-confirmed) starts a grace period (30 days by default), signs out every session and hides the profile.
  - `DELETE /me/deletion` cancels within the grace period.
  - After the grace period, a retention job erases the account. Each module registers an eraser that deletes the member's private data and detaches shared content, which then shows as "Former member".
  - Consent records and the audit log are kept (legal evidence), keyed only by id.
- **Templates:** Privacy Policy and Terms drafts, marked as needing legal review, with a grievance-officer placeholder.

### 2. Security review

- `docs/security-review.md` walks every item in the security section, with the file and test that prove it.
- Gaps found are fixed in this phase or listed with owners.
- Production web headers (CSP, HSTS and the rest) are shipped as an nginx configuration and checked by a test.

### 3. Performance

- `pnpm --filter @campuslink/api loadtest` seeds a college with 1,000 members and drives the main read and write paths with autocannon at realistic concurrency.
- It reports p50, p95 and p99 latency, throughput and errors.
- Slow paths get indexes or caching. Results go in `docs/performance.md`.

### 4. Accessibility

- axe already runs on every end-to-end page in both themes.
- This phase adds keyboard-only journeys, a reduced-motion check and a 200% zoom check for the main flows.
- Results go in `docs/accessibility.md`.

### 5. Backup and restore drill

- `scripts/backup/backup.sh` writes a compressed `mongodump`, encrypted with age. The plan said `openssl` AES-256; see the outcome for why that changed.
- `scripts/backup/restore.sh` restores it into a separate database.
- A drill script verifies document counts per collection and records timings.
- The runbook documents RPO and RTO.

### 6. Deployment and operations

- `docs/deployment.md`:
  - AWS Mumbai (`ap-south-1`) with Hyderabad (`ap-south-2`) for disaster recovery.
  - The API and web on ECS or EC2 behind an ALB, a MongoDB replica set, Redis, S3 with SSE-KMS for files and backups, secrets in SSM Parameter Store, TLS via ACM, and CloudWatch.
  - Data residency notes.
- `docs/runbook.md`: deploys, rollbacks, rotating secrets, incident response, restoring backups, and common alerts.

### 7. PWA polish

- PNG icons (192, 512, maskable) and an Apple touch icon.
- An "update available" prompt.
- An offline banner.

### 8. Final documentation

- README, architecture, CLAUDE.md, this phase's outcome, and a project summary.

## Assumptions

- **Production providers:** S3 storage, SMS and video providers beyond Jitsi stay behind their adapters. The deployment guide names the configuration they need.
- **Load-test scope:** the load test runs against a single API instance on this machine. The results show headroom and regressions, not production capacity, which the deployment guide sizes separately.
- **Erasure:** erasure removes personal data. Aggregate counts already computed, such as analytics caches, expire within minutes.

## Outcome

### Built

- **Privacy rights (DPDP):**
  - Settings → Your data downloads one JSON file of everything held about the member (`GET /me/export`, rate-limited and audited).
  - Deletion re-checks the password, starts a 30-day grace period (set per college), signs out every session and hides the profile.
    - Signing back in shows a banner and allows cancelling.
    - The daily retention run then erases the account through every module's eraser.
  - 19 modules register with the privacy service: 18 with an exporter and an eraser, plus consents (export only; the records are kept as evidence).
  - Privacy Policy and Terms drafts are in `docs/legal/`, marked as needing legal review.
- **Security review:** [`security-review.md`](../security-review.md) walks every item in brief section 9 with files and tests. It found and fixed:
  - **Production web headers:** `deploy/nginx/security-headers.conf`, tested; `vite preview` serves it, so all 62 end-to-end tests ran under the production CSP with no violations.
  - **The access log** recorded headers (the CSRF and bot tokens in plain text), query strings, IPs and user agents. It is now an allowlist.
  - **Missing tests** for the append-only audit log and the antivirus hook.
- **Performance:**
  - `pnpm loadtest`: 1,000 demo members, 5,000 posts, 20,000 notifications and 13 scenarios, with 0 errors. Results are in [`performance.md`](../performance.md).
  - For You now ranks on a projection and loads only the page: 73 → 81–88 req/s at 50 connections, p50 114 ms at 10.
- **Accessibility:**
  - Focus moves to the main region after client-side navigation. Before the fix, Chrome kept the Tab starting point at the removed sign-in button.
  - New keyboard-only, reduced-motion and 320 px reflow checks. Results are in [`accessibility.md`](../accessibility.md).
- **Backups:**
  - `scripts/backup/{backup,restore,drill}.sh` with age encryption.
  - The drill restored 61 collections and 40,342 documents with 0 mismatches. A tampered file and a restore over the source are both refused.
- **Deployment and operations:**
  - [`deployment.md`](../deployment.md): AWS Mumbai with Hyderabad DR, data residency, sizing and monitoring.
  - [`runbook.md`](../runbook.md): deploys, secrets, backups and restore, incidents, alerts and data requests.
  - `deploy/api.Dockerfile` and `deploy/web.Dockerfile` were built and run. The API runs as non-root in production mode and reports ready; the web image serves the headers and the cache rules.
- **PWA:**
  - PNG and maskable icons and an Apple touch icon.
  - The service worker is registered by the app with an "update available" prompt; the waiting worker activates on Reload.
  - An offline banner.
  - Covered by `e2e/pwa.spec.ts`.

### Decisions

- **age instead of `openssl enc` for backups.** `openssl enc` has no authenticated mode for files: CBC would restore a modified file silently. age is authenticated (ChaCha20-Poly1305). It also encrypts to public keys, so the backup host cannot read its own backups.
- **Restore always decrypts fully before writing.** Streaming would restore the chunks that come before a tampered one.
- **For You is not cached.** A per-college candidate cache would triple throughput, but a new post would take up to 15 seconds to appear. Measured headroom is more than 4× the estimated peak, so correctness won.
- **The access log is an allowlist**, not a longer denylist, so a new header can never leak by default.
- **The app registers its own service worker** (`injectRegister: false`) instead of the plugin's auto-register script, so `registerType: 'prompt'` has a real prompt.

### Assumptions

- Load-test figures come from one `tsx` process sharing a 4-vCPU machine with the database and the load generator: a regression baseline, not production capacity.
- AWS prices are not quoted; they change. The deployment guide names the services to price.

### Follow-up (2026-10-17): the launch gaps closed

- **Bot protection end to end:**
  - The college config carries the public Turnstile site key.
  - The web app runs the human check only when the API answers `BOT_CHECK_FAILED`, then retries once with `X-Bot-Token`. This covers all eight protected routes without changing call sites.
  - The CSP allows `challenges.cloudflare.com` for scripts and frames only.
  - Tests: `e2e/bot-check.spec.ts`, `test/bot-config.test.ts`.
- **ClamAV (`lib/clamav.ts`):**
  - Uses the INSTREAM protocol over TCP or a Unix socket, and fails closed: uploads answer 503 when `clamd` is unreachable.
  - Readiness includes the scanner, and production refuses to start without one.
  - Tested against a fake `clamd` for every failure mode, and against a real `clamd` (EICAR detected, a 25 MB upload accepted) locally and in CI.
- **S3 (`lib/s3-storage.ts`):**
  - Uses the AWS SDK with SSE on every put (KMS by default), no ACLs, validated keys under a prefix, and a readiness check. Production refuses `S3_SSE=none`.
  - Tested against a real S3-compatible store (SeaweedFS) locally and in CI.
  - A test caught the adapter skipping encryption when no SSE option was passed. Fixed before commit.
- **Staging rehearsal** (`deploy/staging/`, results in [`deployment.md`](../deployment.md#staging-rehearsal)): both production images in production mode with every adapter, behind a TLS edge. The smoke test passed.
- **Decisions:**
  - MinIO no longer publishes free community images, so local and CI tests use SeaweedFS (Apache 2.0).
  - Turnstile is triggered on challenge, not loaded up front: nothing third-party loads unless a write is challenged.

### Gaps (owners in the linked docs)

- ~~**Bot protection:** the Turnstile web widget.~~ Done in the follow-up.
- ~~**Missing adapters:** ClamAV and S3.~~ Done in the follow-up.
- ~~**Key rotation:** `FIELD_ENCRYPTION_KEY` cannot be rotated yet.~~ Done: key ring, `rotate-field-key` job and runbook procedure (2026-10-17).
- **Accessibility:** a screen-reader pass with assistive-technology users, light-theme axe on every spec, and a 200% text-zoom check.
- **Before launch:** infrastructure as code, an external penetration test, and legal review of the policy drafts.

### Next steps

- Build the Turnstile widget and the ClamAV and S3 adapters, then run a staging deployment from `deployment.md`.
- Add a Socket.io delivery scenario to the load test, and rerun it on the compiled build.
