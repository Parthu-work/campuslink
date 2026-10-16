#!/usr/bin/env bash
# Restores an encrypted backup into a SEPARATE database (default <source>_restore), never over the
# live one: verify there, then switch or copy back deliberately (docs/runbook.md).
#
# Usage: BACKUP_IDENTITY=<age identity file> scripts/backup/restore.sh <file.archive.gz.age> [target-db]
#   BACKUP_DB  the database the backup was taken from (default: from the file name)
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need age
FILE=${1:?usage: restore.sh <file.archive.gz.age> [target-db]}
IDENTITY=${BACKUP_IDENTITY:?set BACKUP_IDENTITY to the age identity (private key) file}
SRC=${BACKUP_DB:-$(basename "$FILE" | sed -E 's/-[0-9]{8}T[0-9]{6}Z\.archive\.gz\.age$//')}
TARGET=${2:-${SRC}_restore}
if [[ $TARGET == "$SRC" ]]; then
  echo "error: refusing to restore over the source database ($SRC); pick another target" >&2
  exit 2
fi
if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha256sum --quiet --check "$(basename "$FILE").sha256")
else
  echo "warning: no checksum file next to $FILE; age still authenticates the content" >&2
fi
mapfile -t CONN < <(conn_args)
# Decrypt completely first: age authenticates every chunk, so a tampered or truncated file fails
# here and nothing is restored (streaming would restore the chunks before the bad one).
umask 077
PLAIN=$(mktemp "${TMPDIR:-/tmp}/campuslink-restore.XXXXXX")
trap 'rm -f "$PLAIN"' EXIT
age --decrypt --identity "$IDENTITY" --output "$PLAIN" "$FILE"
mongo_tool mongorestore "${CONN[@]}" --archive --gzip --drop --quiet \
  --nsInclude="$SRC.*" --nsFrom="$SRC.*" --nsTo="$TARGET.*" <"$PLAIN"
echo "restored $SRC → $TARGET"
