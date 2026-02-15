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

# Start infra (gitea, postgres, init)
echo "Starting infra..."
$COMPOSE up -d gitea postgres neko
$COMPOSE up --wait init 2>/dev/null || $COMPOSE up -d --force-recreate init && $COMPOSE wait init 2>/dev/null || true

# Start dev servers
export DATABASE_URL=postgresql://gigi:gigi@localhost:5432/gigi
export GITEA_URL=http://localhost:3300
export GITEA_PASSWORD=gigi-local-dev
export ADMIN_USER=${ADMIN_USER:-mauro}
export WORKSPACE_DIR="${HOME}/work"
export BROWSER_MODE=neko
export NEKO_HOST=localhost
export NEKO_PORT=8080
export NEKO_PASSWORD=neko
export NEKO_PASSWORD_ADMIN=admin
export NEKO_PUBLIC_URL=/neko/
export CHROME_CDP_URL=http://localhost:9223

echo ""
echo "Infra ready. Starting dev servers..."
echo "  Backend: http://localhost:3000"
echo "  Frontend: http://localhost:5173"
echo ""

npm run dev
