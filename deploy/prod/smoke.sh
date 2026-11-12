#!/usr/bin/env bash
# Production smoke test (prompt 4, P2), run on the server after every deploy and by hand:
#
#   deploy/prod/smoke.sh [host]        host defaults to admin.<APP_ROOT_DOMAIN> (the platform host)
#
# Through the edge, as a browser would arrive (the request goes to this server's own port 443
# with the real host name; the certificate must be the one in TLS_DIR):
#   1. /api/v1/ready answers 200 with every dependency ready (MongoDB, Redis, ClamAV, storage);
#   2. the web app is served with the security headers and never cached; hashed assets are immutable;
#   3. plain HTTP redirects to HTTPS; an unknown host name gets no certificate; /metrics is a 404;
#   4. a WebSocket handshake on the realtime path is upgraded (101).
# Inside the containers:
#   5. deploy-check: an object is stored ENCRYPTED and read back, ClamAV flags the EICAR test file,
#      a vector is written to and found in Qdrant (in its college only), the embedding model
#      answers with the pinned size, and the application's database user reaches only its database;
#   6. the worker is ready.
# On the host:
#   7. only the edge publishes ports (80 and 443);
#   8. the API and worker logs carry no request headers, client addresses or email addresses.
# Exits non-zero at the first failure. Reads no member data and leaves nothing behind.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
need curl
need openssl
DOMAIN=$(env_value APP_ROOT_DOMAIN)
HOST=${1:-admin.$DOMAIN}
TLS_DIR=$(env_value TLS_DIR)
TLS_DIR=${TLS_DIR:-./tls}
[[ $TLS_DIR == /* ]] || TLS_DIR=$PROD_DIR/${TLS_DIR#./}
PORT=${SMOKE_HTTPS_PORT:-443}
HTTP_PORT=${SMOKE_HTTP_PORT:-80}
# The server's own certificate, pinned by its public key (an Origin CA certificate is trusted by
# Cloudflare, not by curl's CA bundle, so the chain is not what is checked here: the key is).
PIN=$(openssl x509 -in "$TLS_DIR/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform der |
  openssl dgst -sha256 -binary | openssl base64 -A)
req() { curl --noproxy '*' --silent --show-error --max-time 20 -k --pinnedpubkey "sha256//$PIN" --resolve "$HOST:$PORT:127.0.0.1" "$@"; }
base="https://$HOST:$PORT"
step() { printf '%-64s' "$1"; }
ok() { echo "ok"; }
fail() {
  echo "FAILED"
  echo "  $1" >&2
  exit 1
}

step "1. /api/v1/ready (every dependency)"
ready=$(req -w '\n%{http_code}' "$base/api/v1/ready") || fail "the edge did not answer on 443 for $HOST"
[[ ${ready##*$'\n'} == 200 ]] || fail "ready answered ${ready##*$'\n'}: ${ready%$'\n'*}"
grep -q '"ok":true' <<<"$ready" || fail "ready did not report ok: ${ready%$'\n'*}"
if grep -q '":false' <<<"$ready"; then fail "a dependency is not ready: ${ready%$'\n'*}"; fi
ok

step "2. security headers, HTML never cached, assets immutable"
headers=$(req -D - -o /tmp/campuslink-smoke-index.$$ "$base/" | tr -d '\r')
trap 'rm -f /tmp/campuslink-smoke-index.$$' EXIT
for h in 'content-security-policy: default-src' 'strict-transport-security: max-age=63072000' \
  'x-content-type-options: nosniff' 'x-frame-options: DENY' 'referrer-policy:' \
  'cross-origin-opener-policy: same-origin' 'permissions-policy:' 'cache-control: no-cache'; do
  grep -qi "^$h" <<<"$headers" || fail "the web app's response lacks: $h"
done
if grep -qi '^server: nginx/' <<<"$headers"; then fail "the server header shows a version"; fi
asset=$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' /tmp/campuslink-smoke-index.$$ | head -n 1 || true)
[[ -n $asset ]] || fail "index.html names no hashed asset"
req -D - -o /dev/null "$base$asset" | tr -d '\r' | grep -qi '^cache-control: public, max-age=31536000, immutable' ||
  fail "$asset is not served immutable for a year"
ok

step "3. HTTP redirects, unknown names refused, /metrics hidden"
code=$(curl --noproxy '*' --silent --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' --resolve "$HOST:$HTTP_PORT:127.0.0.1" "http://$HOST:$HTTP_PORT/x")
[[ $code == "301 https://$HOST/x" ]] || fail "plain HTTP answered '$code' instead of a redirect to https"
if curl --noproxy '*' --silent --max-time 10 -k -o /dev/null --resolve "not-ours.invalid:$PORT:127.0.0.1" "https://not-ours.invalid:$PORT/" 2>/dev/null; then
  fail "a TLS handshake for an unknown host name was accepted"
fi
[[ $(req -o /dev/null -w '%{http_code}' "$base/api/v1/metrics") == 404 ]] || fail "/api/v1/metrics is reachable through the edge"
ok

step "4. WebSocket handshake (realtime)"
ws=$(req --http1.1 -i -N --max-time 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: https://$HOST" \
  "$base/api/v1/realtime/?EIO=4&transport=websocket" 2>/dev/null | head -n 1 | tr -d '\r' || true)
[[ $ws == 'HTTP/1.1 101 Switching Protocols' ]] || fail "the realtime path answered '${ws:-nothing}' instead of 101"
ok

step "5. storage encrypted, scanner, vectors, embeddings, database user"
if ! out=$(compose exec -T api node dist/scripts/deploy-check.js 2>&1); then
  echo "FAILED"
  echo "$out" >&2
  exit 1
fi
ok
sed 's/^/     /' <<<"$out"

step "6. worker ready"
compose exec -T worker node -e \
  "fetch('http://127.0.0.1:4000/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" ||
  fail "the worker is not ready"
ok

step "7. only the edge publishes ports"
published=$(compose ps --format '{{.Service}} {{.Ports}}' | grep -E '(0\.0\.0\.0|\[::\]|:::)' | grep -v '^edge ' || true)
[[ -z $published ]] || fail "a service other than the edge publishes a port: $published"
edge_ports=$(compose ps --format '{{.Ports}}' edge | grep -oE '(0\.0\.0\.0|\[::\]):[0-9]+' | sed -E 's/.*://' | sort -u | tr '\n' ' ')
[[ $edge_ports == "443 80 " || $edge_ports == "${PORT} ${HTTP_PORT} " || $edge_ports == "${HTTP_PORT} ${PORT} " ]] ||
  fail "the edge publishes '$edge_ports' (expected 80 and 443 only)"
ok

step "8. logs carry no headers, addresses or emails"
logs=$(compose logs --no-log-prefix api worker 2>&1 | tail -n 5000)
if grep -qiE '"(authorization|cookie|x-csrf-token|user-agent|remoteAddress|x-forwarded-for)"' <<<"$logs"; then
  fail "the API or worker log contains request headers or client details"
fi
if grep -qE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' <<<"$logs"; then
  fail "the API or worker log contains an email address"
fi
ok
echo "Smoke test passed for $HOST."
