#!/usr/bin/env bash
# Staging rehearsal: start the production images in production mode with every production adapter.
#
# Usage: deploy/staging/up.sh [--build]
#   --build  build campuslink-api:staging and campuslink-web:staging from deploy/*.Dockerfile first
#   API_IMAGE / WEB_IMAGE  use other image tags instead
#
# Secrets and the self-signed TLS certificate are generated once into .staging/ (gitignored, mode
# 700) and never leave this machine. Data is DEMO seed data only.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STATE=${STAGING_STATE_DIR:-$ROOT/.staging}
umask 077
mkdir -p "$STATE/tls"

if [[ ! -f $STATE/env ]]; then
  {
    echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
    echo "JWT_TICKET_SECRET=$(openssl rand -hex 32)"
    echo "FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)"
    echo "S3_SSE_KEK=$(openssl rand -hex 32)"
    echo "STAGING_CERT_DIR=$STATE/tls"
  } >"$STATE/env"
fi
if [[ ! -f $STATE/tls/fullchain.pem ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:*.localhost" \
    -keyout "$STATE/tls/privkey.pem" -out "$STATE/tls/fullchain.pem" 2>/dev/null
fi

if [[ ${1:-} == "--build" ]]; then
  docker build -f "$ROOT/deploy/api.Dockerfile" -t "${API_IMAGE:-campuslink-api:staging}" "$ROOT"
  docker build -f "$ROOT/deploy/web.Dockerfile" -t "${WEB_IMAGE:-campuslink-web:staging}" "$ROOT"
fi

compose() { docker compose --env-file "$STATE/env" -f "$HERE/compose.yml" "$@"; }

# 1. Backing services first: the API's readiness includes the bucket, so it must exist.
compose up -d --wait mongo redis clamav s3 mailpit
out=$(compose exec -T s3 sh -c "echo 's3.bucket.create -name campuslink-files' | weed shell" 2>&1) || true
if grep -qi 'error' <<<"$out" && ! grep -q 'already exists' <<<"$out"; then
  echo "$out" >&2
  exit 1
fi

# 2. DEMO data (the seed refuses NODE_ENV=production, so it runs from the host). It needs only the
# field encryption key, so list emails decrypt in the API.
FIELD_KEY=$(sed -n 's/^FIELD_ENCRYPTION_KEY=//p' "$STATE/env")
(cd "$ROOT" && MONGODB_URI='mongodb://127.0.0.1:27018/campuslink?directConnection=true' \
  FIELD_ENCRYPTION_KEY="$FIELD_KEY" NODE_ENV=development pnpm --silent --filter @campuslink/api seed >/dev/null)

# 3. The application.
compose up -d --wait api web edge
echo "Staging is up: https://dpit.localhost:8443 (self-signed certificate). Smoke test: deploy/staging/smoke.sh"
