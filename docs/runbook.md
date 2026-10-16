# Runbook

Operations for the production deployment described in [`deployment.md`](deployment.md). Commands assume the repository root.

Roles (fill in before launch):

| Role                                             | Who  | Reach                                          |
| ------------------------------------------------ | ---- | ---------------------------------------------- |
| On-call engineer                                 | TODO | TODO                                           |
| Platform owner (decides on incidents)            | TODO | TODO                                           |
| Grievance officer (DPDP, per the Privacy Policy) | TODO | TODO (named in `docs/legal/privacy-policy.md`) |
| Backup key holders (two people)                  | TODO | Offline; see "Backup keys"                     |

## Deploy and roll back

1. **Check CI.** It must be green on `main`: format, lint, typecheck, tests, coverage, build, end-to-end, gitleaks and `pnpm audit`.
2. **Build.**
   - `docker build -f deploy/api.Dockerfile -t campuslink-api:<sha> .`
   - `docker build -f deploy/web.Dockerfile -t campuslink-web:<sha> .`
   - Push both to ECR in `ap-south-1`.
3. **Deploy.** Update the ECS services to the new tags. A rolling deploy keeps 100% healthy, and the circuit breaker rolls back automatically on failed health checks.
4. **Smoke test.**
   - `curl -fsS https://<college>.campuslink.example/api/v1/ready` succeeds.
   - Sign in to a demo college and open Home, Jobs and Messages.
   - `curl -sI https://<college>.campuslink.example/ | grep -iE 'content-security-policy|strict-transport-security'` shows both headers.
5. **Roll back.** Redeploy the previous tag. Schema changes are additive and indexes are created on boot, so an older image runs against a newer database. Never drop a field in the same release that stops writing it.

During a deploy, the ALB deregistration delay (30 seconds) lets in-flight requests finish before a task stops.

- The API's shutdown closes the HTTP server, then the job workers, then MongoDB and Redis.
- A request whose client has already disconnected can still be running when MongoDB closes. It fails with `MongoClientClosedError` in the logs. This is expected during deploys and needs no action.

## Secrets

Secrets live in SSM Parameter Store as SecureString parameters and reach tasks through the ECS `secrets` field. To rotate one: update the parameter, then force a new deployment. Tasks read secrets at start.

| Secret                                              | How to rotate                                           | Effect                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`                                 | New 32+ byte random value, redeploy                     | Access tokens (15 minutes) stop working; the web app refreshes silently with its cookie |
| `JWT_TICKET_SECRET`                                 | Same                                                    | Half-finished 2FA sign-ins must restart                                                 |
| `MONGODB_URI` password, Redis AUTH                  | Add the new credential, deploy, then remove the old one | No downtime when done in that order                                                     |
| SES SMTP credentials, `VAPID_*`, `JITSI_APP_SECRET` | Replace and redeploy                                    | Changing VAPID keys invalidates existing push subscriptions; members re-enable push     |
| `FIELD_ENCRYPTION_KEY`                              | **Not rotatable yet** (see the gaps)                    | Phone numbers, TOTP secrets and list emails are encrypted with it; losing it loses them |

- **Suspected leak of `FIELD_ENCRYPTION_KEY`:** treat it as an incident.
  1. Restrict SSM access.
  2. Plan a re-encryption release. The cipher format is versioned (`v1.`), so add a key ring that decrypts `v1` and writes `v2`, re-encrypt in a background job, and recompute the blind indexes.

## Backups

`scripts/backup/backup.sh` writes `<db>-<UTC timestamp>.archive.gz.age` and a `.sha256` file next to it.

- The archive is a `mongodump` (gzip) encrypted with [age](https://age-encryption.org) (X25519 and ChaCha20-Poly1305).
- age is authenticated: a modified or truncated file fails to decrypt instead of restoring corrupt data. `openssl enc` was rejected for this reason; its CBC mode has no integrity check.
- The backup task holds only the recipients file (public keys). It can write backups but cannot read them.

### Backup keys

- Generate the recovery identity offline: `age-keygen -o campuslink-backup-identity.txt`.
- Print the public key with `age-keygen -y campuslink-backup-identity.txt` and store it as `BACKUP_RECIPIENTS` content.
- Keep the identity file offline in two places, held by two key holders (for example, an encrypted USB key in a safe, plus a password manager vault).
- Recipients files can list several public keys, so a second holder's key can be added without re-encrypting old backups.
- To rotate, add the new recipient, keep the old identity until every backup encrypted to it has expired (35 days under Object Lock), then destroy it.

### Schedule (production)

- **Every 6 hours and daily at 02:00 IST:**
  - `BACKUP_DB=campuslink BACKUP_RECIPIENTS=/run/secrets/recipients.txt MONGODUMP_CONFIG=/run/secrets/mongodump.yaml scripts/backup/backup.sh /backups`, as a scheduled ECS task.
  - Then upload to the backup bucket (SSE-KMS, Object Lock 35 days, replicated to `ap-south-2`).
- `MONGODUMP_CONFIG` is a YAML file containing `uri: mongodb+srv://…`. It keeps the password off the command line.
- **Alert** if no backup succeeds for 26 hours.

### Restore

Always restore into a new database, verify it, then cut over deliberately.

1. Fetch the backup and its `.sha256` from S3.
2. `BACKUP_IDENTITY=/secure/campuslink-backup-identity.txt scripts/backup/restore.sh <file> campuslink_restore`. The script:
   - checks the checksum;
   - decrypts the whole file first, so tampering is caught before anything is written;
   - restores with namespaces renamed `campuslink.*` → `campuslink_restore.*`;
   - refuses to restore over the source database.
3. Verify the restored database:
   - collection counts against the source, as the drill does;
   - a sign-in against a staging API pointed at it.
4. **Cut over:**
   - for a full restore, point `MONGODB_URI` at the restored database and redeploy;
   - for a partial recovery, copy the affected documents back with a reviewed script run under `withPlatformScope`, and audit the operation.
5. Delete the plaintext restore database when it is no longer needed.

### Drill (monthly)

`pnpm backup:drill`. It backs up the database with a throwaway key, restores into `<db>_drill`, compares document and index counts for every collection, prints timings and drops the drill database. It exits non-zero on any mismatch.

| Date       | Database                               | Collections | Documents | Mismatches | Encrypted size | Backup | Restore | By            |
| ---------- | -------------------------------------- | ----------- | --------- | ---------- | -------------- | ------ | ------- | ------------- |
| 2026-10-16 | `campuslink` (demo seed)               | 61          | 379       | 0          | 161 KiB        | 0.9 s  | 3.9 s   | Phase 8 build |
| 2026-10-16 | `campuslink_load` (1,000 demo members) | 61          | 40,342    | 0          | 807 KiB        | 1.5 s  | 3.9 s   | Phase 8 build |

Also checked on 2026-10-16:

- A backup with one byte changed is refused (`age: failed to decrypt and authenticate payload chunk`).
- Restoring onto the source database name is refused.

### Recovery targets

| Scenario                                    | RPO                         | RTO                                 |
| ------------------------------------------- | --------------------------- | ----------------------------------- |
| One Availability Zone lost                  | 0 (replica set failover)    | < 1 minute                          |
| Region lost, standby member in `ap-south-2` | seconds of replication lag  | about 1 hour                        |
| Region lost, backups only                   | 6 hours                     | about 2 hours                       |
| Bad write or deletion (operator or bug)     | up to 6 hours (last backup) | about 1 hour for a partial recovery |

## Incident response

1. **Triage.** Declare an incident in the team channel. Name an incident lead. Note the start time and the request ids involved.
2. **Contain.** Use the smallest control that stops harm:
   - **Suspend a member:** Admin → People → Suspend. This revokes sessions immediately.
   - **Suspend a college:** platform console → Colleges → Suspend. This signs everyone out.
   - **Disable a feature:** turn off its college feature toggle.
   - **Stop ingestion:** `INGESTION_ENABLED=false`, then redeploy.
   - **Block abusive traffic:** AWS WAF IP set or rate rule.
   - **Leaked credential:** rotate it (see Secrets). For a leaked refresh token, revoke the member's sessions; reuse detection already revokes a whole session when an old refresh token is replayed.
3. **Investigate.**
   - Logs are in CloudWatch, keyed by request id.
   - Admin actions, logins, role changes, exports and verification decisions are in the append-only audit log (Admin → Audit, or the platform console).
   - The super admin never reads tenant message content. Message bodies are encrypted.
4. **Personal-data breach (DPDP Act 2023):**
   - Inform the affected college, which is the data fiduciary, at once, with facts, scope and containment.
   - The college notifies the Data Protection Board and affected people as the Act and its rules require. Keep a timeline.
   - Record what data, whose, and when, from the audit log and logs, without copying personal data into tickets.
5. **Recover and review.**
   - Restore if needed (see Restore).
   - Write a blameless review within five working days: timeline, cause, what worked, and fixes with owners.

## Common alerts

| Alert                        | Likely cause                                    | First steps                                                                                                 |
| ---------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/ready` failing             | MongoDB or Redis unreachable                    | Check replica set status and ElastiCache health; the API recovers on its own when they return               |
| 5xx above 1%                 | A bad deploy, or a dependency is down           | Compare with the deploy time; roll back; look up the request ids in the logs                                |
| p99 above 1.5 s              | Load above capacity, or a slow query            | Scale API tasks out; check the MongoDB profiler for slow operations; the For You feed is the heaviest route |
| Many 429s                    | Abuse, or a misconfigured client                | Check which limiter and key; block at the WAF if it is abuse; never raise `RATE_LIMIT_SCALE` above 2        |
| BullMQ failed jobs rising    | Mail (SES) errors, or push endpoints gone       | Check the job error; SES sending quota; expired push subscriptions are removed automatically                |
| Replication lag above 60 s   | Secondary under-provisioned, or a network issue | Check member health; backups read from secondaries, so check the backup window                              |
| Backup missing for 26 hours  | Scheduler, credentials or bucket policy         | Run the backup task by hand; check the task logs and the KMS and S3 permissions                             |
| Feed or job ingestion errors | A source changed or blocked us (robots.txt)     | The source backs off on its own; review it under Admin → Sources or Job sources                             |

## Data requests

- **Export:** members download their own data under Settings → Your data (`GET /api/v1/me/export`). The download is audited as `privacy.exported`.
- **Deletion:**
  - Members schedule it themselves. The grace period is 30 days by default (`retention.deletedAccountGraceDays` per college).
  - The daily retention job erases the account when the grace period ends (`privacy.erased` in the audit log).
  - Consent records and the audit log are kept as legal evidence, keyed by id only.
- **Requests that arrive by email:** pass them to the grievance officer, who verifies identity through the college before anyone acts. Staff never export another member's data by hand.

## Known gaps (operations)

| Gap                                                              | Owner          | Next step                                                         |
| ---------------------------------------------------------------- | -------------- | ----------------------------------------------------------------- |
| `FIELD_ENCRYPTION_KEY` rotation (key ring and re-encryption job) | API            | `v2` cipher prefix, background re-encryption, blind index rebuild |
| S3 storage adapter; ClamAV scanner adapter                       | API / Ops      | See [`deployment.md`](deployment.md#gaps-before-launch)           |
| Infrastructure as code for the topology and DR standby           | Ops            | Terraform or CDK                                                  |
| On-call roster and key holders                                   | Platform owner | Fill in the roles table above                                     |
