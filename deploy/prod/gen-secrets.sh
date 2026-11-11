#!/usr/bin/env bash
# Generates every secret a fresh production deployment needs (prompt 4, P9).
#
# Usage: deploy/prod/gen-secrets.sh --domain <root-domain> [--dir <deploy/prod directory>]
#
# Writes, next to compose.yml:
#   .env                         the one settings file (mode 600), from .env.production.example with
#                                the generated values and the domain filled in: JWT secrets, the
#                                field encryption key, the WhatsApp action secret, the metrics
#                                token, the VAPID key pair, and the application's own credentials
#                                for MongoDB, Redis, Qdrant and the object store;
#   secrets/ (mode 700)          what only the databases need, never given to the application:
#     mongo-root-password, mongo-backup-password, mongo-keyfile,
#     seaweedfs-s3.json (the access keys the store accepts), seaweedfs-kek (encryption at rest);
#   backup.env                   the backup job's own settings (mode 600): the MongoDB backup user,
#                                a read-only object-store key and the rclone crypt passwords. The
#                                owner adds the R2 bucket, its scoped token and the age public key.
#
# It refuses to overwrite: if .env, backup.env or secrets/ exists, nothing is written. Values are
# never printed. Keep a copy of .env, secrets/ and backup.env in a password manager: without the
# field encryption key and the rclone crypt passwords, backups cannot be read.
set -euo pipefail
umask 077
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=$HERE
DOMAIN=
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN=${2:?--domain needs a value}; shift 2 ;;
    --dir) DIR=${2:?--dir needs a value}; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
if [[ ! $DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "usage: gen-secrets.sh --domain <root-domain>   (for example campuslink.example)" >&2
  exit 2
fi
command -v openssl >/dev/null || { echo "error: openssl is required" >&2; exit 2; }
mkdir -p "$DIR"
for existing in "$DIR/.env" "$DIR/backup.env" "$DIR/secrets"; do
  if [[ -e $existing ]]; then
    echo "error: $existing already exists; refusing to overwrite secrets (move it away deliberately first)" >&2
    exit 1
  fi
done
EXAMPLE=$HERE/.env.production.example
[[ -f $EXAMPLE ]] || { echo "error: $EXAMPLE is missing" >&2; exit 2; }

hex() { openssl rand -hex "$1"; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# VAPID (web push): a P-256 key pair, the private scalar and the uncompressed public point, base64url.
vapid_pem=$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null)
VAPID_PRIVATE=$(openssl ec -outform DER 2>/dev/null <<<"$vapid_pem" | tail -c +8 | head -c 32 | b64url)
VAPID_PUBLIC=$(openssl ec -pubout -outform DER 2>/dev/null <<<"$vapid_pem" | tail -c 65 | b64url)
unset vapid_pem

MONGO_APP_PASSWORD=$(hex 24)
REDIS_PASSWORD=$(hex 24)
S3_ACCESS_KEY_ID=campuslink$(hex 6)
S3_SECRET_ACCESS_KEY=$(hex 24)
BACKUP_S3_ACCESS_KEY_ID=backup$(hex 6)
BACKUP_S3_SECRET_ACCESS_KEY=$(hex 24)

# set KEY VALUE: replaces the `KEY=` line of the env file being built (values are hex or base64url,
# so no character needs escaping; `|` never appears in them).
ENV_TMP=$(mktemp "$DIR/.env.XXXXXX")
trap 'rm -f "$ENV_TMP"' EXIT
cp "$EXAMPLE" "$ENV_TMP"
set_value() {
  grep -q "^$1=" "$ENV_TMP" || { echo "error: $1 is not in .env.production.example" >&2; exit 2; }
  sed -i "s|^$1=.*|$1=$2|" "$ENV_TMP"
}
set_value APP_ROOT_DOMAIN "$DOMAIN"
set_value WEB_ORIGIN "https://$DOMAIN"
set_value CORS_ALLOWED_ORIGINS "https://*.$DOMAIN"
set_value VAPID_SUBJECT "mailto:admin@$DOMAIN"
set_value MAIL_FROM "CampusLink <no-reply@$DOMAIN>"
set_value JWT_ACCESS_SECRET "$(hex 32)"
set_value JWT_TICKET_SECRET "$(hex 32)"
set_value FIELD_ENCRYPTION_KEY "$(openssl rand -base64 32)"
set_value WHATSAPP_ACTION_SECRET "$(hex 32)"
set_value METRICS_TOKEN "$(hex 32)"
set_value VAPID_PUBLIC_KEY "$VAPID_PUBLIC"
set_value VAPID_PRIVATE_KEY "$VAPID_PRIVATE"
set_value MONGO_APP_PASSWORD "$MONGO_APP_PASSWORD"
set_value MONGODB_URI "mongodb://campuslink_app:$MONGO_APP_PASSWORD@mongo:27017/campuslink?replicaSet=rs0\&authSource=admin"
set_value REDIS_PASSWORD "$REDIS_PASSWORD"
set_value REDIS_URL "redis://:$REDIS_PASSWORD@redis:6379"
set_value QDRANT_API_KEY "$(hex 32)"
set_value S3_ACCESS_KEY_ID "$S3_ACCESS_KEY_ID"
set_value S3_SECRET_ACCESS_KEY "$S3_SECRET_ACCESS_KEY"

mkdir -m 700 "$DIR/secrets"
hex 32 >"$DIR/secrets/mongo-root-password"
MONGO_BACKUP_PASSWORD=$(hex 24)
printf '%s\n' "$MONGO_BACKUP_PASSWORD" >"$DIR/secrets/mongo-backup-password"
# The replica set keyfile: 756 base64 characters, as MongoDB documents.
openssl rand -base64 756 >"$DIR/secrets/mongo-keyfile"
# Encryption at rest for objects written with SSE-S3 (256-bit key, hex).
hex 32 >"$DIR/secrets/seaweedfs-kek"
# The object store accepts only these keys: the application's (read, write, list in its bucket)
# and the backup job's (read and list only).
cat >"$DIR/secrets/seaweedfs-s3.json" <<JSON
{
  "identities": [
    {
      "name": "campuslink-app",
      "credentials": [{ "accessKey": "$S3_ACCESS_KEY_ID", "secretKey": "$S3_SECRET_ACCESS_KEY" }],
      "actions": ["Read:campuslink-files", "Write:campuslink-files", "List:campuslink-files"]
    },
    {
      "name": "campuslink-backup",
      "credentials": [{ "accessKey": "$BACKUP_S3_ACCESS_KEY_ID", "secretKey": "$BACKUP_S3_SECRET_ACCESS_KEY" }],
      "actions": ["Read:campuslink-files", "List:campuslink-files"]
    }
  ]
}
JSON
# The containers read these files as their own users (mongodb, the seaweedfs process), so they are
# world-readable INSIDE a directory only the deploy user can enter.
chmod 644 "$DIR"/secrets/*

cat >"$DIR/backup.env" <<ENV
# The nightly backup's settings (deploy/prod/backup.sh). Mode 600; never given to a container.
# generated:
MONGO_BACKUP_USER=campuslink_backup
MONGO_BACKUP_PASSWORD=$MONGO_BACKUP_PASSWORD
BACKUP_S3_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY_ID
BACKUP_S3_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_ACCESS_KEY
# rclone crypt for the copy of stored files (file names and contents are encrypted before upload).
# Keep both in the password manager: the off-site copy of the files cannot be read without them.
RCLONE_CRYPT_PASSWORD=$(hex 32)
RCLONE_CRYPT_SALT=$(hex 32)
# owner: the age PUBLIC key database backups are encrypted to (age-keygen on your own computer;
# the private key never comes to this server).
BACKUP_AGE_RECIPIENT=
# owner: Cloudflare R2 (a bucket and an API token scoped to that bucket, Object Read & Write).
R2_ACCOUNT_ID=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
# owner: where failure alerts go (uses the SMTP settings in .env).
ALERT_EMAIL=
ENV
chmod 600 "$DIR/backup.env"
mv "$ENV_TMP" "$DIR/.env"
chmod 600 "$DIR/.env"
trap - EXIT
echo "Wrote $DIR/.env, $DIR/backup.env and $DIR/secrets/ (no value was printed)."
echo "Next: fill in the settings marked 'owner' in .env and backup.env, then: docker compose up -d"
