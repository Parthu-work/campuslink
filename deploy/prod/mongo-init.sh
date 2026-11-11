#!/usr/bin/env bash
# Run by the mongo-init service (deploy/prod/compose.yml) on every `up`; every step is safe to
# repeat. It is the only place the MongoDB root password is used.
#   1. start the replica set rs0 with this one member, if it has none;
#   2. wait for the primary;
#   3. create or update the application user: readWrite on the application database, nothing else;
#   4. create or update the backup user: the built-in `backup` role (mongodump), nothing else.
# Passwords arrive in the environment and are read inside mongosh, never put on a command line.
set -euo pipefail
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
