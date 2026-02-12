# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Gigi

Gigi is a persistent AI coordinator running 24/7 on a TuringPi cluster. She manages infrastructure, coordinates agents, and communicates with Mauro via Telegram and a web UI at `https://claude.cluster.local`.

## Architecture

- **Runtime**: Node.js 20, Docker Swarm, ARM64
- **Framework**: Hono (HTTP), grammY (Telegram)
- **Agent**: Claude Agent SDK with MCP tools, OAuth token auth
- **Database**: PostgreSQL (shared cluster DB) — config, conversations, messages
- **Entry point**: `src/index.js` → starts HTTP server + Telegram bot

### Key modules

| File | Purpose |
|------|---------|
| `src/agent.js` | Claude Agent SDK loop with system prompt |
| `src/router.js` | Routes messages (telegram/web/webhook) to agent |
| `src/telegram.js` | grammY bot — polling mode, chat ID lock |
| `src/web.js` | Hono routes — health, setup, chat, webhooks |
| `src/setup.js` | Bootstrap wizard (OAuth token, Telegram, Gitea) |
| `src/store.js` | PostgreSQL store — config, conversations, messages |
| `src/health.js` | Health check with phase detection |
| `src/webhooks.js` | Gitea webhook handler with HMAC validation |
| `src/mcp-server.js` | MCP server exposing tools to Claude Agent SDK |
| `src/tools/*.js` | Tool implementations |

### Tools available to the agent

| Tool | Description |
|------|-------------|
| `bash` | Sandboxed shell (30s timeout, blocked destructive patterns) |
| `git` | Git operations with auto-configured Gitea credentials |
| `gitea` | Gitea API — repos, issues, PRs, comments |
| `read_file` | Read files under /projects, /workspace, /app |
| `write_file` | Write files under /workspace |
| `docker` | Read-only Docker inspection (services, logs, ps) |
| `telegram_send` | Send messages to Mauro on Telegram |

## Commands

```bash
npm start          # Start server
npm run dev        # Start with --watch
```

## CI/CD

`.gitea/workflows/build.yml`:
1. rsync source to cluster manager (192.168.1.110)
2. `docker build` natively on ARM64
3. Push to Gitea registry (192.168.1.80:3000)
4. `docker stack deploy` or `docker service update`
5. Deploy Caddyfile via `deploy-site` action

Secrets: `REGISTRY_TOKEN`, `DB_PASSWORD`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`

## Self-modification workflow

Gigi can create PRs on her own repo:
1. Clone to `/workspace/gigi` via git tool
2. Create branch, edit files via write_file tool
3. Commit and push via git tool (Gitea credentials auto-configured)
4. Create PR via gitea tool
5. Notify Mauro on Telegram with PR link

## Infrastructure

- **TuringPi v2**: 3 ARM64 nodes (worker-0: .110, worker-1: .111, worker-2: .112)
- **VIP**: 192.168.1.50 (keepalived)
- **Gitea**: http://192.168.1.80:3000 (repos, CI, registry)
- **Caddy**: Reverse proxy, `*.cluster.local` internal domains
- **Storage**: `/mnt/cluster-storage/`
- **Docker service**: `idea-biancifiore-gigi_gigi`

## The Team

- **Gigi** (this service) — Coordinator, infra, deployment, comms
- **Guglielmo** — org-press core developer (meticulous, pragmatic)
- **Rugero** — Website maintainer (creative, design-focused)

## Repositories (all on Gitea under idea/)

- `gigi` — This service
- `org-press` — Static site generator (Guglielmo)
- `rugero-ideable` — Website (Rugero)
- `biancifiore` — Infrastructure repo
- `deploy-docker-compose` — CI action for Docker deployments
- `deploy-site` — CI action for static site + Caddyfile deployments
