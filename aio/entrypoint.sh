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

  # Symlink custom templates into Gitea's custom path
  TEMPLATE_DIR="/data/gitea/custom/templates"
  if [ -d /app/gitea/custom/templates ] && [ ! -L "$TEMPLATE_DIR" ]; then
    mkdir -p "$(dirname "$TEMPLATE_DIR")"
    rm -rf "$TEMPLATE_DIR"
    ln -sf /app/gitea/custom/templates "$TEMPLATE_DIR"
    echo "[aio] Gitea templates linked"
  fi
  # Clean up legacy wrong-path symlink if it exists
  [ -L "/data/gitea/templates" ] && rm -f "/data/gitea/templates"

  # Symlink custom public assets (logo, favicon)
  PUBLIC_DIR="/data/gitea/custom/public"
  if [ -d /app/gitea/custom/public ] && [ ! -L "$PUBLIC_DIR" ]; then
    mkdir -p "$(dirname "$PUBLIC_DIR")"
    rm -rf "$PUBLIC_DIR"
    ln -sf /app/gitea/custom/public "$PUBLIC_DIR"
    echo "[aio] Gitea public assets linked"
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
  ADMIN_USER="${ADMIN_USER:-admin}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
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

  # Add SSH keys from Docker secrets
  for keyfile in /run/secrets/*_ssh_pubkey; do
    if [ -f "$keyfile" ]; then
      KEY_TITLE=$(basename "$keyfile" _ssh_pubkey)
      KEY_CONTENT=$(cat "$keyfile" | tr -d '\n')
      echo "[aio] Adding SSH key: $KEY_TITLE"
      # Add to admin user
      curl -s -X POST "http://localhost:3300/api/v1/admin/users/${ADMIN_USER}/keys" \
        -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"${KEY_TITLE}\",\"key\":\"${KEY_CONTENT}\"}" > /dev/null 2>&1 || true
      # Also add to gigi user
      curl -s -X POST "http://localhost:3300/api/v1/admin/users/gigi/keys" \
        -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"${KEY_TITLE}\",\"key\":\"${KEY_CONTENT}\"}" > /dev/null 2>&1 || true
    fi
  done

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

  # Write tokens to shared files (for runner auto-registration)
  mkdir -p /data/runner
  echo "$ADMIN_TOKEN" > /data/runner/admin-token
  echo "$GIGI_TOKEN" > /data/runner/gigi-token
  chown -R gigi:gigi /data/runner

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

  # Create default repositories
  INIT_REPOS="${INIT_REPOS:-gigi gigi-infra}"
  for repo in $INIT_REPOS; do
    echo "[aio] Creating repo: ${ORG_NAME}/${repo}"
    curl -s -X POST "http://localhost:3300/api/v1/orgs/${ORG_NAME}/repos" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d "{\"name\":\"${repo}\",\"private\":false,\"auto_init\":false}" > /dev/null 2>&1 || true
  done

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

  # Create org-level Actions secrets for CI workflows
  echo "[aio] Creating Actions secrets..."

  create_secret() {
    local name="$1" value="$2"
    # Gitea API expects raw value in "data" field — use jq to safely encode
    local payload
    payload=$(printf '%s' "$value" | jq -Rs '{data: .}')
    curl -s -X PUT "http://localhost:3300/api/v1/orgs/${ORG_NAME}/actions/secrets/${name}" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d "$payload" > /dev/null 2>&1 || true
  }

  # SSH key for deployments (from Docker secret)
  for keyfile in /run/secrets/*_ssh_key; do
    if [ -f "$keyfile" ]; then
      create_secret "SSH_PRIVATE_KEY" "$(cat "$keyfile")"
      echo "[aio] Set SSH_PRIVATE_KEY secret"
      break
    fi
  done

  # SSH known hosts (scan the deploy target)
  KNOWN_HOSTS=$(ssh-keyscan -H ${DEPLOY_HOST:-localhost} 2>/dev/null || true)
  if [ -n "$KNOWN_HOSTS" ]; then
    create_secret "SSH_KNOWN_HOSTS" "$KNOWN_HOSTS"
    echo "[aio] Set SSH_KNOWN_HOSTS secret"
  fi

  # Registry token (admin token doubles as registry auth)
  create_secret "REGISTRY_TOKEN" "$ADMIN_TOKEN"
  echo "[aio] Set REGISTRY_TOKEN secret"

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
      "webhook_secret|${WEBHOOK_SECRET}" \
      "gitea_org|${ORG_NAME}"; do
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

  # Reconfigure for production: subpath + SSH
  GITEA_CONF="/data/gitea/conf/app.ini"
  INSTANCE_URL="${GIGI_INSTANCE_URL:-http://localhost:3000}"
  sed -i "s|ROOT_URL = http://localhost:3300/|ROOT_URL = ${INSTANCE_URL}/gitea/|" "$GITEA_CONF"
  sed -i 's/START_SSH_SERVER = false/START_SSH_SERVER = true/' "$GITEA_CONF"
  if ! grep -q "SSH_PORT" "$GITEA_CONF"; then
    DOMAIN=$(echo "$INSTANCE_URL" | sed 's|^https\?://||; s|/.*||; s|:.*||')
    sed -i "/START_SSH_SERVER/a SSH_PORT = 2222\nSSH_LISTEN_PORT = 2222\nSSH_DOMAIN = ${DOMAIN}\nBUILTIN_SSH_SERVER_USER = git" "$GITEA_CONF"
  fi

  touch "$MARKER"
  echo "[aio] Init complete"
elif [ "$ENABLE_GITEA" = "true" ]; then
  # Not first boot but internal Gitea — ensure templates are linked
  TEMPLATE_DIR="/data/gitea/custom/templates"
  if [ -d /app/gitea/custom/templates ] && [ ! -L "$TEMPLATE_DIR" ]; then
    mkdir -p "$(dirname "$TEMPLATE_DIR")"
    rm -rf "$TEMPLATE_DIR"
    ln -sf /app/gitea/custom/templates "$TEMPLATE_DIR"
  fi
  # Clean up legacy wrong-path symlink if it exists
  [ -L "/data/gitea/templates" ] && rm -f "/data/gitea/templates"

  # Ensure custom public assets are linked (logo, favicon)
  PUBLIC_DIR="/data/gitea/custom/public"
  if [ -d /app/gitea/custom/public ] && [ ! -L "$PUBLIC_DIR" ]; then
    mkdir -p "$(dirname "$PUBLIC_DIR")"
    rm -rf "$PUBLIC_DIR"
    ln -sf /app/gitea/custom/public "$PUBLIC_DIR"
  fi
fi

# ── 4. Fix permissions & stale locks ───────────────────────────────────

# Workspace bind mount comes in as root — ensure gigi can write to top level
# (don't recurse — workspace may contain large cloned repos with node_modules)
if [ -d /workspace ]; then
  chown gigi:gigi /workspace
fi

# Chrome profile lock from previous container prevents startup (exit 21)
rm -f /data/chrome-profile/SingletonLock /data/chrome-profile/SingletonCookie /data/chrome-profile/SingletonSocket

# ── 5. Build runner-worker image if Docker socket available ────────────

if [ -S /var/run/docker.sock ] && [ -f /opt/runner-worker/Dockerfile ]; then
  if ! docker image inspect gigi/runner-worker:latest > /dev/null 2>&1; then
    echo "[aio] Building runner-worker image..."
    docker build -t gigi/runner-worker:latest /opt/runner-worker/ 2>&1 || echo "[aio] runner-worker build failed (non-fatal)"
  fi
fi

# ── 6. Inject env vars into supervisord gigi program ──────────────────
# supervisord doesn't inherit parent env for child processes.
# Write a wrapper script that sources all env vars before starting gigi.

cat > /app/start-gigi.sh << 'WRAPPER_EOF'
#!/bin/bash
# Source env vars written by entrypoint
[ -f /app/.env.sh ] && source /app/.env.sh
# Increase UV thread pool for concurrent TLS handshakes (MCP tool token counting on ARM64)
export UV_THREADPOOL_SIZE=${UV_THREADPOOL_SIZE:-64}
exec node --import tsx src/index.ts
WRAPPER_EOF
chmod +x /app/start-gigi.sh

# Dump all relevant env vars for the gigi process
{
  env | grep -E '^(DATABASE_URL|GITEA_|CHROME_|BROWSER_|BACKUP_|PORT|GIGI_|WORKSPACE_|ADMIN_|ORG_|TELEGRAM_|CLAUDE_|NODE_|UV_THREADPOOL_SIZE)=' | while IFS='=' read -r key value; do
    printf 'export %s=%q\n' "$key" "$value"
  done
} > /app/.env.sh

# Update supervisord to use wrapper instead of direct node command
sed -i "/\[program:gigi\]/,/^\[/{s|command=node --import tsx src/index.ts|command=/app/start-gigi.sh|}" "$SUPERVISORD_CONF"

# ── 7. Start supervisord ─────────────────────────────────────────────

echo "[aio] Starting supervisord..."
exec /usr/bin/supervisord -c "$SUPERVISORD_CONF"
