#!/bin/sh
# Start Gigi local dev environment
#
# Usage:
#   ./dev.sh          Start everything (infra + backend + frontend with HMR)
#   ./dev.sh --fresh  Wipe all state and start fresh (shows onboarding)

set -e

COMPOSE="docker-compose -f docker-compose.local.yml"

if [ "$1" = "--fresh" ]; then
  echo "Wiping all state..."
  $COMPOSE down -v
  echo "Done. Starting fresh..."
fi

# Start infra (AIO: Gitea + Chrome, Postgres)
echo "Starting infra..."
$COMPOSE up -d aio postgres

# Wait for AIO to be healthy (Gitea ready + init complete)
echo "Waiting for Gitea..."
for i in $(seq 1 90); do
  if curl -sf "http://localhost:3300/api/v1/version" > /dev/null 2>&1; then
    echo "Gitea ready."
    break
  fi
  sleep 2
done

# Start dev servers
export DATABASE_URL=postgresql://gigi:gigi@localhost:5432/gigi
export GITEA_URL=http://localhost:3300
export GITEA_PASSWORD=gigi-local-dev
export ADMIN_USER=${ADMIN_USER:-admin}
export WORKSPACE_DIR="${HOME}/work"
export BROWSER_MODE=chrome
export BROWSER_VIEW_URL=/browser/
export CHROME_CDP_URL=http://localhost:9223

# Fetch Gitea token from Postgres (written by AIO init)
echo "Waiting for config..."
for i in $(seq 1 30); do
  GITEA_TOKEN=$(psql "$DATABASE_URL" -t -A -c "SELECT value FROM config WHERE key='gitea_token'" 2>/dev/null || true)
  if [ -n "$GITEA_TOKEN" ]; then
    export GITEA_TOKEN
    echo "Config loaded."
    break
  fi
  sleep 2
done

echo ""
echo "Infra ready. Starting dev servers..."
echo "  Backend: http://localhost:3000"
echo "  Frontend: http://localhost:5173"
echo ""

npm run dev
