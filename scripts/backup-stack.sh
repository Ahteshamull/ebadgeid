#!/usr/bin/env bash
set -euo pipefail

# Creates a consistent, portable backup archive. BACKUP_DIR must be outside
# the repository and should point to encrypted object storage or an encrypted
# disk mounted by the operator. No credentials are printed.
: "${BACKUP_DIR:?Set BACKUP_DIR to an encrypted backup destination}"
: "${MONGO_ROOT_PASSWORD:?Set MONGO_ROOT_PASSWORD in the environment}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR%/}/ebadgeid-${stamp}"
project="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}" 
uploads_volume="${UPLOADS_VOLUME:-${project}_uploads_data}"
private_contracts_volume="${PRIVATE_CONTRACTS_VOLUME:-${project}_private_contracts_data}"
mkdir -p "$target"

docker compose exec -T mongo mongodump \
  --uri "mongodb://root:${MONGO_ROOT_PASSWORD}@localhost:27017/admin?authSource=admin" \
  --archive --gzip > "$target/mongodb.archive.gz"
docker run --rm -v "$(docker volume inspect -f '{{ .Mountpoint }}' "$uploads_volume"):/source:ro" -v "$target:/backup" alpine \
  tar -czf /backup/uploads.tar.gz -C /source .
docker run --rm -v "$(docker volume inspect -f '{{ .Mountpoint }}' "$private_contracts_volume"):/source:ro" -v "$target:/backup" alpine \
  tar -czf /backup/private-contracts.tar.gz -C /source .
sha256sum "$target"/* > "$target/SHA256SUMS"
printf 'Backup created at %s\n' "$target"
