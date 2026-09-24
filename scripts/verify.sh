#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for project in "backend (updated)" help_backend frontend helpdesk_frontend contract; do
  echo "Testing $project"
  (cd "$ROOT/$project" && npm test)
done
for project in frontend helpdesk_frontend contract; do
  echo "Building $project"
  (cd "$ROOT/$project" && npm run build)
done
echo "All tests and builds completed."
