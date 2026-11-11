#!/usr/bin/env bash
# The nightly backup (prompt 4, P7). Run by systemd/campuslink-backup.timer; by hand: same command.
#
#   deploy/prod/backup.sh
#
# 1. MongoDB: mongodump (as the backup user, which has only the built-in `backup` role) inside the
#    mongo container, compressed, encrypted with age to the owner's PUBLIC key on the way out. The
#    server cannot decrypt what it writes; the private key stays offline with the owner.
# 2. Uploads the archive to Cloudflare R2 (rclone, S3 remote, an API token scoped to one bucket)
#    under db/daily/; on Sundays also db/weekly/, on the 1st also db/monthly/.
# 3. Retention: 7 daily, 4 weekly, 3 monthly archives in R2; 2 local copies.
# 4. Stored files: the object store's bucket is synced to R2 through rclone crypt (names and
#    contents encrypted client-side with keys from backup.env) under files/.
# 5. Writes backup-status.json (time, result, bytes in R2) for costs:report, and emails the owner
#    when the run fails or R2 passes 8 GB (the free tier is 10 GB).
#
# Not backed up, by design: Qdrant (an index rebuilt from MongoDB: Admin › AI › Rebuild the index)
# and Redis (queues and rate limits only). See docs/runbook.md › Single server.
set -euo pipefail
umask 077
source "$(dirname "$0")/lib.sh"
need rclone
need age
BACKUP_ENV=$PROD_DIR/backup.env
[[ -f $BACKUP_ENV ]] || { echo "error: $BACKUP_ENV is missing (gen-secrets.sh creates it)" >&2; exit 2; }
b() { env_value "$1" "$BACKUP_ENV"; }
RECIPIENT=$(b BACKUP_AGE_RECIPIENT)
STATE=${BACKUP_STATE_DIR:-/var/lib/campuslink}
LOCAL=$STATE/backups
STATUS=$STATE/status/backup-status.json
mkdir -p "$LOCAL" "$STATE/status"
started=$(date -u +%FT%TZ)

fail_run() {
  local why=$1
  printf '{"at":"%s","ok":false,"remoteBytes":%s}\n' "$started" "${REMOTE_BYTES:-0}" >"$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
  chmod 644 "$STATUS"
  alert "Backup FAILED" "The nightly backup failed: $why. The previous backups are still in R2. See docs/runbook.md › Single server › Backups."
  exit 1
}
trap 'fail_run "a step exited unexpectedly (line $LINENO)"' ERR

[[ $RECIPIENT =~ ^age1[0-9a-z]{58}$ ]] || fail_run "BACKUP_AGE_RECIPIENT in backup.env is not an age public key"
for k in R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY RCLONE_CRYPT_PASSWORD RCLONE_CRYPT_SALT; do
  [[ -n $(b "$k") ]] || fail_run "$k is not set in backup.env"
done

# rclone takes its remotes from the environment: nothing is written to a config file.
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_ACL=private
RCLONE_CONFIG_R2_ENDPOINT="https://$(b R2_ACCOUNT_ID).r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ENDPOINT
RCLONE_CONFIG_R2_ACCESS_KEY_ID=$(b R2_ACCESS_KEY_ID)
export RCLONE_CONFIG_R2_ACCESS_KEY_ID
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$(b R2_SECRET_ACCESS_KEY)
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
BUCKET=$(b R2_BUCKET)
# The object store on this server, reached through the Docker network's published-nowhere port:
# rclone runs in a throwaway container on the same network (see files_sync below).
export RCLONE_CONFIG_FILESCRYPT_TYPE=crypt
export RCLONE_CONFIG_FILESCRYPT_REMOTE="r2:$BUCKET/files"
RCLONE_CONFIG_FILESCRYPT_PASSWORD=$(rclone obscure "$(b RCLONE_CRYPT_PASSWORD)")
RCLONE_CONFIG_FILESCRYPT_PASSWORD2=$(rclone obscure "$(b RCLONE_CRYPT_SALT)")
export RCLONE_CONFIG_FILESCRYPT_PASSWORD RCLONE_CONFIG_FILESCRYPT_PASSWORD2

# 1. The database, encrypted before it touches the disk.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE=$LOCAL/campuslink-$STAMP.archive.gz.age
DB=$(env_value MONGO_APP_DB)
DB=${DB:-campuslink}
compose exec -T -e MONGO_BACKUP_PASSWORD="$(b MONGO_BACKUP_PASSWORD)" mongo sh -c \
  'mongodump --host=127.0.0.1 --username="'"$(b MONGO_BACKUP_USER)"'" --password="$MONGO_BACKUP_PASSWORD" --authenticationDatabase=admin --db="'"$DB"'" --archive --gzip --quiet' |
  age --encrypt --recipient "$RECIPIENT" --output "$FILE.partial"
[[ -s $FILE.partial ]] || fail_run "mongodump produced nothing"
mv "$FILE.partial" "$FILE"
(cd "$LOCAL" && sha256sum "$(basename "$FILE")" >"$(basename "$FILE").sha256")

# 2. Off site, with the tiers that apply today.
tiers=(daily)
[[ $(date -u +%u) == 7 ]] && tiers+=(weekly)
[[ $(date -u +%d) == 01 ]] && tiers+=(monthly)
for tier in "${tiers[@]}"; do
  rclone copy --quiet "$FILE" "r2:$BUCKET/db/$tier/"
  rclone copy --quiet "$FILE.sha256" "r2:$BUCKET/db/$tier/"
done

# 3. Retention: keep the newest N of each tier (names sort by time).
prune() {
  local tier=$1 keep=$2
  rclone lsf "r2:$BUCKET/db/$tier/" --files-only --include '*.age' | sort | head -n "-$keep" |
    while read -r old; do
      rclone deletefile --quiet "r2:$BUCKET/db/$tier/$old"
      rclone deletefile --quiet "r2:$BUCKET/db/$tier/$old.sha256" 2>/dev/null || true
    done
}
prune daily 7
prune weekly 4
prune monthly 3
ls -1 "$LOCAL"/*.age | sort | head -n -2 | while read -r old; do rm -f "$old" "$old.sha256"; done

# 4. Stored files: the bucket, read with the backup key (read-only), encrypted into R2.
NETWORK=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(compose ps -q seaweedfs)")
docker run --rm --network "$NETWORK" \
  -e RCLONE_CONFIG_LOCALS3_TYPE=s3 -e RCLONE_CONFIG_LOCALS3_PROVIDER=SeaweedFS \
  -e RCLONE_CONFIG_LOCALS3_ENDPOINT=http://seaweedfs:8333 \
  -e RCLONE_CONFIG_LOCALS3_ACCESS_KEY_ID="$(b BACKUP_S3_ACCESS_KEY_ID)" \
  -e RCLONE_CONFIG_LOCALS3_SECRET_ACCESS_KEY="$(b BACKUP_S3_SECRET_ACCESS_KEY)" \
  -e RCLONE_CONFIG_R2_TYPE -e RCLONE_CONFIG_R2_PROVIDER -e RCLONE_CONFIG_R2_ACL -e RCLONE_CONFIG_R2_ENDPOINT \
  -e RCLONE_CONFIG_R2_ACCESS_KEY_ID -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET \
  -e RCLONE_CONFIG_FILESCRYPT_TYPE -e RCLONE_CONFIG_FILESCRYPT_REMOTE \
  -e RCLONE_CONFIG_FILESCRYPT_PASSWORD -e RCLONE_CONFIG_FILESCRYPT_PASSWORD2 \
  "${RCLONE_IMAGE:-mirror.gcr.io/rclone/rclone:1.71}" sync --quiet \
  "locals3:$(env_value S3_BUCKET)" filescrypt:

# 5. Status and the free-tier alert.
REMOTE_BYTES=$(rclone size --json "r2:$BUCKET" | sed -E 's/.*"bytes":([0-9]+).*/\1/')
[[ $REMOTE_BYTES =~ ^[0-9]+$ ]] || REMOTE_BYTES=0
trap - ERR
printf '{"at":"%s","ok":true,"remoteBytes":%s}\n' "$started" "$REMOTE_BYTES" >"$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
chmod 644 "$STATUS"
if ((REMOTE_BYTES > 8 * 1024 * 1024 * 1024)); then
  alert "R2 backup storage above 8 GB" "The off-site backup holds $((REMOTE_BYTES / 1024 / 1024)) MB; R2's free tier is 10 GB. Lower the storage limits (limits.storageMb) or the retention before it passes 10 GB."
fi
echo "Backup done: $(basename "$FILE") ($(du -h "$FILE" | cut -f1)), R2 holds $((REMOTE_BYTES / 1024 / 1024)) MB."
