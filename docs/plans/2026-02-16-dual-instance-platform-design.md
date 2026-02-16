# Gigi Dual-Instance Platform Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan from this design.

**Goal:** Run two self-contained Gigi instances (prod + dev) with independent Gitea, browser, and CI — enabling Gigi to develop herself, test on dev, and promote to prod via git tags.

**Domain:** `gigi.casa` (prod), `dev.gigi.casa` (dev)

---

## 1. Network & DNS

Two keepalived VIPs on the existing TuringPi cluster:

| VIP | Domain | Instance |
|-----|--------|----------|
| 192.168.1.51 | `gigi.casa` | Production |
| 192.168.1.52 | `dev.gigi.casa` | Development |

PiHole entries (manual, one-time):
```
gigi.casa       → 192.168.1.51
dev.gigi.casa   → 192.168.1.52
```

TLS: Self-signed certificates for `gigi.casa` and `dev.gigi.casa`.

Each VIP is managed by a keepalived container running in the stack. If the hosting node fails, keepalived on another node claims the VIP and Swarm reschedules services there.

```yaml
keepalived:
  image: osixia/keepalived
  network_mode: host
  cap_add: [NET_ADMIN, NET_BROADCAST, NET_RAW]
  environment:
    - KEEPALIVED_VIRTUAL_IPS=192.168.1.51  # .52 for dev
    - KEEPALIVED_INTERFACE=eth0
    - KEEPALIVED_PRIORITY=100
  deploy:
    mode: global
```

## 2. Stack Architecture

Each instance is a single Docker Swarm stack with 5 services:

```
gigi-prod stack (VIP .51)          gigi-dev stack (VIP .52)
├── keepalived (.51)               ├── keepalived (.52)
├── caddy (reverse proxy)          ├── caddy (reverse proxy)
├── gigi (app)                     ├── gigi (app)
├── gitea (git + CI + registry)    ├── gitea (git + CI + registry)
├── gitea-runner (Actions)         ├── gitea-runner (Actions)
└── browser (Chromium)             ├── browser (Chromium)
                                   └── preview containers (dynamic)
```

Shared external dependency: Postgres on the existing `databases_default` network.

Everything else is isolated per stack — separate Gitea data, separate browser sessions, separate Caddy configs.

## 3. Path-Based Routing (Internal Caddy)

Single domain per instance. Gitea and browser are internal services exposed as paths, not subdomains.

```caddyfile
gigi.casa {
    tls /certs/gigi.casa.crt /certs/gigi.casa.key

    handle_path /gitea/* {
        reverse_proxy gitea:3000
    }

    handle_path /browser/* {
        reverse_proxy browser:8080
    }

    handle /ws {
        reverse_proxy gigi:3001
    }

    handle {
        reverse_proxy gigi:3000
    }
}
```

SSH for git operations: Gitea publishes port 22 directly on the VIP (not through Caddy).

```
git clone git@gigi.casa:gigi/gigi.git
```

## 4. Database

Shared cluster Postgres, separate databases per instance:

```sql
CREATE DATABASE gigi_prod;
CREATE DATABASE gigi_dev;
CREATE USER gigi_prod WITH ENCRYPTED PASSWORD '...';
CREATE USER gigi_dev WITH ENCRYPTED PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE gigi_prod TO gigi_prod;
GRANT ALL PRIVILEGES ON DATABASE gigi_dev TO gigi_dev;
```

Preview databases created/dropped dynamically:
```sql
CREATE DATABASE gigi_preview_feature_xyz;
-- dropped when preview is torn down
```

Dev database can be wiped anytime. Gigi's bootstrap wizard re-runs setup on a fresh DB.

## 5. Repository Layout

Gigi's own Gitea (`gigi.casa/gitea`) hosts three repos:

| Repo | Purpose | Visibility |
|------|---------|------------|
| `gigi/gigi` | App source code (open-sourceable) | Public |
| `gigi/infra` | Deployment config (cluster-specific) | Private |
| `gigi/deploy-docker-compose` | Fork of reusable deploy action | Private |

### `gigi/gigi` (app source — open-sourceable)

```
gigi/
├── src/            # Entry point
├── lib/            # Core logic
├── web/            # Frontend (Svelte)
├── tests/          # Tests
├── Dockerfile      # How to build the image
├── package.json
└── CLAUDE.md
```

No cluster IPs, no compose files, no deployment secrets. Clean for open source.

### `gigi/infra` (deployment config — private)

```
infra/
├── config.yml                          # Environments, hosts, registry
├── stacks/
│   ├── docker-compose.gigi-prod.yml
│   ├── docker-compose.gigi-dev.yml
│   └── docker-compose.gigi-preview.yml # Template for previews
├── caddy/
│   ├── Caddyfile.prod
│   └── Caddyfile.dev
├── certs/                              # Self-signed certs (gitignored)
├── databases/
│   └── init-gigi-dbs.sh
├── keepalived/
│   └── keepalived.conf
├── .gitea/
│   └── workflows/
│       ├── deploy-dev.yml              # main push → build → deploy dev
│       ├── deploy-prod.yml             # tag push → deploy prod
│       └── deploy-preview.yml          # PR → deploy preview
└── scripts/
    └── promote.sh                      # Create tag from current dev image
```

## 6. CI/CD Pipeline

Three Gitea Actions workflows in `gigi/infra`:

### deploy-dev.yml — Push to main

Triggered by: push to `main` branch in `gigi/gigi`.

```
Push to main → Build image → Tag as :dev-{sha} and :dev-latest
             → deploy-docker-compose action
             → Deploy gigi-dev stack on VIP .52
```

### deploy-preview.yml — Pull request

Triggered by: PR opened/updated in `gigi/gigi`.

```
PR opened    → Build image tagged :preview-{branch}
             → Deploy preview container on dev stack
             → Comment on PR with link

PR closed    → Tear down preview container
             → Drop preview DB if exists
```

Preview access: `dev.gigi.casa/preview/{branch}` (path-based, no wildcard DNS needed).

### deploy-prod.yml — Tag push

Triggered by: tag push (`v*`) in `gigi/gigi`, or `workflow_dispatch` from infra repo.

```
Tag v1.2.3 → Pull :dev-latest image
           → Retag as :prod-v1.2.3 and :latest
           → deploy-docker-compose action
           → Deploy gigi-prod stack on VIP .51
           → Health check → auto-rollback on failure
```

## 7. Promote Flow

Three-stage development cycle:

```
Stage 1: Preview
  Gigi creates branch → pushes → PR triggers preview
  Gigi tests at dev.gigi.casa/preview/my-feature
  Gigi shares preview link with Mauro

Stage 2: Dev
  Merge PR → auto-deploys to dev.gigi.casa
  Mauro reviews on dev

Stage 3: Prod
  Mauro says "promote" → Gigi creates git tag
  Tag triggers deploy-prod.yml → deploys to gigi.casa
  Swarm health check + rollback protects prod
```

The "manual button": either a `/promote` chat command in Gigi that creates a git tag, or a `workflow_dispatch` trigger in the infra repo's Gitea Actions UI.

## 8. Bootstrap Flow

When a new instance starts with an empty DB:

1. Gigi app starts, connects to Postgres
2. Auto-migrates schema (existing `store.ts` behavior)
3. Enters setup wizard at `/setup`
4. Configure: Claude OAuth token, Telegram bot token, Gitea API token
5. Stores config in DB, restarts into normal mode

Each instance has its own:
- Telegram bot (prod: @gigi_bot, dev: @gigi_dev_bot)
- Claude OAuth token
- Gitea admin credentials
- Workspace directory

## 9. What Carries Over from Biancifiore

| From biancifiore | Used in gigi/infra |
|------------------|--------------------|
| `deploy-docker-compose` action | Forked into Gigi's Gitea |
| SSH keys (`.ssh/`) | Same cluster, copied to Gigi's Gitea secrets |
| `infra/config.yml` pattern | Same YAML structure, adapted for gigi |
| keepalived know-how | Extended with .51 and .52 VIPs |
| Caddy self-signed cert pattern | Reused for `gigi.casa` certs |

The global Caddy at .50 is not involved in Gigi traffic. Each stack's internal Caddy handles everything.

## 10. Migration Path

### Phase 1 — Infrastructure

1. Add keepalived VIPs (.51, .52) to cluster
2. Add PiHole DNS entries
3. Create Postgres databases (`gigi_prod`, `gigi_dev`)
4. Generate self-signed certs for `gigi.casa` and `dev.gigi.casa`
5. Create `gigi/infra` repo with compose files + Caddy config

### Phase 2 — Dev instance first

1. Deploy `gigi-dev` stack to VIP .52
2. Install Gitea, create `gigi` org, push gigi source code
3. Configure Gitea Actions runner
4. Test the full cycle: edit code → push → build → deploy to dev
5. Configure Telegram dev bot

### Phase 3 — Prod instance

1. Deploy `gigi-prod` stack to VIP .51
2. Mirror gigi repo from dev Gitea (or push independently)
3. Configure promote flow (tag → deploy prod)
4. Verify health check + rollback works
5. Configure Telegram prod bot

### Phase 4 — Cut over

1. Migrate daily work from `claude.cluster.local` to `gigi.casa`
2. Decommission old Gigi stack on `claude.cluster.local`
3. Migrate other repos to Gigi's Gitea at your pace
4. Update biancifiore Caddy to remove `claude.cluster.local` route

## 11. Resource Estimate

Per instance (approximate):

| Component | RAM | Notes |
|-----------|-----|-------|
| Gigi app | ~200-400MB | Node.js + Claude SDK, mostly I/O wait |
| Gitea | ~150-300MB | Lightweight git server |
| Gitea runner | ~200MB idle | Spikes during builds |
| Browser | ~300-500MB | Chromium headless |
| Caddy | ~20MB | Reverse proxy |
| Keepalived | ~5MB | VIP management |
| **Total per instance** | **~1-1.5GB** | |

Two long-lived instances + occasional preview: ~3-4GB total on a 48GB cluster. Plenty of headroom.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stack architecture | Monolith (all-in-one) | One stack = one thing. Easy to wipe, deploy, reason about |
| Domain | `gigi.casa` | Italian for "home". Short, memorable, reads well in git URLs |
| Routing | Path-based (`/gitea`, `/browser`) | Single domain, no subdomain exposure of internal services |
| Database | Separate DBs, shared Postgres | Cheap, easy to wipe dev, no schema conflicts |
| VIP method | Keepalived container | Proper HA, proven pattern, floats between nodes |
| Repo split | App (public) + infra (private) | Open-sourceable app, cluster-specific deploy stays private |
| Promote trigger | Git tag + manual button | Auditable, plus convenience via chat command or workflow_dispatch |
| Telegram | Separate bot per instance | Full isolation between prod and dev |
| Preview environments | App-only (start), full-stack possible later | Lightweight, fast to spin up |
