#!/bin/sh
set -e

# Gigi local dev bootstrap script
# Runs inside the init container (gitea/gitea:latest + postgresql-client)

MARKER="/data/local-init-done"
GITEA_URL="${GITEA_URL:-http://gitea:3000}"
ADMIN_USER="${ADMIN_USER:-mauro}"
ADMIN_EMAIL="${ADMIN_EMAIL:-mauro@localhost}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
ORG_NAME="${ORG_NAME:-idea}"
GITEA_CONFIG="/data/gitea/conf/app.ini"
GIGI_PASSWORD="gigi-local-dev"

# --- Idempotency check ---
if [ -f "$MARKER" ]; then
  echo "Init already completed (marker exists). Skipping."
  exit 0
fi

echo "=== Gigi local-init starting ==="

# Wait for Gitea API to be fully ready
echo "Waiting for Gitea API..."
for i in $(seq 1 30); do
  if curl -sf "${GITEA_URL}/api/v1/version" > /dev/null 2>&1; then
    echo "Gitea API ready."
    break
  fi
  sleep 1
done

TOKEN_SUFFIX=$(date +%s)

# --- 1. Create users via CLI (avoids API issues) ---
echo "Creating admin user: ${ADMIN_USER}"
su-exec git gitea admin user create \
  --config "$GITEA_CONFIG" \
  --username "$ADMIN_USER" \
  --password "$ADMIN_PASSWORD" \
  --email "$ADMIN_EMAIL" \
  --admin \
  --must-change-password=false 2>&1 || echo "(may already exist)"

echo "Creating gigi user..."
su-exec git gitea admin user create \
  --config "$GITEA_CONFIG" \
  --username "gigi" \
  --password "$GIGI_PASSWORD" \
  --email "gigi@localhost" \
  --must-change-password=false 2>&1 || echo "(may already exist)"

# --- 2. Create API tokens via basic auth ---
echo "Creating admin API token..."
ADMIN_TOKEN_RESP=$(curl -s -X POST "${GITEA_URL}/api/v1/users/${ADMIN_USER}/tokens" \
  -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"local-init-${TOKEN_SUFFIX}\",\"scopes\":[\"all\"]}")
ADMIN_TOKEN=$(echo "$ADMIN_TOKEN_RESP" | sed -n 's/.*"sha1":"\([^"]*\)".*/\1/p')
if [ -z "$ADMIN_TOKEN" ]; then
  ADMIN_TOKEN=$(echo "$ADMIN_TOKEN_RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi
if [ -z "$ADMIN_TOKEN" ]; then
  echo "ERROR: Failed to create admin token: $ADMIN_TOKEN_RESP"
  exit 1
fi
echo "  Admin token OK."
AUTH_HEADER="Authorization: token $ADMIN_TOKEN"

echo "Creating gigi API token..."
GIGI_TOKEN_RESP=$(curl -s -X POST "${GITEA_URL}/api/v1/users/gigi/tokens" \
  -u "gigi:${GIGI_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"gigi-local-${TOKEN_SUFFIX}\",\"scopes\":[\"all\"]}")
GIGI_TOKEN=$(echo "$GIGI_TOKEN_RESP" | sed -n 's/.*"sha1":"\([^"]*\)".*/\1/p')
if [ -z "$GIGI_TOKEN" ]; then
  GIGI_TOKEN=$(echo "$GIGI_TOKEN_RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi
if [ -z "$GIGI_TOKEN" ]; then
  echo "ERROR: Failed to create gigi token: $GIGI_TOKEN_RESP"
  exit 1
fi
echo "  Gigi token OK."

# --- 3. Create organization ---
echo "Creating organization: ${ORG_NAME}"
curl -s -X POST "${GITEA_URL}/api/v1/orgs" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ORG_NAME}\",\"visibility\":\"public\"}" > /dev/null 2>&1 || true

# Add gigi to org owners team
OWNERS_TEAM_ID=$(curl -s "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/teams" \
  -H "$AUTH_HEADER" | sed -n 's/.*"id":\([0-9]*\).*"name":"Owners".*/\1/p')
if [ -n "$OWNERS_TEAM_ID" ]; then
  curl -s -X PUT "${GITEA_URL}/api/v1/teams/${OWNERS_TEAM_ID}/members/gigi" \
    -H "$AUTH_HEADER" > /dev/null 2>&1 || true
  echo "  Added gigi to Owners team."
fi

# --- 4. Generate SSH keypair ---
echo "Generating SSH keypair for gigi..."
SSH_KEY_DIR="/tmp/gigi-ssh"
mkdir -p "$SSH_KEY_DIR"
ssh-keygen -t ed25519 -f "${SSH_KEY_DIR}/id_ed25519" -N "" -q
SSH_PUBKEY=$(cat "${SSH_KEY_DIR}/id_ed25519.pub")
curl -s -X POST "${GITEA_URL}/api/v1/admin/users/gigi/keys" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"${SSH_PUBKEY}\",\"title\":\"gigi-local-dev\",\"read_only\":false}" > /dev/null 2>&1 || true

# --- 5. Import repositories ---
if [ -d "/repositories" ] && [ "$(ls -A /repositories 2>/dev/null)" ]; then
  echo "Importing repositories from /repositories/..."

  for repo_path in /repositories/*/; do
    repo_name=$(basename "$repo_path")

    if [ -f "${repo_path}HEAD" ]; then
      repo_type="bare"
    elif [ -d "${repo_path}.git" ]; then
      repo_type="working"
    else
      echo "  Skipping ${repo_name} (not a git repo)"
      continue
    fi

    echo "  Importing ${repo_name} (${repo_type})..."

    curl -s -X POST "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/repos" \
      -H "$AUTH_HEADER" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"${repo_name}\",\"auto_init\":false}" > /dev/null 2>&1 || true

    PUSH_URL="${GITEA_URL#http://}"
    PUSH_URL="${PUSH_URL#https://}"
    REMOTE_URL="http://${ADMIN_USER}:${ADMIN_PASSWORD}@${PUSH_URL}/${ORG_NAME}/${repo_name}.git"

    TEMP_DIR="/tmp/import-${repo_name}"
    rm -rf "$TEMP_DIR"

    if [ "$repo_type" = "bare" ]; then
      git clone --bare "$repo_path" "$TEMP_DIR" 2>/dev/null
      cd "$TEMP_DIR"
      git push --mirror "$REMOTE_URL" 2>/dev/null || echo "    Push failed for ${repo_name}"
      cd /
    else
      git clone "$repo_path" "$TEMP_DIR" 2>/dev/null
      cd "$TEMP_DIR"
      git remote add gitea "$REMOTE_URL" 2>/dev/null || git remote set-url gitea "$REMOTE_URL"
      git push gitea --all 2>/dev/null || echo "    Push failed for ${repo_name}"
      git push gitea --tags 2>/dev/null || true
      cd /
    fi

    rm -rf "$TEMP_DIR"
    echo "    Done: ${repo_name}"
  done
else
  echo "No repositories to import (mount a directory to /repositories/)."
fi

# --- 6. Write config to Gigi's Postgres ---
echo "Writing config to Gigi's Postgres..."

psql -c "
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
"

psql -c "INSERT INTO config (key, value) VALUES ('gitea_url', '${GITEA_URL}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"
psql -c "INSERT INTO config (key, value) VALUES ('gitea_token', '${GIGI_TOKEN}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"

if [ -n "$TELEGRAM_TOKEN" ]; then
  echo "Setting Telegram token..."
  psql -c "INSERT INTO config (key, value) VALUES ('telegram_token', '${TELEGRAM_TOKEN}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"
fi

if [ -n "$CLAUDE_TOKEN" ]; then
  echo "Setting Claude OAuth token..."
  psql -c "INSERT INTO config (key, value) VALUES ('claude_oauth_token', '${CLAUDE_TOKEN}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"
fi

# --- 7. Write marker ---
touch "$MARKER"
echo ""
echo "=== Gigi local-init complete ==="
echo "  Admin: ${ADMIN_USER} / ${ADMIN_PASSWORD}"
echo "  Org: ${ORG_NAME}"
echo "  Gitea: http://localhost:3000"
echo "  Gigi: http://localhost:3100"
echo ""
