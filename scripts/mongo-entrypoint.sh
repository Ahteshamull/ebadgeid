#!/bin/sh
# Keep the official Mongo entrypoint in control so MONGO_INITDB_* and the
# idempotent user-bootstrap script run on a genuinely empty data volume.
set -eu

source_keyfile=/run/secrets/mongo-keyfile
runtime_keyfile=/data/db/keyfile

if [ ! -r "$source_keyfile" ]; then
  echo "Mongo keyfile is missing or unreadable" >&2
  exit 1
fi

if [ ! -s "$runtime_keyfile" ]; then
  cp "$source_keyfile" "$runtime_keyfile"
fi
chmod 400 "$runtime_keyfile"
chown mongodb:mongodb "$runtime_keyfile"

exec /usr/local/bin/docker-entrypoint.sh mongod \
  --replSet rs0 --bind_ip_all --auth --keyFile "$runtime_keyfile"
