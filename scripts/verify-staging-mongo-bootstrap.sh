#!/usr/bin/env bash
# Creates an isolated Compose project with brand-new named volumes, verifies
# the first-start Mongo bootstrap, replica set, app users, migrations and all
# service health checks. It never touches the production Compose project.
set -euo pipefail

: "${STAGING_COMPOSE_PROJECT_NAME:?Set a unique staging project name, e.g. ebadgeid_staging_20260827}"
if [[ ! "$STAGING_COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{2,60}$ ]]; then
  echo 'STAGING_COMPOSE_PROJECT_NAME may only contain lowercase letters, digits, _ and -.' >&2
  exit 2
fi
if [[ ! -f .env ]]; then
  echo 'Missing root .env. Copy .env.example, use real staging secrets/HTTPS URLs, then run preflight first.' >&2
  exit 2
fi
if [[ ! -f "backend (updated)/.env" ]]; then
  echo 'Missing backend (updated)/.env. Copy backend (updated)/.env.example, use real staging secrets, then run preflight first.' >&2
  exit 2
fi

# preflight-production.js checks secrets that live in both env files (the
# PUBLIC_*/AUTH_COOKIE_DOMAIN group in root .env, JWT_SECRET/ENCRYPTION_SECRET/
# ALLOWED_ORIGINS/etc in the backend's own .env) -- both must be loaded into
# this shell for the check run here to see the same configuration the
# containers themselves will actually use.
set -a
source ./.env
source "./backend (updated)/.env"
set +a
node scripts/preflight-production.js

export COMPOSE_PROJECT_NAME="$STAGING_COMPOSE_PROJECT_NAME"
echo "Starting isolated staging project: $COMPOSE_PROJECT_NAME"
docker compose up -d --build

deadline=$((SECONDS + 300))
while (( SECONDS < deadline )); do
  mongo_state="$(docker compose ps --format json mongo 2>/dev/null || true)"
  api_state="$(docker compose ps --format json api 2>/dev/null || true)"
  storage_state="$(docker compose ps --format json storage 2>/dev/null || true)"
  help_state="$(docker compose ps --format json help-api 2>/dev/null || true)"
  if [[ "$mongo_state" == *'healthy'* && "$api_state" == *'healthy'* && "$storage_state" == *'healthy'* && "$help_state" == *'healthy'* ]]; then
    break
  fi
  sleep 5
done

docker compose ps
docker compose exec -T mongo mongosh --quiet \
  "mongodb://root:${MONGO_ROOT_PASSWORD}@localhost:27017/admin?authSource=admin" \
  --eval "const rsOk=rs.status().ok===1; const app=db.getSiblingDB('ebadgeid').getUser('ebadgeid_app'); const help=db.getSiblingDB('ebadgeid_helpdesk').getUser('ebadgeid_helpdesk_app'); if (!rsOk || !app || !help) throw new Error('replica set or application users missing'); printjson({replicaSet:'ok', appUser:app.user, helpdeskUser:help.user});"
docker compose exec -T mongo mongosh --quiet \
  "mongodb://ebadgeid_app:${MONGO_APP_PASSWORD}@localhost:27017/ebadgeid?authSource=ebadgeid" \
  --eval "printjson({mainMigrations: db.schema_migrations.countDocuments(), storedFilesCollection: db.getCollectionNames().includes('stored_files')});"
docker compose exec -T mongo mongosh --quiet \
  "mongodb://ebadgeid_helpdesk_app:${MONGO_HELPDESK_APP_PASSWORD}@localhost:27017/ebadgeid_helpdesk?authSource=ebadgeid_helpdesk" \
  --eval "printjson({helpdeskMigrations: db.schema_migrations.countDocuments(), userIndexes: db.users.getIndexes().map(i=>i.name)});"
echo 'Staging bootstrap validation passed. Keep this isolated project for smoke tests; remove it explicitly only when approved.'
