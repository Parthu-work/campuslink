#!/usr/bin/env bash
# The only command the release workflow's SSH key may run (prompt 4, P6). Pinned in the deploy
# user's authorized_keys:
#
#   command="/srv/campuslink/deploy/prod/deploy-from-ci.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… release
#
# The workflow sends one thing: the commit SHA to deploy. Anything else is refused. The repository
# checkout is brought to that commit first (so compose.yml and the scripts match the images), then
# deploy.sh pulls, replaces, checks and rolls back on failure.
set -euo pipefail
SHA=${SSH_ORIGINAL_COMMAND:-}
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || { echo "refused: expected a 40-character commit SHA" >&2; exit 2; }
cd /srv/campuslink
git fetch --quiet --depth 50 origin main
git cat-file -e "$SHA^{commit}" 2>/dev/null || { echo "refused: $SHA is not on main" >&2; exit 2; }
git merge-base --is-ancestor "$SHA" origin/main || { echo "refused: $SHA is not on main" >&2; exit 2; }
git checkout --quiet --detach "$SHA"
exec /srv/campuslink/deploy/prod/deploy.sh "$SHA"
