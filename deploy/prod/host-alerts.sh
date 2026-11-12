#!/usr/bin/env bash
# Host alerts (prompt 4, P8), every five minutes by systemd/campuslink-alerts.timer. Emails the
# owner (ALERT_EMAIL in backup.env, through the SMTP account in .env) when:
#   - a disk is over 80% full;
#   - memory has been over 90% used for 10 minutes (two runs in a row);
#   - a container restarted more than 3 times in the last hour;
#   - the origin certificate expires within 30 days;
#   - the API is not ready (checked from inside the server, so it works even if the edge is down).
# Each alert is sent at most once every 6 hours while the condition lasts (a stamp file per alert).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
STATE=${ALERT_STATE_DIR:-/var/lib/campuslink/alerts}
mkdir -p "$STATE"
raise() {
  local key=$1 subject=$2 body=$3 stamp=$STATE/$1
  if [[ -f $stamp ]] && (($(date +%s) - $(stat -c %Y "$stamp") < 6 * 3600)); then return 0; fi
  touch "$stamp"
  alert "$subject" "$body

What to do: docs/runbook.md › Single server › Alerts ($key)."
}
clear_alert() { rm -f "$STATE/$1"; }

# Disk.
while read -r use mount; do
  pct=${use%\%}
  if ((pct > 80)); then raise "disk-${mount//\//_}" "Disk $mount is $use full" "$(df -h "$mount")"; else clear_alert "disk-${mount//\//_}"; fi
done < <(df -P -x tmpfs -x devtmpfs -x overlay -x squashfs | awk 'NR > 1 { print $5, $6 }')

# Memory: 90% for two runs in a row (10 minutes).
used=$(free | awk '/^Mem:/ { printf "%d", ($2 - $7) * 100 / $2 }')
if ((used > 90)); then
  if [[ -f $STATE/memory-high ]]; then
    raise memory "Memory over 90% for 10 minutes ($used%)" "$(free -h)
$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null)"
  fi
  touch "$STATE/memory-high"
else
  rm -f "$STATE/memory-high"
  clear_alert memory
fi

# Container restarts in the last hour.
restarts=$(docker events --since 1h --until 0s --filter event=restart --format '{{.Actor.Attributes.name}}' 2>/dev/null |
  sort | uniq -c | awk '$1 > 3 { print $2 " (" $1 " restarts)" }')
if [[ -n $restarts ]]; then raise restarts "A container keeps restarting" "$restarts"; else clear_alert restarts; fi

# The origin certificate.
TLS_DIR=$(env_value TLS_DIR)
TLS_DIR=${TLS_DIR:-./tls}
[[ $TLS_DIR == /* ]] || TLS_DIR=$PROD_DIR/${TLS_DIR#./}
if [[ -f $TLS_DIR/fullchain.pem ]] && ! openssl x509 -checkend $((30 * 86400)) -noout -in "$TLS_DIR/fullchain.pem" >/dev/null; then
  raise certificate "The origin certificate expires within 30 days" "$(openssl x509 -enddate -noout -in "$TLS_DIR/fullchain.pem")"
else
  clear_alert certificate
fi

# The API, from inside.
if ! compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  raise api "The API is not ready" "$(compose ps 2>&1)"
else
  clear_alert api
fi
