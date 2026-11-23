#!/usr/bin/env bash
# Run by the mongo-init service (deploy/prod/compose.yml) on every `up`; every step is safe to
# repeat. It is the only place the MongoDB root password is used.
#   1. start the replica set rs0 with this one member, if it has none;
#   2. wait for the primary;
#   3. create or update the application user: readWrite on the application database, nothing else;
#   4. create or update the backup user: the built-in `backup` role (mongodump), nothing else.
# Passwords arrive in the environment and are read inside mongosh, never put on a command line.
set -euo pipefail
# On the very first start the mongo image runs a temporary server on 127.0.0.1 only while it creates
# the root user, and its health check (run inside that container) already passes then; connecting
# over the network in that window is refused and the first `up` failed here (rehearsal, 23 Nov 2026).
# So wait until the real server answers over the network; a ping needs no credentials.
for ((i = 1; ; i++)); do
  mongosh --quiet --host mongo --port 27017 --norc --eval 'db.adminCommand({ ping: 1 }).ok' >/dev/null 2>&1 && break
  if ((i >= 90)); then
    echo "error: MongoDB did not answer on mongo:27017 within 3 minutes" >&2
    exit 1
  fi
  sleep 2
done
ROOT_PASSWORD=$(cat /run/secrets/mongo_root_password)
MONGO_BACKUP_PASSWORD=$(cat /run/secrets/mongo_backup_password)
export ROOT_PASSWORD MONGO_BACKUP_PASSWORD
exec mongosh --quiet --host mongo --port 27017 --norc --eval '
  const env = process.env;
  const admin = db.getSiblingDB("admin");
  admin.auth("root", env.ROOT_PASSWORD);
  let status;
  try {
    status = rs.status();
  } catch (e) {
    if (e.codeName !== "NotYetInitialized") throw e;
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
  }
  for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i++) sleep(1000);
  if (!db.hello().isWritablePrimary) throw new Error("the replica set has no primary");
  const upsert = (name, pwd, roles) => {
    if (admin.getUser(name)) admin.updateUser(name, { pwd, roles });
    else admin.createUser({ user: name, pwd, roles });
  };
  upsert(env.MONGO_APP_USER, env.MONGO_APP_PASSWORD, [{ role: "readWrite", db: env.MONGO_APP_DB }]);
  upsert(env.MONGO_BACKUP_USER, env.MONGO_BACKUP_PASSWORD, [{ role: "backup", db: "admin" }]);
  print("replica set rs0 has a primary; application and backup users are in place");
'
