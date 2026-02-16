# Gigi Dual-Instance Platform — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy a self-contained Gigi prod instance at `gigi.casa` with its own Gitea, browser, and CI pipeline — ready to self-deploy on code changes.

**Architecture:** Single Docker Swarm stack per instance with internal Caddy, keepalived VIP, and path-based routing. Shared cluster Postgres with separate databases. Infrastructure config lives in a `gigi/infra` repo on Gigi's own Gitea.

**Tech Stack:** Docker Swarm, Caddy, Gitea, keepalived, PostgreSQL, Node.js 20

**Cluster access:** `ssh 192.168.1.110` (manager node, `worker-1`). Docker requires `sudo`.

**Design doc:** `docs/plans/2026-02-16-dual-instance-platform-design.md`

---

## Current State

- Swarm: 3 nodes (worker-1 .110 manager, worker-2 .111, worker-3 .112)
- VIP .50 exists (OS-level keepalived for cluster ingress)
- Postgres running as `databases_postgres` on `databases_default` network
- Gigi running as `idea-biancifiore-gigi` stack (app + neko browser)
- Storage: `/mnt/cluster-storage/` (NFS, 1.6TB free)
- Docker engine 28.4.0, requires `sudo` on all nodes

---

### Task 1: Create Postgres databases

**What:** Create `gigi_prod` and `gigi_dev` databases on the shared cluster Postgres.

**Step 1:** Find the Postgres container and check existing databases.

```bash
ssh 192.168.1.110 'sudo docker ps --filter name=databases_postgres --format "{{.ID}} {{.Names}}"'
```

**Step 2:** Create the databases and users.

```bash
ssh 192.168.1.110 'sudo docker exec $(sudo docker ps -q --filter name=databases_postgres) psql -U postgres -c "
CREATE DATABASE gigi_prod;
CREATE DATABASE gigi_dev;
CREATE USER gigi_prod WITH ENCRYPTED PASSWORD '\''gigi_prod_change_me'\'';
CREATE USER gigi_dev WITH ENCRYPTED PASSWORD '\''gigi_dev_change_me'\'';
GRANT ALL PRIVILEGES ON DATABASE gigi_prod TO gigi_prod;
GRANT ALL PRIVILEGES ON DATABASE gigi_dev TO gigi_dev;
ALTER DATABASE gigi_prod OWNER TO gigi_prod;
ALTER DATABASE gigi_dev OWNER TO gigi_dev;
"'
```

**Step 3:** Verify databases exist.

```bash
ssh 192.168.1.110 'sudo docker exec $(sudo docker ps -q --filter name=databases_postgres) psql -U postgres -c "\l" | grep gigi'
```

Expected: `gigi_prod` and `gigi_dev` listed.

**Step 4:** Test connectivity from within the swarm network.

```bash
ssh 192.168.1.110 'sudo docker run --rm --network databases_default postgres:16-alpine psql "postgresql://gigi_prod:gigi_prod_change_me@postgres:5432/gigi_prod" -c "SELECT 1"'
```

Expected: Returns `1`.

---

### Task 2: Generate self-signed TLS certificates

**What:** Create self-signed certs for `gigi.casa` and `dev.gigi.casa`.

**Step 1:** Create certificate directory on cluster storage.

```bash
ssh 192.168.1.110 'sudo mkdir -p /mnt/cluster-storage/docker/gigi-prod/certs'
```

**Step 2:** Generate cert for `gigi.casa`.

```bash
ssh 192.168.1.110 'sudo openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout /mnt/cluster-storage/docker/gigi-prod/certs/gigi.casa.key \
  -out /mnt/cluster-storage/docker/gigi-prod/certs/gigi.casa.crt \
  -subj "/CN=gigi.casa" \
  -addext "subjectAltName=DNS:gigi.casa,DNS:*.gigi.casa"'
```

**Step 3:** Generate cert for `dev.gigi.casa`.

```bash
ssh 192.168.1.110 'sudo mkdir -p /mnt/cluster-storage/docker/gigi-dev/certs && \
sudo openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout /mnt/cluster-storage/docker/gigi-dev/certs/dev.gigi.casa.key \
  -out /mnt/cluster-storage/docker/gigi-dev/certs/dev.gigi.casa.crt \
  -subj "/CN=dev.gigi.casa" \
  -addext "subjectAltName=DNS:dev.gigi.casa,DNS:*.dev.gigi.casa"'
```

**Step 4:** Verify certs.

```bash
ssh 192.168.1.110 'sudo openssl x509 -in /mnt/cluster-storage/docker/gigi-prod/certs/gigi.casa.crt -noout -text | grep -E "Subject:|DNS:"'
```

Expected: Shows `CN=gigi.casa` and SANs.

---

### Task 3: Create the infra files locally

**What:** Create all Docker Compose, Caddy, and keepalived configs in a local `gigi-infra/` directory. This will later be pushed to Gigi's own Gitea.

**Files to create:**

```
/Users/m/work/gigi-infra/
├── config.yml
├── stacks/
│   ├── docker-compose.gigi-prod.yml
│   └── docker-compose.gigi-dev.yml
├── caddy/
│   ├── Caddyfile.prod
│   └── Caddyfile.dev
├── databases/
│   └── init-gigi-dbs.sh
├── .gitea/
│   └── workflows/
│       ├── deploy-dev.yml
│       └── deploy-prod.yml
└── scripts/
    └── promote.sh
```

**Step 1:** Create directory structure.

```bash
mkdir -p /Users/m/work/gigi-infra/{stacks,caddy,databases,.gitea/workflows,scripts}
```

**Step 2:** Create `config.yml` — deployment configuration.

```yaml
# config.yml — Gigi platform deployment configuration
registry:
  host: "gigi.casa"
  port: 3000
  namespace: "gigi"

environments:
  prod:
    type: swarm
    host: "192.168.1.110"
    deploy_dir: "/mnt/cluster-storage/deploy/gigi-infra"
  dev:
    type: swarm
    host: "192.168.1.110"
    deploy_dir: "/mnt/cluster-storage/deploy/gigi-infra"

stacks:
  stacks/docker-compose.gigi-prod.yml:
    name: "gigi-prod"
    environment: prod
  stacks/docker-compose.gigi-dev.yml:
    name: "gigi-dev"
    environment: dev
```

**Step 3:** Create `stacks/docker-compose.gigi-prod.yml`.

```yaml
# Gigi Production Stack — gigi.casa (VIP 192.168.1.51)
version: "3.8"

services:
  keepalived:
    image: osixia/keepalived:2.0.20
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_BROADCAST
      - NET_RAW
    environment:
      KEEPALIVED_VIRTUAL_IPS: "#PYTHON2BASH:['192.168.1.51']"
      KEEPALIVED_UNICAST_PEERS: "#PYTHON2BASH:['192.168.1.110','192.168.1.111','192.168.1.112']"
      KEEPALIVED_PRIORITY: "100"
      KEEPALIVED_INTERFACE: "end0"
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.role == manager

  caddy:
    image: caddy:2-alpine
    ports:
      - target: 443
        published: 443
        protocol: tcp
        mode: host
      - target: 80
        published: 80
        protocol: tcp
        mode: host
    volumes:
      - ${DEPLOY_DIR:-/mnt/cluster-storage/deploy/gigi-infra}/caddy/Caddyfile.prod:/etc/caddy/Caddyfile:ro
      - /mnt/cluster-storage/docker/gigi-prod/certs:/certs:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - gigi-internal
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.role == manager

  gigi:
    image: ${REGISTRY:-192.168.1.80:3000}/gigi/gigi:${TAG:-latest}
    environment:
      DATABASE_URL: "postgresql://gigi_prod:${GIGI_PROD_DB_PASSWORD:-gigi_prod_change_me}@postgres:5432/gigi_prod"
      PORT: "3000"
      GIGI_ENV: "production"
      GIGI_INSTANCE_URL: "https://gigi.casa"
      GITEA_URL: "http://gitea:3000"
      BROWSER_MODE: "chrome"
      CHROME_CDP_URL: "ws://browser:9222"
      WORKSPACE_DIR: "/workspace"
    volumes:
      - /mnt/cluster-storage/docker/gigi-prod/workspace:/workspace
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
      rollback_config:
        order: start-first
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  gitea:
    image: gitea/gitea:1.24
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: postgres:5432
      GITEA__database__NAME: gigi_prod_gitea
      GITEA__database__USER: gigi_prod
      GITEA__database__PASSWD: "${GIGI_PROD_DB_PASSWORD:-gigi_prod_change_me}"
      GITEA__server__ROOT_URL: "https://gigi.casa/gitea/"
      GITEA__server__SSH_DOMAIN: "gigi.casa"
      GITEA__server__SSH_PORT: "22"
      GITEA__server__SSH_LISTEN_PORT: "22"
      GITEA__server__DOMAIN: "gigi.casa"
      GITEA__server__HTTP_PORT: "3000"
      GITEA__service__DISABLE_REGISTRATION: "true"
      USER_UID: "1000"
      USER_GID: "1000"
    volumes:
      - /mnt/cluster-storage/docker/gigi-prod/gitea:/data
    ports:
      - target: 22
        published: 22
        protocol: tcp
        mode: host
    networks:
      - gigi-internal
      - databases_default
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.role == manager

  gitea-runner:
    image: gitea/act_runner:latest
    environment:
      GITEA_INSTANCE_URL: "http://gitea:3000"
      GITEA_RUNNER_REGISTRATION_TOKEN: "${GITEA_RUNNER_TOKEN:-changeme}"
      GITEA_RUNNER_NAME: "gigi-prod-runner"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - gigi-internal
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.role == manager

  browser:
    image: zenika/alpine-chrome:with-node
    command: ["chromium-browser", "--headless", "--no-sandbox", "--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222", "--disable-gpu"]
    networks:
      - gigi-internal
    deploy:
      mode: replicated
      replicas: 1

volumes:
  caddy-data:
  caddy-config:

secrets:
  gigi_prod_ssh_key:
    external: true

networks:
  gigi-internal:
    driver: overlay
  databases_default:
    external: true
```

**Step 4:** Create `caddy/Caddyfile.prod`.

```caddyfile
{
    auto_https off
}

:443 {
    tls /certs/gigi.casa.crt /certs/gigi.casa.key

    # Gitea web UI
    handle_path /gitea/* {
        reverse_proxy gitea:3000
    }

    # Browser (Chromium DevTools frontend)
    handle_path /browser/* {
        reverse_proxy browser:9222
    }

    # Gigi WebSocket
    handle /ws {
        reverse_proxy gigi:3001
    }

    # Gigi API and web UI
    handle {
        reverse_proxy gigi:3000
    }
}

:80 {
    redir https://{host}{uri} permanent
}
```

**Step 5:** Create `databases/init-gigi-dbs.sh` (reference script, run manually in Task 1).

```bash
#!/bin/bash
# Run inside the postgres container:
# docker exec -i <postgres-container> psql -U postgres < init-gigi-dbs.sh

CREATE DATABASE gigi_prod;
CREATE DATABASE gigi_dev;
CREATE DATABASE gigi_prod_gitea;
CREATE DATABASE gigi_dev_gitea;

CREATE USER gigi_prod WITH ENCRYPTED PASSWORD 'CHANGE_ME';
CREATE USER gigi_dev WITH ENCRYPTED PASSWORD 'CHANGE_ME';

GRANT ALL PRIVILEGES ON DATABASE gigi_prod TO gigi_prod;
GRANT ALL PRIVILEGES ON DATABASE gigi_dev TO gigi_dev;
GRANT ALL PRIVILEGES ON DATABASE gigi_prod_gitea TO gigi_prod;
GRANT ALL PRIVILEGES ON DATABASE gigi_dev_gitea TO gigi_dev;

ALTER DATABASE gigi_prod OWNER TO gigi_prod;
ALTER DATABASE gigi_dev OWNER TO gigi_dev;
ALTER DATABASE gigi_prod_gitea OWNER TO gigi_prod;
ALTER DATABASE gigi_dev_gitea OWNER TO gigi_dev;
```

**Step 6:** Create `.gitea/workflows/deploy-dev.yml`.

```yaml
name: Deploy to Dev
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          echo "${{ secrets.SSH_KNOWN_HOSTS }}" > ~/.ssh/known_hosts

      - name: Build and push image
        run: |
          ssh 192.168.1.110 "cd /mnt/cluster-storage/deploy/gigi-source && \
            sudo git pull origin main && \
            sudo docker build -t 192.168.1.80:3000/gigi/gigi:dev-latest . && \
            sudo docker push 192.168.1.80:3000/gigi/gigi:dev-latest"

      - name: Deploy dev stack
        run: |
          ssh 192.168.1.110 "cd /mnt/cluster-storage/deploy/gigi-infra && \
            TAG=dev-latest sudo -E docker stack deploy -c stacks/docker-compose.gigi-dev.yml gigi-dev"
```

**Step 7:** Create `.gitea/workflows/deploy-prod.yml`.

```yaml
name: Deploy to Prod
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          echo "${{ secrets.SSH_KNOWN_HOSTS }}" > ~/.ssh/known_hosts

      - name: Build and push image
        run: |
          TAG=${GITHUB_REF_NAME:-latest}
          ssh 192.168.1.110 "cd /mnt/cluster-storage/deploy/gigi-source && \
            sudo git checkout $TAG 2>/dev/null || sudo git pull origin main && \
            sudo docker build -t 192.168.1.80:3000/gigi/gigi:$TAG -t 192.168.1.80:3000/gigi/gigi:latest . && \
            sudo docker push 192.168.1.80:3000/gigi/gigi:$TAG && \
            sudo docker push 192.168.1.80:3000/gigi/gigi:latest"

      - name: Deploy prod stack
        run: |
          ssh 192.168.1.110 "cd /mnt/cluster-storage/deploy/gigi-infra && \
            TAG=latest sudo -E docker stack deploy -c stacks/docker-compose.gigi-prod.yml gigi-prod"

      - name: Verify health
        run: |
          sleep 30
          ssh 192.168.1.110 "curl -sk https://192.168.1.51/health || echo 'Health check failed — check rollback'"
```

**Step 8:** Create `scripts/promote.sh`.

```bash
#!/bin/bash
# Usage: ./promote.sh v1.2.3
# Creates a git tag and pushes it, triggering deploy-prod.yml
set -euo pipefail
TAG="${1:?Usage: promote.sh <version-tag>}"
cd /mnt/cluster-storage/deploy/gigi-source
git tag "$TAG"
git push origin "$TAG"
echo "Tagged $TAG — deploy-prod workflow should trigger"
```

**Step 9:** Verify all files are created.

```bash
find /Users/m/work/gigi-infra -type f | sort
```

Expected: All files listed above.

---

### Task 4: Create databases (including Gitea DBs)

**What:** Create all 4 databases on the cluster Postgres — app DBs + Gitea DBs.

**Step 1:** Run the database creation on the Postgres container.

```bash
ssh 192.168.1.110 'sudo docker exec $(sudo docker ps -q --filter name=databases_postgres) psql -U postgres -c "
CREATE DATABASE gigi_prod;
CREATE DATABASE gigi_dev;
CREATE DATABASE gigi_prod_gitea;
CREATE DATABASE gigi_dev_gitea;
CREATE USER gigi_prod WITH ENCRYPTED PASSWORD '\''gigi_prod_secret'\'';
CREATE USER gigi_dev WITH ENCRYPTED PASSWORD '\''gigi_dev_secret'\'';
GRANT ALL PRIVILEGES ON DATABASE gigi_prod TO gigi_prod;
GRANT ALL PRIVILEGES ON DATABASE gigi_dev TO gigi_dev;
GRANT ALL PRIVILEGES ON DATABASE gigi_prod_gitea TO gigi_prod;
GRANT ALL PRIVILEGES ON DATABASE gigi_dev_gitea TO gigi_dev;
ALTER DATABASE gigi_prod OWNER TO gigi_prod;
ALTER DATABASE gigi_dev OWNER TO gigi_dev;
ALTER DATABASE gigi_prod_gitea OWNER TO gigi_prod;
ALTER DATABASE gigi_dev_gitea OWNER TO gigi_dev;
"'
```

**Step 2:** Verify.

```bash
ssh 192.168.1.110 'sudo docker exec $(sudo docker ps -q --filter name=databases_postgres) psql -U postgres -c "\l" | grep gigi'
```

Expected: 4 databases listed.

---

### Task 5: Prepare cluster storage directories

**What:** Create all volume mount directories on the manager node.

```bash
ssh 192.168.1.110 'sudo mkdir -p \
  /mnt/cluster-storage/docker/gigi-prod/{workspace,gitea,certs} \
  /mnt/cluster-storage/docker/gigi-dev/{workspace,gitea,certs} \
  /mnt/cluster-storage/deploy/gigi-infra \
  /mnt/cluster-storage/deploy/gigi-source'
```

Verify:

```bash
ssh 192.168.1.110 'ls -la /mnt/cluster-storage/docker/gigi-prod/'
```

---

### Task 6: Generate TLS certificates

**Step 1:** Generate prod cert.

```bash
ssh 192.168.1.110 'sudo openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout /mnt/cluster-storage/docker/gigi-prod/certs/gigi.casa.key \
  -out /mnt/cluster-storage/docker/gigi-prod/certs/gigi.casa.crt \
  -subj "/CN=gigi.casa" \
  -addext "subjectAltName=DNS:gigi.casa,DNS:*.gigi.casa"'
```

**Step 2:** Generate dev cert.

```bash
ssh 192.168.1.110 'sudo openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout /mnt/cluster-storage/docker/gigi-dev/certs/dev.gigi.casa.key \
  -out /mnt/cluster-storage/docker/gigi-dev/certs/dev.gigi.casa.crt \
  -subj "/CN=dev.gigi.casa" \
  -addext "subjectAltName=DNS:dev.gigi.casa,DNS:*.dev.gigi.casa"'
```

**Step 3:** Verify.

```bash
ssh 192.168.1.110 'sudo openssl x509 -in /mnt/cluster-storage/docker/gigi-prod/certs/gigi.casa.crt -noout -subject -ext subjectAltName'
```

---

### Task 7: Sync infra files to cluster

**What:** rsync the gigi-infra directory to the cluster deploy path.

```bash
rsync -avz --rsync-path="sudo rsync" /Users/m/work/gigi-infra/ 192.168.1.110:/mnt/cluster-storage/deploy/gigi-infra/
```

Verify:

```bash
ssh 192.168.1.110 'ls /mnt/cluster-storage/deploy/gigi-infra/stacks/'
```

Expected: `docker-compose.gigi-prod.yml` and `docker-compose.gigi-dev.yml`.

---

### Task 8: Build and push gigi Docker image

**What:** Clone gigi source to cluster, build the image, push to existing Gitea registry (temporary — will switch to Gigi's own Gitea registry later).

**Step 1:** Sync gigi source code to cluster.

```bash
rsync -avz --exclude=node_modules --exclude=.git --exclude=dist --rsync-path="sudo rsync" /Users/m/work/gigi/ 192.168.1.110:/mnt/cluster-storage/deploy/gigi-source/
```

**Step 2:** Build the image on the cluster (ARM64 native).

```bash
ssh 192.168.1.110 'cd /mnt/cluster-storage/deploy/gigi-source && sudo docker build -t 192.168.1.80:3000/gigi/gigi:latest .'
```

This may take a few minutes (npm install, vite build).

**Step 3:** Push to existing Gitea registry.

First check if `gigi` org exists on the old Gitea, create if not:

```bash
ssh 192.168.1.110 'curl -s -X POST "http://192.168.1.80:3000/api/v1/orgs" \
  -H "Content-Type: application/json" \
  -H "Authorization: token ${GITEA_TOKEN}" \
  -d '\''{"username":"gigi","visibility":"public"}'\'' || echo "org may already exist"'
```

Then push:

```bash
ssh 192.168.1.110 'sudo docker push 192.168.1.80:3000/gigi/gigi:latest'
```

**Step 4:** Verify image is in registry.

```bash
ssh 192.168.1.110 'curl -s http://192.168.1.80:3000/v2/gigi/gigi/tags/list'
```

---

### Task 9: Create Docker secrets for prod

**What:** Create the SSH key secret for the prod stack.

```bash
ssh 192.168.1.110 'sudo docker secret create gigi_prod_ssh_key /mnt/cluster-storage/deploy/biancifiore-infra/.ssh/biancifiore_deploy 2>/dev/null || echo "secret may already exist"'
```

Verify:

```bash
ssh 192.168.1.110 'sudo docker secret ls | grep gigi_prod'
```

---

### Task 10: Deploy the gigi-prod stack

**What:** Deploy the full prod stack to Swarm.

**Step 1:** Deploy.

```bash
ssh 192.168.1.110 'cd /mnt/cluster-storage/deploy/gigi-infra && \
  REGISTRY=192.168.1.80:3000 TAG=latest GIGI_PROD_DB_PASSWORD=gigi_prod_secret \
  sudo -E docker stack deploy -c stacks/docker-compose.gigi-prod.yml gigi-prod'
```

**Step 2:** Watch services come up.

```bash
ssh 192.168.1.110 'sudo docker stack services gigi-prod'
```

Wait for all services to show `1/1` replicas. May take 1-2 minutes for image pulls.

**Step 3:** Check keepalived VIP.

```bash
ssh 192.168.1.110 'ip addr show | grep 192.168.1.51'
```

Expected: VIP .51 appears on `end0`.

**Step 4:** Test Caddy is responding (via VIP directly if DNS isn't set up yet).

```bash
ssh 192.168.1.110 'curl -sk https://192.168.1.51/ || echo "not yet"'
```

**Step 5:** Test Gitea is responding.

```bash
ssh 192.168.1.110 'curl -sk https://192.168.1.51/gitea/ || echo "not yet"'
```

**Step 6:** Check service logs if anything is failing.

```bash
ssh 192.168.1.110 'sudo docker service logs gigi-prod_gigi --tail 20'
ssh 192.168.1.110 'sudo docker service logs gigi-prod_caddy --tail 20'
ssh 192.168.1.110 'sudo docker service logs gigi-prod_gitea --tail 20'
ssh 192.168.1.110 'sudo docker service logs gigi-prod_keepalived --tail 20'
```

---

### Task 11: Bootstrap Gitea

**What:** Complete Gitea's initial setup, create the `gigi` organization, and push the source code repo.

**Step 1:** Open Gitea's install page (through the internal network).

```bash
ssh 192.168.1.110 'curl -s http://$(sudo docker ps -q --filter name=gigi-prod_gitea -f status=running | head -1 | xargs sudo docker inspect --format "{{.NetworkSettings.Networks}}" | grep -oP "(?<=IPAddress\":\")\d+\.\d+\.\d+\.\d+" | head -1):3000/ | head -5'
```

If Gitea shows the install page, complete setup via API:

```bash
# Create admin user (API call to Gitea install endpoint)
ssh 192.168.1.110 'GITEA_IP=$(sudo docker inspect $(sudo docker ps -q --filter name=gigi-prod_gitea) --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" | head -1) && \
curl -s "http://$GITEA_IP:3000/api/v1/user/sign_up" \
  -H "Content-Type: application/json" \
  -d '\''{"username":"gigi-admin","password":"admin_change_me","email":"gigi@gigi.casa","must_change_password":false}'\'''
```

Note: Gitea first-run setup may require the web wizard. If the API doesn't work, the user will need to visit `https://gigi.casa/gitea/` after DNS is configured.

**Step 2:** Create `gigi` organization.

```bash
ssh 192.168.1.110 'GITEA_IP=$(sudo docker inspect $(sudo docker ps -q --filter name=gigi-prod_gitea) --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" | head -1) && \
curl -s -X POST "http://$GITEA_IP:3000/api/v1/orgs" \
  -H "Content-Type: application/json" \
  -u "gigi-admin:admin_change_me" \
  -d '\''{"username":"gigi","visibility":"public","description":"Gigi Platform"}'\'''
```

**Step 3:** Create repos (`gigi` and `infra`).

```bash
ssh 192.168.1.110 'GITEA_IP=$(sudo docker inspect $(sudo docker ps -q --filter name=gigi-prod_gitea) --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" | head -1) && \
curl -s -X POST "http://$GITEA_IP:3000/api/v1/orgs/gigi/repos" \
  -H "Content-Type: application/json" \
  -u "gigi-admin:admin_change_me" \
  -d '\''{"name":"gigi","description":"Gigi AI Platform","default_branch":"main","auto_init":false}'\'' && \
curl -s -X POST "http://$GITEA_IP:3000/api/v1/orgs/gigi/repos" \
  -H "Content-Type: application/json" \
  -u "gigi-admin:admin_change_me" \
  -d '\''{"name":"infra","description":"Gigi deployment infrastructure","default_branch":"main","private":true,"auto_init":false}'\'''
```

**Step 4:** Push gigi source code to Gigi's own Gitea.

```bash
cd /Users/m/work/gigi
git remote add gigi-prod git@gigi.casa:gigi/gigi.git  # After DNS is set up
# Or via direct IP temporarily:
git remote add gigi-prod ssh://git@192.168.1.51:22/gigi/gigi.git
git push gigi-prod --all
```

**Step 5:** Push infra repo.

```bash
cd /Users/m/work/gigi-infra
git init
git add -A
git commit -m "Initial infra for gigi.casa dual-instance platform"
git remote add origin ssh://git@192.168.1.51:22/gigi/infra.git
git push -u origin main
```

---

### Task 12: Register Gitea Actions runner

**What:** Get a runner registration token from Gitea and configure the runner service.

**Step 1:** Get runner token from Gitea admin API.

```bash
ssh 192.168.1.110 'GITEA_IP=$(sudo docker inspect $(sudo docker ps -q --filter name=gigi-prod_gitea) --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" | head -1) && \
curl -s -X GET "http://$GITEA_IP:3000/api/v1/admin/runners/registration-token" \
  -u "gigi-admin:admin_change_me"'
```

**Step 2:** Update the stack with the real token.

```bash
ssh 192.168.1.110 'cd /mnt/cluster-storage/deploy/gigi-infra && \
  REGISTRY=192.168.1.80:3000 TAG=latest GIGI_PROD_DB_PASSWORD=gigi_prod_secret GITEA_RUNNER_TOKEN=<token-from-step-1> \
  sudo -E docker stack deploy -c stacks/docker-compose.gigi-prod.yml gigi-prod'
```

**Step 3:** Verify runner is registered.

```bash
ssh 192.168.1.110 'GITEA_IP=$(sudo docker inspect $(sudo docker ps -q --filter name=gigi-prod_gitea) --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" | head -1) && \
curl -s "http://$GITEA_IP:3000/api/v1/admin/runners" -u "gigi-admin:admin_change_me"'
```

---

### Task 13: Verify end-to-end

**What:** Verify all services work together.

**Step 1:** Health check (via VIP).

```bash
ssh 192.168.1.110 'curl -sk https://192.168.1.51/health'
```

Expected: `{"ok":true,...}`

**Step 2:** Gitea accessible.

```bash
ssh 192.168.1.110 'curl -sk https://192.168.1.51/gitea/api/v1/version'
```

Expected: Gitea version JSON.

**Step 3:** Gigi setup wizard or main UI.

```bash
ssh 192.168.1.110 'curl -sk https://192.168.1.51/ | head -20'
```

Expected: HTML response from Gigi app.

**Step 4:** List all stack services.

```bash
ssh 192.168.1.110 'sudo docker stack services gigi-prod --format "table {{.Name}}\t{{.Replicas}}\t{{.Image}}"'
```

Expected: All 6 services at `1/1` replicas.

**Step 5:** Give Mauro the PiHole instructions.

```
Add these DNS entries to PiHole:

  gigi.casa       → 192.168.1.51
  dev.gigi.casa   → 192.168.1.52

Then visit https://gigi.casa to see the Gigi web UI.
Visit https://gigi.casa/gitea/ to complete Gitea setup if needed.
```

---

## Verification Checklist

After all tasks complete:

- [ ] `curl -sk https://192.168.1.51/health` → `{"ok":true}`
- [ ] `curl -sk https://192.168.1.51/gitea/api/v1/version` → Gitea version
- [ ] `git clone ssh://git@192.168.1.51:22/gigi/gigi.git` → success (after DNS: `git@gigi.casa:gigi/gigi.git`)
- [ ] `docker stack services gigi-prod` → all 6 services `1/1`
- [ ] `ip addr show | grep 192.168.1.51` → VIP active
- [ ] Gigi setup wizard accessible at `https://gigi.casa/setup` or main UI at `https://gigi.casa`
- [ ] Gitea runner registered and online
