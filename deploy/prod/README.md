# Production on one server

The pilot topology (prompt 4): one Oracle Cloud Always Free Ampere A1 server (2 OCPU, 12 GB, arm64)
behind Cloudflare, everything in containers from `compose.yml` and one env file. Step-by-step set-up:
[`docs/deploy-oracle.md`](../../docs/deploy-oracle.md). Day-to-day operations and alerts:
[`docs/runbook.md`](../../docs/runbook.md) › Single server.

## Services

| Service          | What it does                                                                                                                   | Data (named volume)          | Memory limit | Idle use (rehearsal) |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------ | -------------------- |
| `edge`           | nginx: TLS with the Cloudflare Origin CA certificate, routes every host. **The only service with published ports (80, 443).**  | none (read-only filesystem)  | 128 MB       | 6 MB                 |
| `web`            | nginx: the built web app with the security headers and cache rules                                                             | none (read-only filesystem)  | 128 MB       | 5 MB                 |
| `api`            | the HTTP API and Socket.io (`PROCESS_ROLE=api`; queues jobs, runs none)                                                        | none (read-only filesystem)  | 1 GB         | 175 MB               |
| `worker`         | background jobs and the scheduler (`PROCESS_ROLE=worker`; ffmpeg and Tesseract eng/tel/hin)                                    | none (read-only filesystem)  | 1.5 GB       | 180 MB               |
| `mongo`          | MongoDB 8, replica set `rs0` of one, keyfile and authentication, WiredTiger cache 1.5 GB                                       | `mongo-data`, `mongo-config` | 3 GB         | 310 MB               |
| `mongo-init`     | one-shot: starts the replica set, creates the application user (readWrite on `campuslink`) and the backup user (`backup` role) | none                         | none         | exits                |
| `redis`          | queues and rate limits; password, AOF, `noeviction`, 400 MB cap                                                                | `redis-data`                 | 512 MB       | 6 MB                 |
| `qdrant`         | vector index (API key); rebuilt from MongoDB, never backed up                                                                  | `qdrant-data`                | 1 GB         | 28 MB                |
| `clamav`         | scans every upload before it is stored (uploads are refused while it is down); freshclam updates signatures                    | `clamav-data`                | 1.5 GB       | 970 MB               |
| `seaweedfs`      | S3-compatible object store for every file; access keys required, objects encrypted at rest (SSE-S3, `AES256`)                  | `seaweedfs-data`             | 512 MB       | 40 MB                |
| `seaweedfs-init` | one-shot: creates the bucket                                                                                                   | none                         | none         | exits                |
| `ollama`         | free embeddings (`nomic-embed-text`, 768 dimensions) on this server; the model unloads after five idle minutes                 | `ollama-data`                | 1.5 GB       | not measured (¹)     |
| `ollama-init`    | one-shot: downloads the pinned model once                                                                                      | none                         | none         | exits                |

Limits sum to 11.25 GB of 12 GB; measured idle use is about 1.7 GB, so the server keeps several GB
free even with the embedding model loaded. "Idle use" was measured on the local rehearsal (x86, the
same compose file, no members) on 11 Nov 2026; measure again on the server (P12) and update this table.
(¹) The rehearsal network could not download the model (registry.ollama.ai is blocked there).

Named volumes live under Docker's data root, which `provision.sh` puts on the block volume
(`/mnt/data/docker`). The secrets only the databases need are files in `secrets/` (mode 700, created
by `gen-secrets.sh`) and never reach the application containers.

## Files here

| File                               | Purpose                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `compose.yml`                      | the services above                                                                                              |
| `.env.production.example`          | every setting, grouped, each saying where its value comes from; `gen-secrets.sh` turns it into `.env`           |
| `gen-secrets.sh`                   | generates every secret into `.env`, `backup.env` and `secrets/` (mode 600/700); refuses to overwrite            |
| `mongo-init.sh`                    | run by `mongo-init`                                                                                             |
| `provision.sh`                     | prepares a fresh Ubuntu 24.04 arm64 server (user, SSH, swap, Docker, firewall, timers)                          |
| `firewall.sh`, `cloudflare-ips.sh` | 80/443 only from Cloudflare's ranges, SSH only from the owner; the ranges refreshed weekly                      |
| `smoke.sh`                         | the production smoke test (after every deploy)                                                                  |
| `deploy.sh`, `rollback.sh`         | deploy one image tag with automatic rollback; put an earlier tag back                                           |
| `deploy-from-ci.sh`                | the only command the release workflow's SSH key may run                                                         |
| `backup.sh`, `drill.sh`            | nightly encrypted backup to R2; the restore drill                                                               |
| `host-alerts.sh`                   | disk, memory, restarts, certificate and readiness alerts by email                                               |
| `systemd/`                         | timers for the backup (nightly), the drill (monthly), the alerts (5 minutes) and the Cloudflare ranges (weekly) |

## Everyday commands (as the `deploy` user, in `/srv/campuslink/deploy/prod`)

```bash
docker compose ps
```

```bash
docker compose logs --since 1h api worker
```

```bash
docker compose restart api
```

```bash
./smoke.sh
```

```bash
./deploy.sh <commit-sha>
```

```bash
./rollback.sh
```

Restarting one service is safe at any time: `api`, `worker`, `web` and `edge` hold no data;
`mongo`, `redis`, `qdrant`, `clamav` and `seaweedfs` keep theirs in their volumes. While `clamav`
restarts (about two minutes), uploads are refused with a "try again shortly" message.

`docker compose down -v` deletes every volume, which is every member's data. Never run it on the server.

The commands that run inside the API container:

```bash
docker compose exec api node dist/scripts/platform-bootstrap.js --email <email> --name "<name>"
```

```bash
docker compose exec api node dist/scripts/pilot-preset.js --slug <slug> --dry-run
```

```bash
docker compose exec api node dist/scripts/costs-report.js
```

```bash
docker compose exec api node dist/scripts/deploy-check.js
```
