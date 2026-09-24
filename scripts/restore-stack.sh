#!/usr/bin/env bash
set -euo pipefail

# Recovery is intentionally explicit: it refuses to overwrite anything
# unless RESTORE_CONFIRM is exactly RESTORE_EBADGEID. Restore only into an
# isolated/staging stack first and validate application health afterward.
: "${BACKUP_PATH:?Set BACKUP_PATH to an existing backup directory}"
: "${MONGO_ROOT_PASSWORD:?Set MONGO_ROOT_PASSWORD in the environment}"
if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_EBADGEID" ]]; then
  echo 'Refusing restore. Set RESTORE_CONFIRM=RESTORE_EBADGEID after validating the target.' >&2
  exit 2
fi
test -f "$BACKUP_PATH/mongodb.archive.gz"

# MED-02 fix (audit finding, confirmed real): backup-stack.sh already
# writes a SHA256SUMS file alongside every backup it creates, but this
# script never checked it before restoring -- a corrupted or tampered
# archive would have been fed straight into `mongorestore --drop` with no
# integrity check at all. Verified here, before touching the database,
# using the same shasum tooling backup-stack.sh used to generate it.
if [[ -f "$BACKUP_PATH/SHA256SUMS" ]]; then
  (cd "$BACKUP_PATH" && sha256sum -c SHA256SUMS) || {
    echo 'Refusing restore: SHA256SUMS verification failed -- this backup archive is corrupted or was tampered with.' >&2
    exit 3
  }
else
  echo "Refusing restore: no SHA256SUMS file found in $BACKUP_PATH -- cannot verify this backup's integrity before restoring." >&2
  exit 3
fi

docker compose exec -T mongo mongorestore --drop \
  --uri "mongodb://root:${MONGO_ROOT_PASSWORD}@localhost:27017/admin?authSource=admin" \
  --archive --gzip < "$BACKUP_PATH/mongodb.archive.gz"
printf '%s\n' 'MongoDB restore complete. Restore named volumes only into a stopped, isolated target and run the smoke-test checklist.'
