# Gigi AIO (All-In-One) Image Design

## Goal

Package Gigi + Gitea + Chrome/noVNC into a single Docker image (`gigi:aio`) that self-bootstraps on first boot. The lean app image (`gigi:latest`) stays unchanged. External services: Postgres, act_runner.

## Core Principle

**The app code doesn't change.** Gigi connects to Gitea, Chrome, and Postgres via env vars. The AIO image is a packaging layer that bundles Gitea and Chrome into the same container and sets those env vars to `localhost`. It's one distribution format, not the only one.

## Architecture

```
┌─────────────────────────────────┐
│  gigi:aio                       │
│  ├─ entrypoint.sh (bootstrap)   │
│  │   ├─ init gitea if internal  │
│  │   ├─ build runner-worker img │
│  │   └─ start supervisord       │
│  ├─ supervisord                 │
│  │   ├─ gitea (conditional)     │
│  │   ├─ chromium + xvfb         │
│  │   ├─ x11vnc + novnc          │
│  │   ├─ nginx (cdp relay)       │
│  │   └─ node (gigi app)         │
│  │                              │
│  volumes:                       │
│    /data — gitea + workspace    │
│    /var/run/docker.sock         │
└─────────────────────────────────┘

External: postgres, act_runner
```

## Components

### Bundled Processes (supervisord)

| Component | Port | Skip condition |
|-----------|------|----------------|
| **Gigi** (Node/Hono) | 3000 | Always runs |
| **Gitea** (binary) | 3300 (internal) | `GITEA_URL` points to external |
| **Chromium** + Xvfb | 9222 (CDP) | `CHROME_CDP_URL` points to external |
| **x11vnc + noVNC** | 6080 (VNC viewer) | Follows Chrome |
| **nginx** (CDP relay) | 9223 | Follows Chrome |

### Conditional Startup

The entrypoint checks env vars and generates a supervisord config dynamically:

- No `GITEA_URL` → start internal Gitea, auto-set `GITEA_URL=http://localhost:3300`
- `GITEA_URL=http://external:3000` → skip Gitea process
- No `CHROME_CDP_URL` → start Chrome stack, auto-set `CHROME_CDP_URL=http://localhost:9223`
- `CHROME_CDP_URL=ws://external:9222` → skip Chrome/Xvfb/VNC

### Deployment Modes

| Mode | Command | What runs |
|------|---------|-----------|
| **AIO** | `docker run gigi:aio -e DATABASE_URL=...` | Everything |
| **No Chrome** | `docker run gigi:aio -e CHROME_CDP_URL=ws://chrome:9222` | Gigi + Gitea |
| **App only** | `docker run gigi:aio -e GITEA_URL=... -e CHROME_CDP_URL=...` | Just Gigi |
| **Lean** | `docker run gigi:latest` | Just Gigi (smaller image) |

## Bootstrap Sequence (first boot)

1. Entrypoint starts supervisord → Gitea + Chrome come up
2. Wait for internal Gitea health (`/api/v1/version`)
3. Run init: create admin user, gigi user, org, API tokens, SSH keys, webhook
4. Build + tag `runner-worker` image via Docker socket (if image doesn't exist)
5. Write config to Postgres (tokens, webhook secret)
6. Touch marker file → skip init on subsequent boots
7. Node app (Gigi) starts and connects to everything via localhost

## Images

| Image | Tag | Built from | Purpose |
|-------|-----|-----------|---------|
| `gigi:latest` | Lean app | `Dockerfile` | Separate-services mode, CI |
| `gigi:aio` | All-in-one | `Dockerfile.aio` | Self-contained platform |
| `gigi/runner-worker:latest` | CI worker | `runner-worker/Dockerfile` | Built by AIO on first boot |

## Dockerfile Strategy

`Dockerfile.aio` uses multi-stage:

1. **Stage: app** — reuse existing `Dockerfile` (npm ci, tsc, vite build, prune)
2. **Stage: gitea** — download Gitea binary for target arch
3. **Stage: final** — `debian:bookworm-slim` + Node + Chromium + Xvfb + noVNC + nginx + supervisor + Gitea binary + app from stage 1

## Data Volume

Single `/data` mount:
- `/data/gitea/` — Gitea state, repos, config
- `/data/workspace/` — Agent workspace
- `/data/init-done` — Bootstrap marker

## Gitea Templates

Existing `gigi/gitea/custom/templates/` are copied into the image. The entrypoint symlinks them to Gitea's expected path (`/data/gitea/templates/`) on first boot.

## What Changes in gigi-infra (prod)

- Compose: remove `browser`, `browser-init` services
- Compose: `gigi` service uses `gigi:aio` image, mount Docker socket
- Caddy: `/browser/*` routes to `gigi:6080` (noVNC inside the container)
- Caddy: `/v2/*` stays routed to internal Gitea (port 3300 inside container, or separate Gitea)
- Runner: stays separate, references `runner-worker:latest` from registry

## What Doesn't Change

- App code (`lib/`, `src/`, `web/`) — zero changes
- Env var interface — same vars, same defaults
- `docker-compose.local.yml` — keeps working (separate services mode)
- `Dockerfile` — stays as lean app image
- CI pipeline for `gigi:latest` — unchanged

## Runner-Worker Bootstrap

The AIO container has Docker socket access. On first boot, if `runner-worker:latest` doesn't exist locally:

1. Copy `/opt/runner-worker/Dockerfile` (baked into image) to temp dir
2. `docker build -t prod.gigi.local/gigi/runner-worker:latest`
3. Image is now available for the runner to pull

This eliminates the chicken-and-egg problem — no CI needed for the first runner-worker image.
