#!/usr/bin/env bash
# Deploys one image tag on this server (prompt 4, P6). The release workflow runs it over SSH; it is
# also the way to deploy by hand:
#
#   deploy/prod/deploy.sh <tag>        a commit SHA built by .github/workflows/release.yml, or main
#
# Pulls the tag's images, replaces the application containers, waits until they are ready and runs
# the smoke test. If anything fails, it puts the previous tag back (rollback.sh) and exits non-zero.
# The databases keep running: only web, api and worker are replaced.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
TAG=${1:?usage: deploy.sh <tag>}
[[ $TAG =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "error: '$TAG' is not an image tag" >&2; exit 2; }
PREVIOUS=$(env_value IMAGE_TAG)
echo "Deploying $TAG (now running: ${PREVIOUS:-nothing})"
set_env IMAGE_TAG "$TAG"
if compose pull --quiet web api worker && compose up -d --wait --remove-orphans && "$PROD_DIR/smoke.sh"; then
  printf '%s\n' "$PREVIOUS" >"$PROD_DIR/.previous-tag"
  docker image prune -f >/dev/null
  echo "Deployed $TAG."
  exit 0
fi
echo "The deploy of $TAG failed." >&2
if [[ -n $PREVIOUS && $PREVIOUS != "$TAG" ]]; then
  echo "Rolling back to $PREVIOUS." >&2
  "$PROD_DIR/rollback.sh" "$PREVIOUS" || alert "Deploy and rollback both failed" "Deploy of $TAG failed and the rollback to $PREVIOUS failed too. The site may be down: see docs/runbook.md."
else
  set_env IMAGE_TAG "$PREVIOUS"
fi
alert "Deploy of $TAG failed" "The deploy of $TAG failed its checks; the previous version ($PREVIOUS) is back. See the release workflow's log."
exit 1
