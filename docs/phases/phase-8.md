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

- `scripts/backup.sh` streams an encrypted (`openssl` AES-256), compressed `mongodump`.
- `scripts/restore.sh` restores it into a separate database.
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
