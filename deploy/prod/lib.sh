# shellcheck shell=bash
# Shared by the scripts in deploy/prod. Sourced, not executed.
PROD_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE=${ENV_FILE:-$PROD_DIR/.env}

compose() { docker compose --project-directory "$PROD_DIR" -f "$PROD_DIR/compose.yml" --env-file "$ENV_FILE" "$@"; }

# env_value KEY [file]: the value of KEY in the env file (no shell evaluation of the file).
env_value() { sed -n "s/^$1=//p" "${2:-$ENV_FILE}" | tail -n 1; }

# set_env KEY VALUE: replaces (or adds) KEY in the env file, keeping its mode.
set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"; fi
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required" >&2; exit 2; }; }

# alert SUBJECT BODY: emails the owner through the SMTP account in .env (ALERT_EMAIL in backup.env),
# using curl only. Never fails the caller; with no address set it prints to stderr (the journal).
alert() {
  local subject=$1 body=$2 to host port user pass from
  to=$(env_value ALERT_EMAIL "$PROD_DIR/backup.env" 2>/dev/null || true)
  echo "ALERT: $subject" >&2
  [[ -n $to ]] || return 0
  host=$(env_value SMTP_HOST) port=$(env_value SMTP_PORT) user=$(env_value SMTP_USER) pass=$(env_value SMTP_PASS)
  from=$(env_value MAIL_FROM | sed -E 's/.*<([^>]+)>.*/\1/')
  [[ -n $host && -n $from ]] || return 0
  # The password goes through a netrc-style config on stdin, never a command line.
  printf 'From: %s\nTo: %s\nSubject: [%s] %s\nDate: %s\n\n%s\n' \
    "$from" "$to" "$(hostname)" "$subject" "$(date -R)" "$body" |
    curl --silent --show-error --max-time 30 --ssl-reqd --url "smtp://$host:${port:-587}" \
      --mail-from "$from" --mail-rcpt "$to" --upload-file - \
      --config <(printf 'user = "%s:%s"\n' "$user" "$pass") >/dev/null 2>&1 || echo "warning: the alert email could not be sent" >&2
  return 0
}
