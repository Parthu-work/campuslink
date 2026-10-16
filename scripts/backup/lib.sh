# Shared helpers for the backup scripts. Sourced, not executed.
# MongoDB tools run from PATH when installed, otherwise inside the compose `mongo` container
# (development). Production hosts install mongodb-database-tools and age.

# Connection: MONGODUMP_CONFIG (a YAML file with `uri:`, mode 600) keeps credentials off the command
# line in production; MONGODB_URI is for local use without a password.
URI=${MONGODB_URI:-mongodb://127.0.0.1:27017/?directConnection=true}
# Tools reject a database in the URI together with --db / --nsInclude, so drop the path.
BASE_URI=$(printf '%s' "$URI" | sed -E 's#^(mongodb(\+srv)?://[^/?]+)/?[^?]*#\1/#')
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

conn_args() {
  if [[ -n ${MONGODUMP_CONFIG:-} ]]; then
    printf '%s\n' "--config=$MONGODUMP_CONFIG"
  else
    printf '%s\n' "--uri=$BASE_URI"
  fi
}

mongo_tool() {
  local tool=$1
  shift
  if command -v "$tool" >/dev/null 2>&1; then
    "$tool" "$@"
  else
    docker compose -f "$REPO_ROOT/docker-compose.yml" exec -T mongo "$tool" "$@"
  fi
}

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: $1 is required" >&2
    exit 2
  }
}
