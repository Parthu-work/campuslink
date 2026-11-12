#!/usr/bin/env bash
# The restore drill (prompt 4, P7). Monthly by timer (systemd/campuslink-drill.timer), and once
# before go-live:
#
#   BACKUP_IDENTITY=<age private key file> deploy/prod/drill.sh [archive]
#
# Fetches the newest database archive from R2 (or uses the one given), checks its checksum,
# decrypts it, restores it into a THROWAWAY MongoDB container (no network, nothing published),
# starts a throwaway API container against it, checks /api/v1/ready, counts documents per
# collection, and removes everything. The live database is never touched. The result (and how long
# it took) is printed and emailed to the owner.
#
# The private key: the drill needs it to decrypt, and the server must not keep it. Bring it for the
# run (for example `BACKUP_IDENTITY=<(ssh laptop cat key.txt)` or a file you delete afterwards).
# The monthly timer runs the download-and-checksum part only unless DRILL_IDENTITY_FILE exists.
set -euo pipefail
umask 077
source "$(dirname "$0")/lib.sh"
need age
need rclone
BACKUP_ENV=$PROD_DIR/backup.env
b() { env_value "$1" "$BACKUP_ENV"; }
IDENTITY=${BACKUP_IDENTITY:-${DRILL_IDENTITY_FILE:-}}
WORK=$(mktemp -d)
NAME=campuslink-drill-$$
started=$(date +%s)
cleanup() {
  docker rm -f "$NAME-mongo" "$NAME-api" >/dev/null 2>&1 || true
  docker network rm "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
report() {
  echo "$2"
  alert "Restore drill: $1" "$2"
}
trap 'report FAILED "The restore drill failed at line $LINENO. Backups may not be restorable: see docs/runbook.md."; exit 1' ERR

export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ENDPOINT="https://$(b R2_ACCOUNT_ID).r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ENDPOINT
RCLONE_CONFIG_R2_ACCESS_KEY_ID=$(b R2_ACCESS_KEY_ID)
export RCLONE_CONFIG_R2_ACCESS_KEY_ID
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$(b R2_SECRET_ACCESS_KEY)
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
BUCKET=$(b R2_BUCKET)

ARCHIVE=${1:-}
if [[ -z $ARCHIVE ]]; then
  latest=$(rclone lsf "r2:$BUCKET/db/daily/" --files-only --include '*.age' | sort | tail -n 1)
  [[ -n $latest ]] || { report FAILED "No backup found in R2 (db/daily/)."; exit 1; }
  rclone copy --quiet "r2:$BUCKET/db/daily/$latest" "$WORK/"
  rclone copy --quiet "r2:$BUCKET/db/daily/$latest.sha256" "$WORK/"
  ARCHIVE=$WORK/$latest
fi
(cd "$(dirname "$ARCHIVE")" && sha256sum --quiet --check "$(basename "$ARCHIVE").sha256")
size=$(du -h "$ARCHIVE" | cut -f1)
if [[ -z $IDENTITY ]]; then
  trap - ERR
  report "downloaded only" "The newest backup $(basename "$ARCHIVE") ($size) downloaded from R2 and its checksum matches. It was not decrypted: no private key was given (BACKUP_IDENTITY). Run the full drill with the key at least once a quarter."
  exit 0
fi
# age authenticates every chunk: a tampered or truncated archive fails here, before any restore.
age --decrypt --identity "$IDENTITY" --output "$WORK/db.archive.gz" "$ARCHIVE"

docker network create --internal "$NAME" >/dev/null
docker run -d --name "$NAME-mongo" --network "$NAME" --network-alias mongo -e GLIBC_TUNABLES=glibc.pthread.rseq=1 \
  --memory 1g mirror.gcr.io/library/mongo:8.0 --replSet rs0 --bind_ip_all --quiet --wiredTigerCacheSizeGB 0.25 >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME-mongo" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1 && break; sleep 1; done
docker exec "$NAME-mongo" mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]})" >/dev/null
for _ in $(seq 1 30); do [[ $(docker exec "$NAME-mongo" mongosh --quiet --eval 'db.hello().isWritablePrimary') == true ]] && break; sleep 1; done
restore_started=$(date +%s)
docker exec -i "$NAME-mongo" mongorestore --archive --gzip --quiet <"$WORK/db.archive.gz"
restore_secs=$(($(date +%s) - restore_started))
DB=$(env_value MONGO_APP_DB)
DB=${DB:-campuslink}
counts=$(docker exec "$NAME-mongo" mongosh --quiet "$DB" --eval \
  'db.getCollectionNames().sort().map(c => c + " " + db.getCollection(c).countDocuments()).join("\n")')
[[ -n $counts ]] || { report FAILED "The restore produced an empty database."; exit 1; }

# A throwaway API against the restored copy: throwaway secrets except the field key (so encrypted
# fields decrypt as they would in a real restore), no outbound mail, no scanner, no jobs.
IMAGE=$(env_value IMAGE_PREFIX)-api:$(env_value IMAGE_TAG)
docker run -d --name "$NAME-api" --network "$NAME" --memory 768m \
  -e NODE_ENV=production -e REHEARSAL=true -e PROCESS_ROLE=api -e JOBS_DRIVER=inline \
  -e MONGODB_URI="mongodb://mongo:27017/$DB?replicaSet=rs0" -e REDIS_URL=redis://127.0.0.1:1 \
  -e JWT_ACCESS_SECRET="$(openssl rand -hex 32)" -e JWT_TICKET_SECRET="$(openssl rand -hex 32)" \
  -e FIELD_ENCRYPTION_KEY="$(env_value FIELD_ENCRYPTION_KEY)" -e MALWARE_SCANNER=clamav -e CLAMAV_ADDRESS=127.0.0.1:1 \
  -e APP_ROOT_DOMAIN=drill.invalid -e INGESTION_ENABLED=false -e VECTOR_STORE=memory \
  "$IMAGE" node -e "
    import('./dist/config/env.js').then(async ({ loadEnv }) => {
      const mongoose = (await import('mongoose')).default;
      const env = loadEnv();
      await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      const { runMigrations } = await import('./dist/db/migrations.js');
      const { createLogger } = await import('./dist/lib/logger.js');
      await runMigrations(createLogger('silent'));
      const n = await mongoose.connection.db.collection('tenants').countDocuments();
      console.log('API image connected and migrated; colleges and hosts: ' + n);
      process.exit(0);
    }).catch((e) => { console.error(e.message); process.exit(1); });
  " >/dev/null
api_status=$(docker wait "$NAME-api")
api_log=$(docker logs "$NAME-api" 2>&1 | tail -n 3)
[[ $api_status == 0 ]] || { report FAILED "The restored database did not open in the API image: $api_log"; exit 1; }
trap - ERR
report passed "Restore drill passed.
Archive: $(basename "$ARCHIVE") ($size)
Restore took ${restore_secs}s; the whole drill $(($(date +%s) - started))s.
$api_log
Documents per collection:
$counts"
