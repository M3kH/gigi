#!/bin/bash
set -e

MARKER="/data/.aio-init-done"
SUPERVISORD_CONF="/etc/supervisor/conf.d/gigi-aio.conf"
LOG_DIR="/var/log/gigi"

mkdir -p "$LOG_DIR" /data/gitea/conf /data/workspace /data/chrome-profile
chown -R gigi:gigi /data

# ── 1. Determine which services to start ──────────────────────────────

ENABLE_GITEA=true
ENABLE_CHROME=true

if [ -n "$GITEA_URL" ]; then
  echo "[aio] GITEA_URL set ($GITEA_URL) — skipping internal Gitea"
  ENABLE_GITEA=false
else
  export GITEA_URL="http://localhost:3300"
  echo "[aio] Starting internal Gitea at $GITEA_URL"
fi

if [ -n "$CHROME_CDP_URL" ]; then
  echo "[aio] CHROME_CDP_URL set ($CHROME_CDP_URL) — skipping internal Chrome"
  ENABLE_CHROME=false
else
  export CHROME_CDP_URL="http://localhost:9223"
  export BROWSER_MODE="${BROWSER_MODE:-chrome}"
  export BROWSER_VIEW_URL="${BROWSER_VIEW_URL:-/browser/}"
  echo "[aio] Starting internal Chrome, CDP at $CHROME_CDP_URL"
fi

# ── 2. Enable supervisord programs ────────────────────────────────────

enable_program() {
  # Replace autostart=false with autostart=true for the named program section
  sed -i "/\[program:$1\]/,/^\[/{s/autostart=false/autostart=true/}" "$SUPERVISORD_CONF"
}

# Copy base config (don't modify the original)
cp /etc/supervisor/conf.d/gigi-aio.conf.template "$SUPERVISORD_CONF"

# Always enable Gigi
enable_program gigi

if [ "$ENABLE_GITEA" = "true" ]; then
  enable_program gitea
fi

if [ "$ENABLE_CHROME" = "true" ]; then
  enable_program xvfb
  enable_program chromium
  enable_program x11vnc
  enable_program websockify
  enable_program cdp-relay
fi

# ── 3. Gitea first-boot init ─────────────────────────────────────────

if [ "$ENABLE_GITEA" = "true" ] && [ ! -f "$MARKER" ]; then
  echo "[aio] First boot — initializing Gitea..."

  # Ensure Gitea app.ini exists with minimal config
  GITEA_CONF="/data/gitea/conf/app.ini"
  if [ ! -f "$GITEA_CONF" ]; then
    mkdir -p /data/gitea/conf
    cat > "$GITEA_CONF" << 'EOINI'
[server]
HTTP_PORT = 3300
ROOT_URL = http://localhost:3300/
START_SSH_SERVER = false
SSH_DISABLE_AUTHORIZED_KEYS_DB = true

[database]
DB_TYPE = sqlite3
PATH = /data/gitea/gitea.db

[security]
INSTALL_LOCK = true

[service]
DISABLE_REGISTRATION = true
ENABLE_REVERSE_PROXY_AUTHENTICATION = true
ENABLE_REVERSE_PROXY_AUTO_REGISTRATION = false

[ui]
DEFAULT_THEME = gitea-dark

[webhook]
ALLOWED_HOST_LIST = *
EOINI
  fi

  # Ensure gigi owns everything in /data (root created files above)
  chown -R gigi:gigi /data

  # Symlink custom templates
  TEMPLATE_DIR="/data/gitea/templates"
  if [ -d /app/gitea/custom/templates ] && [ ! -L "$TEMPLATE_DIR" ]; then
    mkdir -p "$(dirname "$TEMPLATE_DIR")"
    rm -rf "$TEMPLATE_DIR"
    ln -sf /app/gitea/custom/templates "$TEMPLATE_DIR"
    echo "[aio] Gitea templates linked"
  fi

  # Start Gitea temporarily for init
  echo "[aio] Starting Gitea for init..."
  su -s /bin/sh gigi -c "GITEA_WORK_DIR=/data/gitea /usr/local/bin/gitea web --config $GITEA_CONF" &
  GITEA_PID=$!

  # Wait for Gitea API
  echo "[aio] Waiting for Gitea API..."
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:3300/api/v1/version" > /dev/null 2>&1; then
      echo "[aio] Gitea API ready"
      break
    fi
    sleep 1
  done

  # Create admin user
  ADMIN_USER="${ADMIN_USER:-mauro}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-mauro@localhost}"
  ORG_NAME="${ORG_NAME:-idea}"
  GIGI_PASSWORD="gigi-local-dev"

  echo "[aio] Creating admin user: $ADMIN_USER"
  su -s /bin/sh gigi -c "GITEA_WORK_DIR=/data/gitea /usr/local/bin/gitea admin user create \
    --config $GITEA_CONF \
    --username $ADMIN_USER \
    --password $ADMIN_PASSWORD \
    --email $ADMIN_EMAIL \
    --admin \
    --must-change-password=false" 2>&1 || echo "(may already exist)"

  echo "[aio] Creating gigi user"
  su -s /bin/sh gigi -c "GITEA_WORK_DIR=/data/gitea /usr/local/bin/gitea admin user create \
    --config $GITEA_CONF \
    --username gigi \
    --password $GIGI_PASSWORD \
    --email gigi@localhost \
    --must-change-password=false" 2>&1 || echo "(may already exist)"

  # Create API tokens
  TOKEN_SUFFIX=$(date +%s)

  ADMIN_TOKEN_RESP=$(curl -s -X POST "http://localhost:3300/api/v1/users/${ADMIN_USER}/tokens" \
    -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"aio-init-${TOKEN_SUFFIX}\",\"scopes\":[\"all\"]}")
  ADMIN_TOKEN=$(echo "$ADMIN_TOKEN_RESP" | grep -oP '"sha1":"\K[^"]+' || echo "$ADMIN_TOKEN_RESP" | grep -oP '"token":"\K[^"]+' || true)
  AUTH="Authorization: token $ADMIN_TOKEN"

  GIGI_TOKEN_RESP=$(curl -s -X POST "http://localhost:3300/api/v1/users/gigi/tokens" \
    -u "gigi:${GIGI_PASSWORD}" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"gigi-aio-${TOKEN_SUFFIX}\",\"scopes\":[\"all\"]}")
  GIGI_TOKEN=$(echo "$GIGI_TOKEN_RESP" | grep -oP '"sha1":"\K[^"]+' || echo "$GIGI_TOKEN_RESP" | grep -oP '"token":"\K[^"]+' || true)

  # Create org
  echo "[aio] Creating org: $ORG_NAME"
  curl -s -X POST "http://localhost:3300/api/v1/orgs" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"username\":\"${ORG_NAME}\",\"visibility\":\"public\"}" > /dev/null 2>&1 || true

  # Add gigi to org owners
  OWNERS_TEAM_ID=$(curl -s "http://localhost:3300/api/v1/orgs/${ORG_NAME}/teams" \
    -H "$AUTH" | grep -oP '"id":\K[0-9]+' | head -1)
  if [ -n "$OWNERS_TEAM_ID" ]; then
    curl -s -X PUT "http://localhost:3300/api/v1/teams/${OWNERS_TEAM_ID}/members/gigi" \
      -H "$AUTH" > /dev/null 2>&1 || true
  fi

  # Register webhook
  WEBHOOK_SECRET=$(openssl rand -hex 16)
  curl -s -X POST "http://localhost:3300/api/v1/admin/hooks" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "{
      \"type\": \"gitea\",
      \"active\": true,
      \"config\": {\"url\": \"http://localhost:3000/webhook/gitea\", \"content_type\": \"json\", \"secret\": \"${WEBHOOK_SECRET}\"},
      \"events\": [\"create\", \"delete\", \"push\", \"issues\", \"issue_comment\", \"pull_request\", \"pull_request_review\", \"repository\"],
      \"branch_filter\": \"*\"
    }" > /dev/null 2>&1 || true

  # Write config to Postgres
  if [ -n "$DATABASE_URL" ]; then
    echo "[aio] Writing config to Postgres..."
    psql "$DATABASE_URL" -c "
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY, value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      );" 2>/dev/null || true

    for kv in \
      "gitea_url|http://localhost:3300" \
      "gitea_token|${GIGI_TOKEN}" \
      "gitea_password|${GIGI_PASSWORD}" \
      "admin_user|${ADMIN_USER}" \
      "webhook_secret|${WEBHOOK_SECRET}"; do
      k="${kv%%|*}"; v="${kv#*|}"
      psql "$DATABASE_URL" -c "INSERT INTO config (key,value) VALUES ('$k','$v') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();" 2>/dev/null || true
    done

    [ -n "$TELEGRAM_TOKEN" ] && psql "$DATABASE_URL" -c "INSERT INTO config (key,value) VALUES ('telegram_token','$TELEGRAM_TOKEN') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();" 2>/dev/null || true
    [ -n "$CLAUDE_TOKEN" ] && psql "$DATABASE_URL" -c "INSERT INTO config (key,value) VALUES ('claude_oauth_token','$CLAUDE_TOKEN') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();" 2>/dev/null || true
  fi

  # Stop temporary Gitea (supervisord will restart it)
  kill -TERM $GITEA_PID 2>/dev/null || true
  wait $GITEA_PID 2>/dev/null || true
  sleep 2
  # Clean up LevelDB locks left by init Gitea (prevents queue lock errors)
  rm -f /data/gitea/data/queues/common/LOCK

  touch "$MARKER"
  echo "[aio] Init complete"
elif [ "$ENABLE_GITEA" = "true" ]; then
  # Not first boot but internal Gitea — ensure templates are linked
  TEMPLATE_DIR="/data/gitea/templates"
  if [ -d /app/gitea/custom/templates ] && [ ! -L "$TEMPLATE_DIR" ]; then
    rm -rf "$TEMPLATE_DIR"
    ln -sf /app/gitea/custom/templates "$TEMPLATE_DIR"
  fi
fi

# ── 4. Build runner-worker image if Docker socket available ───────────

if [ -S /var/run/docker.sock ] && [ -f /opt/runner-worker/Dockerfile ]; then
  if ! docker image inspect gigi/runner-worker:latest > /dev/null 2>&1; then
    echo "[aio] Building runner-worker image..."
    docker build -t gigi/runner-worker:latest /opt/runner-worker/ 2>&1 || echo "[aio] runner-worker build failed (non-fatal)"
  fi
fi

# ── 5. Export env vars for supervisord child processes ────────────────

export GITEA_URL CHROME_CDP_URL BROWSER_MODE BROWSER_VIEW_URL

# ── 6. Start supervisord ─────────────────────────────────────────────

echo "[aio] Starting supervisord..."
exec /usr/bin/supervisord -c "$SUPERVISORD_CONF"
