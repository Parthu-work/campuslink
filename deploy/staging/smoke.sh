#!/usr/bin/env bash
# Staging smoke test (deploy/staging/up.sh first): readiness of every dependency, production
# headers, sign-in under the production CSP, a photo upload through ClamAV into S3 and back, the
# service worker, study material processed by the worker, and the API and worker logs carrying no
# headers or personal data.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STATE=${STAGING_STATE_DIR:-$ROOT/.staging}
# Trust exactly the staging certificate (by its public-key hash) in the test browser.
STAGING_CERT_SPKI=$(openssl x509 -in "$STATE/tls/fullchain.pem" -pubkey -noout |
  openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)
export STAGING_CERT_SPKI
(cd "$ROOT/apps/web" && pnpm exec playwright test -c playwright.staging.config.ts)
logs=$(docker compose --env-file "$STATE/env" -f "$HERE/compose.yml" logs api worker 2>&1)
if grep -qiE '"(authorization|cookie|x-csrf-token|user-agent|remoteAddress)"' <<<"$logs"; then
  echo "FAIL: the API or worker log contains request headers or client details" >&2
  exit 1
fi
if grep -qE '@(dpit|mrce)\.example' <<<"$logs"; then
  echo "FAIL: the API or worker log contains an email address" >&2
  exit 1
fi
echo "Staging smoke test passed."
