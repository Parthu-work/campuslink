#!/usr/bin/env bash
# Backup and restore drill: back up a database with a throwaway key, restore it into a drill
# database, compare document and index counts for every collection, time each step, drop the drill
# database. Exits non-zero on any mismatch. Run monthly (docs/runbook.md) and record the result.
#
# Usage: scripts/backup/drill.sh [db]   (default campuslink; seed it first with `pnpm seed`)
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need age
need age-keygen
DB=${1:-campuslink}
DRILL=${DB}_drill
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
age-keygen --output "$WORK/identity.txt" 2>/dev/null
age-keygen -y "$WORK/identity.txt" >"$WORK/recipients.txt"

counts() {
  mongo_tool mongosh --quiet "$BASE_URI" --eval "
    const d = db.getSiblingDB('$1');
    const out = {};
    for (const c of d.getCollectionNames().sort()) {
      out[c] = { docs: d.getCollection(c).countDocuments({}), indexes: d.getCollection(c).getIndexes().length };
    }
    print(JSON.stringify(out));"
}
now() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }

t0=$(now)
FILE=$(BACKUP_DB=$DB BACKUP_RECIPIENTS="$WORK/recipients.txt" "$(dirname "$0")/backup.sh" "$WORK")
t1=$(now)
BACKUP_DB=$DB BACKUP_IDENTITY="$WORK/identity.txt" "$(dirname "$0")/restore.sh" "$FILE" "$DRILL" >/dev/null
t2=$(now)
BEFORE=$(counts "$DB")
AFTER=$(counts "$DRILL")
mongo_tool mongosh --quiet "$BASE_URI" --eval "db.getSiblingDB('$DRILL').dropDatabase()" >/dev/null

node -e '
const [before, after, size, backup, restore] = process.argv.slice(1);
const b = JSON.parse(before), a = JSON.parse(after);
const names = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
let bad = 0, docs = 0;
for (const n of names) {
  const ok = JSON.stringify(b[n]) === JSON.stringify(a[n]);
  if (!ok) { bad++; console.error(`MISMATCH ${n}: source ${JSON.stringify(b[n])} restored ${JSON.stringify(a[n])}`); }
  docs += b[n]?.docs ?? 0;
}
console.log(`collections ${names.length}, documents ${docs}, mismatches ${bad}`);
console.log(`encrypted size ${(Number(size) / 1024).toFixed(0)} KiB, backup ${backup}s, restore ${restore}s`);
process.exit(bad ? 1 : 0);
' "$BEFORE" "$AFTER" "$(stat -c %s "$FILE")" "$(secs "$t0" "$t1")" "$(secs "$t1" "$t2")"
