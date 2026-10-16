#!/usr/bin/env bash
# Encrypted, compressed backup of one database: mongodump --archive --gzip | age.
#
# Usage: BACKUP_RECIPIENTS=<age recipients file> scripts/backup/backup.sh [out-dir]
#   BACKUP_DB        database to back up (default campuslink)
#   MONGODUMP_CONFIG mongodump --config file holding the URI with credentials (production)
#   MONGODB_URI      URI without credentials (local development)
#
# The recipients file holds age PUBLIC keys only, so the backup host cannot decrypt what it writes;
# the private key (identity) lives offline with the restore operators (docs/runbook.md).
# Prints the path of the encrypted file; a .sha256 sidecar sits next to it.
set -euo pipefail
umask 077
source "$(dirname "$0")/lib.sh"
need age
DB=${BACKUP_DB:-campuslink}
RECIPIENTS=${BACKUP_RECIPIENTS:?set BACKUP_RECIPIENTS to an age recipients file (public keys)}
OUT_DIR=${1:-./backups}
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT_DIR/$DB-$STAMP.archive.gz.age"
TMP="$FILE.partial"
trap 'rm -f "$TMP"' EXIT

mapfile -t CONN < <(conn_args)
# Read preference secondary keeps the dump off the primary when a secondary exists.
mongo_tool mongodump "${CONN[@]}" --db="$DB" --readPreference=secondaryPreferred --archive --gzip --quiet |
  age --encrypt --recipients-file "$RECIPIENTS" --output "$TMP"
mv "$TMP" "$FILE"
(cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" >"$(basename "$FILE").sha256")
echo "$FILE"
