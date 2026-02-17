# Gigi

Persistent AI coordinator running 24/7 on a compute cluster. Manages infrastructure, coordinates agents, tracks issues, and communicates via Telegram and a real-time web UI.

## Features

- **AI Agent**: Claude Agent SDK with MCP tools, session persistence, task completion enforcement
- **Real-time Web UI**: Svelte 5 dashboard with kanban board, chat overlay, Gitea integration, shared browser
- **Issue Tracking**: Gitea webhook routing, automatic conversation creation, @mention handling
- **Self-Modification**: Can create PRs on its own codebase to evolve capabilities
- **Backup System**: Configurable repository mirroring between Gitea instances
- **Multi-Channel**: Web UI + Telegram bot with consistent conversation management

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22, ARM64 |
| Language | TypeScript (strict) |
| HTTP | [Hono](https://hono.dev/) |
| Telegram | [grammY](https://grammy.dev/) |
| Agent | [Claude Agent SDK](https://github.com/anthropics/anthropic-agent-sdk) |
| Frontend | [Svelte 5](https://svelte.dev/) + [Vite](https://vitejs.dev/) |
| Database | PostgreSQL |
| Deployment | Docker Swarm, Gitea Actions CI/CD |

## Architecture

```
lib/
├── core/           # Agent loop, message router, store, events, enforcer
├── api/            # HTTP routes, webhooks, Telegram bot, Gitea proxy
├── api-gitea/      # Typed Gitea API client wrapper
├── domain/         # Business logic (issues, projects, setup wizard)
├── tools/          # MCP tools (gitea, telegram, ask-user, browser)
└── backup/         # Repository backup/mirror system

web/app/
├── components/     # Svelte 5 UI (AppShell, panels, chat, kanban, dashboard)
├── lib/stores/     # Reactive stores (chat, panels, navigation, kanban)
├── lib/services/   # WebSocket client, chat API
└── lib/utils/      # Formatting, markdown, link interception

src/
├── index.ts        # Server bootstrap: HTTP + Telegram + enforcer + backup
└── server.ts       # WebSocket server management
```

### UI Layout

```
+-----------------------------------------------------------+
| A: Kanban Board (full / compact / hidden)                 |
+----------+------------------------------------------------+
| B: Chat  | C: Filters / View Tabs                        |
| Sidebar  +------------------------------------------------+
|          | D: Main View (Overview / Gitea / Browser)      |
|          |                                                |
|          |  +------------------------------------------+  |
|          |  | F: Chat Overlay (expand / compact / hide) |  |
+----------+--+------------------------------------------+--+
```

## Quick Start

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Production
npm start

# Run tests
npm test
```

### Docker Compose

```bash
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

Services:
- `gigi` — Main AI coordinator
- `gigi-neko` — Shared browser service (optional, for interactive browser tab)

## Configuration

Configuration is stored in PostgreSQL and managed via the web UI setup wizard (`/setup`):

| Setting | Description |
|---------|-------------|
| Anthropic API | OAuth token or API key for Claude |
| Telegram | Bot token and authorized chat ID |
| Gitea | API token for repository operations |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `PORT` | HTTP server port | `3000` |
| `BROWSER_MODE` | `headless` (Playwright) or `neko` (shared browser) | `headless` |
| `CHROME_CDP_URL` | Chrome DevTools Protocol URL | — |
| `GITEA_URL` | Gitea base URL | — |
| `GITEA_TOKEN` | Gitea API token | — |

## MCP Tools

The agent has access to these tools via MCP:

| Tool | Description |
|------|-------------|
| `gitea` | Full Gitea API — repos, issues, PRs, comments, labels |
| `ask_user` | Ask operator a question via web UI (blocks until answered) |
| `telegram_send` | Send Markdown-formatted Telegram messages |
| Chrome DevTools | `navigate_page`, `take_screenshot`, `evaluate_script`, `click`, `fill`, etc. |

## Webhook Integration

Gitea webhooks are routed to conversations automatically:
- **Issue opened/closed** → Creates/closes conversation, formatted system message
- **PR opened/merged** → Same pattern with PR context
- **Comments with @gigi** → Triggers agent response in the conversation
- **Push events** → Commit summaries attached to repo conversation

## Self-Modification

Gigi can evolve its own capabilities:
1. Clone its repo to `/workspace/gigi`
2. Create a feature branch
3. Implement changes (new tools, prompt updates, UI features, bug fixes)
4. Create a PR via Gitea API
5. Notify operator via Telegram
6. Operator reviews and merges → CI/CD deploys automatically

## CI/CD

Automated via `.gitea/workflows/build.yml`:
1. Build Docker images on ARM64
2. Push to Gitea container registry
3. Deploy stack via `docker stack deploy`
4. Update Caddy reverse proxy config

## License

GPL-2.0
