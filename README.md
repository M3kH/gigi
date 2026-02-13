# Gigi 🤖

Gigi is a persistent AI coordinator running 24/7 on a TuringPi cluster. She helps Mauro build, deploy, and maintain projects across the idea infrastructure.

## What She Does

- **Infrastructure Management**: Monitors services, deploys updates, manages Docker Swarm
- **Code Coordination**: Creates PRs, reviews code, coordinates with other agents (Guglielmo, Rugero)
- **Communication**: Available via Telegram and web UI at `https://claude.cluster.local`
- **CI/CD**: Orchestrates builds, deployments, and infrastructure updates

## Tech Stack

- **Runtime**: Node.js 20 on ARM64 (TuringPi cluster)
- **Framework**: [Hono](https://hono.dev/) (HTTP), [grammY](https://grammy.dev/) (Telegram)
- **Agent**: [Claude Agent SDK](https://github.com/anthropics/anthropic-agent-sdk) with MCP tools
- **Database**: PostgreSQL (shared cluster DB)
- **Deployment**: Docker Swarm with automated CI/CD via Gitea Actions

## Architecture

```
src/
├── index.js          # Entry point: HTTP server + Telegram bot
├── agent.js          # Claude Agent SDK loop with system prompt
├── router.js         # Routes messages (telegram/web/webhook) to agent
├── telegram.js       # grammY bot with polling mode
├── web.js            # Hono routes: health, setup, chat, webhooks
├── setup.js          # Bootstrap wizard (OAuth, Telegram, Gitea)
├── store.js          # PostgreSQL store: config, conversations, messages
├── health.js         # Health check with phase detection
├── webhooks.js       # Gitea webhook handler with HMAC validation
├── mcp-server.js     # MCP server exposing tools to Claude Agent SDK
└── tools/            # Tool implementations (bash, git, gitea, etc.)
```

## Quick Start

```bash
# Development
npm install
npm run dev

# Production (Docker Compose)
# Copy and configure environment variables
cp .env.example .env
# Edit .env with your configuration

# Run with docker-compose (includes Neko browser service)
docker-compose up -d

# Or run without Neko (headless mode only)
docker build -t gigi .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=... \
  -e DATABASE_URL=... \
  -e GITEA_TOKEN=... \
  gigi
```

## Configuration

All configuration is stored in PostgreSQL and managed via the web UI at `/setup`:

- **Anthropic API**: OAuth token or API key
- **Telegram**: Bot token and authorized chat ID
- **Gitea**: API token for repo operations

Environment variables:
- `DATABASE_URL` — PostgreSQL connection string
- `ANTHROPIC_API_KEY` — (optional) API key for Claude Agent SDK
- `PORT` — HTTP server port (default: 3000)
- `BROWSER_MODE` — Browser automation mode: `headless` (Playwright) or `neko` (remote browser)
- `NEKO_HOST` — Neko service hostname (default: gigi-neko)
- `NEKO_PASSWORD` — Password for Neko browser access

## Browser Modes

Gigi supports two browser automation modes:

1. **Headless Mode** (`BROWSER_MODE=headless`): Uses Playwright for fast, headless browser automation
2. **Neko Mode** (`BROWSER_MODE=neko`): Uses a remote browser service (Neko) for interactive debugging

The docker-compose setup includes both services:
- `gigi`: Main AI agent service
- `gigi-neko`: Remote browser service (accessible on port 8080)

## Tools Available to Gigi

| Tool | Description |
|------|-------------|
| `bash` | Sandboxed shell (30s timeout, blocked destructive patterns) |
| `git` | Git operations with auto-configured Gitea credentials |
| `gitea` | Gitea API for repos, issues, PRs, comments |
| `read_file` | Read files under /projects, /workspace, /app |
| `write_file` | Write files under /workspace |
| `docker` | Read-only Docker inspection (services, logs, ps) |
| `telegram_send` | Send messages to Mauro on Telegram |

## Self-Modification Workflow

Gigi can create PRs on her own codebase:

1. Clone to `/workspace/gigi` via git tool
2. Create branch, edit files via write_file tool
3. Commit and push (Gitea credentials auto-configured)
4. Create PR via gitea tool
5. Notify Mauro on Telegram with PR link

## Infrastructure

- **TuringPi v2**: 3 ARM64 nodes (worker-0: .110, worker-1: .111, worker-2: .112)
- **VIP**: 192.168.1.50 (keepalived)
- **Gitea**: http://192.168.1.80:3000 (repos, CI, registry)
- **Caddy**: Reverse proxy for `*.cluster.local` domains
- **Storage**: `/mnt/cluster-storage/`
- **Docker service**: `idea-biancifiore-gigi_gigi`

## The Team

- **Gigi** (this service) — Coordinator, infrastructure, deployment, communications
- **Guglielmo** — org-press core developer (meticulous, pragmatic)
- **Rugero** — Website maintainer (creative, design-focused)

## Repositories

All repositories are hosted on Gitea under the `idea/` organization:

- `gigi` — This service
- `org-press` — Static site generator (Guglielmo)
- `rugero-ideable` — Website content (Rugero)
- `biancifiore` — Infrastructure configuration
- `deploy-docker-compose` — CI action for Docker deployments
- `deploy-site` — CI action for static site + Caddyfile deployments

## Health Checks

```bash
curl http://localhost:3000/health
```

Returns JSON with service status, phase (booting/healthy/degraded), and component health.

## CI/CD

Automated deployment via `.gitea/workflows/build.yml`:

1. rsync source to cluster manager (192.168.1.110)
2. `docker-compose build` for both services (gigi and gigi-neko) on ARM64
3. Push images to Gitea registry:
   - `${REGISTRY}/idea/gigi:${TAG}` — Main service
   - `${REGISTRY}/idea/gigi-neko:${TAG}` — Neko browser service
4. Deploy stack using `docker stack deploy` with docker-compose.yml
5. Deploy Caddyfile via `deploy-site` action

## License

GPL-2.0

---

Built with ❤️ by Mauro and Gigi on the TuringPi cluster
