#!/usr/bin/env bash
# Puts an earlier image tag back (prompt 4, P6):
#
#   deploy/prod/rollback.sh [tag]      default: the tag that ran before the last deploy
#
# Data migrations are additive (db/migrations.ts), so an older image runs against a database a
# newer one has migrated. Only web, api and worker are replaced; then the smoke test runs.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
TAG=${1:-$(cat "$PROD_DIR/.previous-tag" 2>/dev/null || true)}
[[ -n $TAG ]] || { echo "usage: rollback.sh <tag>   (no previous tag is recorded)" >&2; exit 2; }
[[ $TAG =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "error: '$TAG' is not an image tag" >&2; exit 2; }
echo "Rolling back to $TAG (was: $(env_value IMAGE_TAG))"
set_env IMAGE_TAG "$TAG"
compose pull --quiet web api worker
compose up -d --wait --remove-orphans
"$PROD_DIR/smoke.sh"
echo "Now running $TAG."
