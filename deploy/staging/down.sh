#!/usr/bin/env bash
# Stops staging and deletes its data volumes. Keeps .staging/ (secrets, certificate) unless --purge.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STATE=${STAGING_STATE_DIR:-$ROOT/.staging}
docker compose --env-file "$STATE/env" -f "$HERE/compose.yml" down -v
if [[ ${1:-} == "--purge" ]]; then rm -rf "$STATE"; fi
