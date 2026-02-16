# Gigi AIO Image Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `gigi:aio` Docker image that bundles Gigi + Gitea + Chrome/noVNC into one self-bootstrapping container.

**Architecture:** Multi-stage Dockerfile builds the Node app, downloads the Gitea binary, then combines everything in a Debian base with Chromium, Xvfb, noVNC, nginx, and supervisord. An entrypoint conditionally starts services based on env vars and runs a one-time init on first boot. The existing lean `Dockerfile` stays unchanged.

**Tech Stack:** Docker multi-stage, supervisord, Gitea 1.24 binary, Chromium/Xvfb/noVNC, nginx (CDP relay), shell scripts

---

### Task 1: Move runner-worker Dockerfile into gigi repo

**Files:**
- Create: `runner-worker/Dockerfile`
- Delete (later, from gigi-infra): `runner/worker-image/Dockerfile`

**Step 1: Create the file**

Create `runner-worker/Dockerfile` with the same content as `gigi-infra/runner/worker-image/Dockerfile`:

```dockerfile
FROM docker.gitea.com/runner-images:ubuntu-latest

ENV YQ_VERSION=v4.49.2

RUN apt-get update && apt-get install -y --no-install-recommends rsync \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture) \
    && wget -qO /usr/local/bin/yq \
       "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${ARCH}" \
    && chmod +x /usr/local/bin/yq
```

**Step 2: Verify**

Run: `docker build --no-cache -t test-runner-worker runner-worker/`
Expected: Builds successfully.

**Step 3: Commit**

```bash
git add runner-worker/Dockerfile
git commit -m "feat: move runner-worker Dockerfile into gigi repo"
```

---

### Task 2: Create the AIO supervisord config

**Files:**
- Create: `aio/supervisord.conf`

**Step 1: Create the supervisord config**

This config manages all processes. Each program has `autostart=false` — the entrypoint will selectively enable them.

Create `aio/supervisord.conf`:

```ini
[supervisord]
nodaemon=true
logfile=/var/log/gigi/supervisord.log
pidfile=/var/run/supervisord.pid

; ── Gitea (conditional — skipped if GITEA_URL is external) ────────────
[program:gitea]
command=/usr/local/bin/gitea web --config /data/gitea/conf/app.ini
user=gigi
autostart=false
autorestart=true
priority=100
stdout_logfile=/var/log/gigi/gitea.log
redirect_stderr=true
environment=GITEA_WORK_DIR="/data/gitea",HOME="/home/gigi",USER="gigi"

; ── Chrome stack (conditional — skipped if CHROME_CDP_URL is external) ─
[program:xvfb]
command=Xvfb :99 -screen 0 1920x1080x24 -ac
autostart=false
autorestart=true
priority=200

[program:chromium]
command=chromium --no-sandbox --disable-gpu --disable-dev-shm-usage
  --no-first-run --start-maximized --force-dark-mode
  --window-size=1920,1080 --window-position=0,0
  --display=:99
  --remote-debugging-port=9222
  --remote-allow-origins=*
  --user-data-dir=/data/chrome-profile
environment=DISPLAY=":99"
autostart=false
autorestart=true
priority=300
stdout_logfile=/var/log/gigi/chromium.log
redirect_stderr=true

[program:x11vnc]
command=x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -xkb
autostart=false
autorestart=true
priority=400
stdout_logfile=/var/log/gigi/x11vnc.log
redirect_stderr=true

[program:websockify]
command=websockify --web=/usr/share/novnc 6080 localhost:5900
autostart=false
autorestart=true
priority=500
stdout_logfile=/var/log/gigi/websockify.log
redirect_stderr=true

[program:cdp-relay]
command=nginx -g "daemon off;"
autostart=false
autorestart=true
priority=600
user=root
stdout_logfile=/var/log/gigi/nginx-cdp.log
redirect_stderr=true

; ── Gigi (always starts) ──────────────────────────────────────────────
[program:gigi]
command=node --import tsx src/index.ts
directory=/app
user=gigi
autostart=false
autorestart=true
priority=900
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
environment=HOME="/home/gigi"
```

**Step 2: Commit**

```bash
git add aio/supervisord.conf
git commit -m "feat: add AIO supervisord config"
```

---

### Task 3: Create the AIO entrypoint

**Files:**
- Create: `aio/entrypoint.sh`

**Step 1: Create the entrypoint**

This script:
1. Detects which services to run (env var checks)
2. Enables the appropriate supervisord programs
3. Runs Gitea init on first boot (if internal)
4. Builds runner-worker image if Docker socket available and image missing
5. Starts supervisord

Create `aio/entrypoint.sh`:

```bash
#!/bin/bash
set -e

MARKER="/data/.aio-init-done"
SUPERVISORD_CONF="/etc/supervisor/conf.d/gigi-aio.conf"
LOG_DIR="/var/log/gigi"

mkdir -p "$LOG_DIR" /data/gitea /data/workspace /data/chrome-profile

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
  sed -i "s/\(\[program:$1\]\)/\1\nautostart=true/" "$SUPERVISORD_CONF"
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
ROOT_URL = %(PROTOCOL)s://%(DOMAIN)s:%(HTTP_PORT)s/
SSH_DOMAIN = localhost
SSH_PORT = 2222
SSH_LISTEN_PORT = 2222
START_SSH_SERVER = true
BUILTIN_SSH_SERVER_USER = git

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
  ORG_NAME="${ORG_NAME:-gigi}"
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
  WEBHOOK_SECRET=$(head -c 32 /dev/urandom | xxd -p | head -c 32)
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
  kill $GITEA_PID 2>/dev/null || true
  wait $GITEA_PID 2>/dev/null || true

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
```

**Step 2: Make it executable**

Run: `chmod +x aio/entrypoint.sh`

**Step 3: Commit**

```bash
git add aio/entrypoint.sh
git commit -m "feat: add AIO entrypoint with conditional services and init"
```

---

### Task 4: Create the nginx CDP relay config

**Files:**
- Create: `aio/cdp-proxy.conf`

**Step 1: Create the config**

This is the same as `chrome/cdp-proxy.conf` — it relays CDP WebSocket connections through nginx so the Host header is correct.

Create `aio/cdp-proxy.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 9223;

    # JSON metadata — rewrite WS URLs so clients connect back through this proxy
    location /json {
        proxy_pass http://127.0.0.1:9222;
        proxy_http_version 1.1;
        proxy_set_header Host $proxy_host;
        proxy_set_header Accept-Encoding "";

        sub_filter '127.0.0.1:9222' 'localhost:9223';
        sub_filter_types *;
        sub_filter_once off;
    }

    # WebSocket + everything else
    location / {
        proxy_pass http://127.0.0.1:9222;
        proxy_http_version 1.1;
        proxy_set_header Host $proxy_host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

**Step 2: Commit**

```bash
git add aio/cdp-proxy.conf
git commit -m "feat: add CDP relay nginx config for AIO"
```

---

### Task 5: Create Dockerfile.aio

**Files:**
- Create: `Dockerfile.aio`

**Step 1: Create the multi-stage Dockerfile**

Create `Dockerfile.aio`:

```dockerfile
# ── Stage 1: Build the Node app (reuses existing Dockerfile logic) ────
FROM node:20-slim AS app-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src/ src/
COPY lib/ lib/
COPY web/ web/
COPY mcp-config.json ./

# Build: type-check + Vite SPA
RUN npx tsc --noEmit && npx vite build --config vite.config.ts

# Prune to production deps + tsx for TS runtime
RUN npm prune --omit=dev 2>/dev/null; npm install tsx

# ── Stage 2: Download Gitea binary ────────────────────────────────────
FROM debian:bookworm-slim AS gitea-downloader

ARG GITEA_VERSION=1.24.0
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture) \
    && wget -qO /usr/local/bin/gitea \
       "https://dl.gitea.com/gitea/${GITEA_VERSION}/gitea-${GITEA_VERSION}-linux-${ARCH}" \
    && chmod +x /usr/local/bin/gitea

# ── Stage 3: Final AIO image ─────────────────────────────────────────
FROM debian:bookworm-slim

# System packages: Node.js, Chrome, display, VNC, supervisor, nginx, tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Node.js runtime
    curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    # Chrome + display
    chromium xvfb x11vnc novnc websockify \
    # Networking & tools
    nginx supervisor git ssh postgresql-client \
    # Chrome dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libatspi2.0-0 libgtk-3-0 \
    # Docker CLI (for runner-worker image build)
    docker.io \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash \
    || npm install -g @anthropic-ai/claude-code

# Create gigi user
RUN useradd -m -s /bin/bash gigi \
    && mkdir -p /data/gitea /data/workspace /data/chrome-profile /var/log/gigi /opt/runner-worker \
    && chown -R gigi:gigi /data /var/log/gigi

# Gitea binary
COPY --from=gitea-downloader /usr/local/bin/gitea /usr/local/bin/gitea

# Node app
WORKDIR /app
COPY --from=app-builder /app/node_modules ./node_modules
COPY --from=app-builder /app/dist ./dist
COPY --from=app-builder /app/package.json ./
COPY src/ src/
COPY lib/ lib/
COPY web/ web/
COPY mcp-config.json ./
COPY gitea/ gitea/
COPY scripts/entrypoint.sh scripts/

# AIO config
COPY aio/supervisord.conf /etc/supervisor/conf.d/gigi-aio.conf.template
COPY aio/cdp-proxy.conf /etc/nginx/conf.d/cdp-proxy.conf
COPY aio/entrypoint.sh /aio-entrypoint.sh
RUN chmod +x /aio-entrypoint.sh

# Runner-worker Dockerfile (for bootstrap build)
COPY runner-worker/Dockerfile /opt/runner-worker/Dockerfile

RUN chown -R gigi:gigi /app

EXPOSE 3000 6080

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["/aio-entrypoint.sh"]
```

**Step 2: Verify it builds locally**

Run: `docker build -f Dockerfile.aio -t gigi:aio .`
Expected: Builds successfully (may take a few minutes first time).

**Step 3: Commit**

```bash
git add Dockerfile.aio
git commit -m "feat: add Dockerfile.aio — all-in-one platform image"
```

---

### Task 6: Test locally with docker-compose

**Files:**
- Create: `docker-compose.aio.yml`

**Step 1: Create a minimal compose for testing**

Create `docker-compose.aio.yml`:

```yaml
services:
  gigi:
    build:
      context: .
      dockerfile: Dockerfile.aio
    environment:
      DATABASE_URL: postgresql://gigi:gigi@postgres:5432/gigi
      ADMIN_USER: mauro
      ADMIN_PASSWORD: admin
      ORG_NAME: idea
    ports:
      - "3100:3000"   # Gigi web
      - "6080:6080"   # noVNC browser viewer
    volumes:
      - gigi-data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: gigi
      POSTGRES_PASSWORD: gigi
      POSTGRES_DB: gigi
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gigi"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  gigi-data:
  postgres-data:
```

**Step 2: Test**

Run: `docker compose -f docker-compose.aio.yml up --build`

Expected:
- Gigi app at http://localhost:3100
- noVNC browser viewer at http://localhost:6080
- Internal Gitea bootstrapped (users, org, tokens)
- Logs show `[aio] Init complete`

**Step 3: Verify services started**

Run: `docker compose -f docker-compose.aio.yml exec gigi supervisorctl status`
Expected: All enabled programs RUNNING.

**Step 4: Commit**

```bash
git add docker-compose.aio.yml
git commit -m "feat: add docker-compose.aio.yml for local AIO testing"
```

---

### Task 7: Update CI workflow to build AIO image

**Files:**
- Modify: `.gitea/workflows/build.yaml`

**Step 1: Add AIO build step**

Add a second build job (or extend the existing one) that builds `Dockerfile.aio` and pushes as `gigi:aio`:

In `.gitea/workflows/build.yaml`, after the existing "Build Docker image" step, add:

```yaml
      - name: Build AIO image
        run: |
          rsync -az -e "ssh $SSH_OPTS" --exclude=.git --exclude=node_modules \
            . m@${{ env.DEPLOY_HOST }}:/tmp/gigi-build-aio/
          ssh $SSH_OPTS m@${{ env.DEPLOY_HOST }} "
            set -e
            cd /tmp/gigi-build-aio
            sudo docker build -f Dockerfile.aio \
              -t ${{ env.REGISTRY }}/${{ env.IMAGE }}:aio-${{ github.sha }} \
              -t ${{ env.REGISTRY }}/${{ env.IMAGE }}:aio .
            rm -rf /tmp/gigi-build-aio"

      - name: Push AIO image
        run: |
          docker push ${{ env.REGISTRY }}/${{ env.IMAGE }}:aio-${{ github.sha }}
          docker push ${{ env.REGISTRY }}/${{ env.IMAGE }}:aio
```

Update the deploy step to use the AIO image:

```yaml
      - name: Deploy service
        run: |
          ssh $SSH_OPTS m@${{ env.DEPLOY_HOST }} "
            sudo docker service update --image ${{ env.REGISTRY }}/${{ env.IMAGE }}:aio \
              --with-registry-auth --force gigi-prod_gigi"
```

**Step 2: Commit**

```bash
git add .gitea/workflows/build.yaml
git commit -m "ci: build and push gigi:aio image alongside lean image"
```

---

### Task 8: Update gigi-infra prod compose

**Files:**
- Modify (in gigi-infra): `stacks/docker-compose.gigi-prod.yml`
- Modify (in gigi-infra): `caddy/Caddyfile.prod`

**Step 1: Simplify the compose**

Remove `browser`, `browser-init` services. Update `gigi` service to use `:aio` tag, mount Docker socket, expose noVNC port.

Replace the gigi service section:

```yaml
services:
  gigi:
    image: ${REGISTRY:-prod.gigi.local}/gigi/gigi:${TAG:-aio}
    environment:
      DATABASE_URL: "postgresql://gigi_prod:${GIGI_PROD_DB_PASSWORD:-gigi_prod_secret}@postgres:5432/gigi_prod"
      PORT: "3000"
      GIGI_ENV: "production"
      GIGI_INSTANCE_URL: "https://prod.gigi.local"
      # No GITEA_URL → internal Gitea starts automatically
      # No CHROME_CDP_URL → internal Chrome starts automatically
      BROWSER_MODE: "chrome"
      BROWSER_VIEW_URL: "/browser/"
      WORKSPACE_DIR: "/workspace"
      ADMIN_USER: "mauro"
      ORG_NAME: "gigi"
    volumes:
      - /mnt/cluster-storage/docker/gigi-prod/data:/data
      - /mnt/cluster-storage/docker/gigi-prod/workspace:/workspace
      - /var/run/docker.sock:/var/run/docker.sock
    secrets:
      - gigi_prod_ssh_key
    networks:
      - gigi-internal
      - databases_default
    deploy:
      mode: replicated
      replicas: 1
      update_config:
        order: start-first
        failure_action: rollback
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      placement:
        constraints:
          - node.role == manager
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 60s
```

Remove the `browser:` and `browser-init:` service blocks entirely.

Keep `gitea-runner:` as-is (it stays separate).

Remove the standalone `gitea:` service (now internal to gigi:aio).

**Step 2: Update Caddyfile**

The `/browser/*` route now points to `gigi:6080` (noVNC inside the AIO container).
The `/v2/*` route points to `gigi:3300` (internal Gitea inside the AIO container).

Update `caddy/Caddyfile.prod`:

```caddy
{
	auto_https off
}

:443 {
	tls /certs/prod.gigi.local.crt /certs/prod.gigi.local.key

	# Docker container registry → internal Gitea (inside AIO)
	handle /v2/* {
		reverse_proxy gigi:3300
	}

	# Browser viewer → noVNC (inside AIO)
	handle /browser/* {
		uri strip_prefix /browser
		reverse_proxy gigi:6080
	}

	# Everything else → Gigi's Hono server
	reverse_proxy gigi:3000
}

:80 {
	redir https://{host}{uri} permanent
}
```

**Step 3: Commit (in gigi-infra)**

```bash
git add stacks/docker-compose.gigi-prod.yml caddy/Caddyfile.prod
git commit -m "feat: simplify prod stack for gigi:aio — remove browser/gitea services"
```

---

### Task 9: Build, deploy, and verify on cluster

**Step 1: Build AIO image on cluster**

```bash
rsync -az -e "ssh" --exclude=.git --exclude=node_modules \
  . m@192.168.1.110:/tmp/gigi-build-aio/
ssh m@192.168.1.110 "
  set -e
  cd /tmp/gigi-build-aio
  sudo docker build -f Dockerfile.aio -t prod.gigi.local/gigi/gigi:aio .
  rm -rf /tmp/gigi-build-aio"
```

**Step 2: Deploy updated stack**

```bash
# Sync gigi-infra
rsync -az --exclude=.git gigi-infra/ m@192.168.1.110:/tmp/gigi-infra-sync/
ssh m@192.168.1.110 "sudo rsync -a /tmp/gigi-infra-sync/ /mnt/cluster-storage/deploy/gigi-infra/"

# Update Caddy config
ssh m@192.168.1.110 "sudo cp /mnt/cluster-storage/deploy/gigi-infra/caddy/Caddyfile.prod /mnt/cluster-storage/deploy/gigi-infra/Caddyfile.prod"
ssh m@192.168.1.110 "sudo docker exec gigi-prod-caddy caddy reload --config /etc/caddy/Caddyfile"

# Redeploy stack
ssh m@192.168.1.110 'export $(sudo cat /mnt/cluster-storage/deploy/gigi-infra/.env | xargs) && sudo GITEA_API_TOKEN=$GITEA_API_TOKEN docker stack deploy -c /mnt/cluster-storage/deploy/gigi-infra/stacks/docker-compose.gigi-prod.yml gigi-prod'
```

**Step 3: Verify**

- `curl -sk https://prod.gigi.local/health` → 200 OK
- `curl -sk https://prod.gigi.local/v2/` → Gitea registry auth response
- `curl -sk https://prod.gigi.local/browser/` → noVNC HTML
- Check logs: `ssh m@192.168.1.110 "sudo docker service logs --tail 30 gigi-prod_gigi"`

**Step 4: Commit both repos and push**

```bash
# In gigi/
git push gigi-prod main

# In gigi-infra/
git push gigi-prod main
```

---

## Files Summary

| File | Change | Repo |
|------|--------|------|
| `runner-worker/Dockerfile` | **New** — moved from gigi-infra | gigi |
| `aio/supervisord.conf` | **New** — process manager config | gigi |
| `aio/entrypoint.sh` | **New** — conditional bootstrap | gigi |
| `aio/cdp-proxy.conf` | **New** — nginx CDP relay | gigi |
| `Dockerfile.aio` | **New** — multi-stage all-in-one image | gigi |
| `docker-compose.aio.yml` | **New** — local AIO testing | gigi |
| `.gitea/workflows/build.yaml` | **Modify** — add AIO build+push | gigi |
| `stacks/docker-compose.gigi-prod.yml` | **Modify** — remove browser/gitea services | gigi-infra |
| `caddy/Caddyfile.prod` | **Modify** — route to AIO ports | gigi-infra |

## Verification Checklist

1. `docker build -f Dockerfile.aio -t gigi:aio .` — builds clean
2. `docker compose -f docker-compose.aio.yml up` — all services start, init completes
3. http://localhost:3100 — Gigi web UI loads
4. http://localhost:6080 — noVNC shows Chrome
5. Internal Gitea accessible via Gigi UI
6. `GITEA_URL=http://external:3000 docker run gigi:aio` — skips internal Gitea
7. `CHROME_CDP_URL=ws://external:9222 docker run gigi:aio` — skips Chrome
8. Prod deploy: health check, registry push, browser viewer all work
