<p align="center">
  <img src="web/app/public/gigi-zen.png" alt="Gigi" width="200" />
</p>

<h1 align="center">Gigi</h1>

<p align="center">
  <strong>Mission control for autonomous AI development.</strong><br/>
  <em>Not assisted. Autonomous.</em>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#why-gigi">Why Gigi</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#license">License</a>
</p>

---

## The Problem

IDEs and CLIs were designed for **humans** — a person typing code, reading diffs, clicking buttons. When AI entered the picture, we bolted copilots onto these human-centric tools and called it "AI-assisted development."

But **autonomous development** is a different game entirely. When an AI agent works independently — reading issues, writing code, creating PRs, verifying its own output — it doesn't need syntax highlighting or keybindings. It needs **task tracking, completion enforcement, real-time visibility, and budget control.**

Running autonomous agents through a terminal is like managing a factory floor through a typewriter. You can make it work, but you're burning tokens, losing context, and flying blind.

## Why Gigi

Gigi is the **control plane** for autonomous AI development. Instead of watching an agent scroll through a terminal, you get:

- **A Kanban board** that updates in real-time as the agent moves through tasks
- **Task enforcement** that prevents the agent from stopping mid-work — enforced by code, not prompts
- **Conversations linked to issues** — every webhook, every PR, every comment routed to the right thread
- **A shared browser** you can watch live as the agent inspects, debugs, and verifies
- **Token and cost tracking** so you know exactly what you're spending
- **Self-extension** — the agent evolves its own capabilities through PRs to its own repo

Self-hosted. Open source. Your hardware, your data, your agent.

## Quickstart

### Docker Compose (recommended)

```bash
git clone https://your-gitea/idea/gigi.git
cd gigi
cp .env.example .env
# Edit .env — set DATABASE_URL and your host IP for NEKO_NAT1TO1
docker compose up -d
```

Open `http://localhost:3100` — the setup wizard walks you through connecting your Anthropic API key, Gitea instance, and (optionally) Telegram.

**Services started:**

| Service | Description |
|---------|-------------|
| `gigi` | AI agent + real-time web UI |
| `gigi-neko` | Shared Chromium browser (WebRTC, optional) |

You'll also need a **PostgreSQL** instance and a **Gitea** instance (or any Gitea-compatible forge). See [Configuration](#configuration) for details.

### Local Development

```bash
npm install
npm run dev          # backend + Vite frontend with hot reload
npm test             # run test suite
```

## Features

### Kanban-Driven Development

Gigi integrates with Gitea project boards. Issues flow through columns — **Ready → In Progress → Review → Done** — and the agent updates status labels automatically as it works. The board updates in real-time via WebSocket.

No more "did the agent finish?" Just look at the board.

### Task Completion Enforcement

The biggest problem with autonomous agents: **they stop mid-task.** They write code but don't push. They push but don't create a PR. They create a PR but don't notify you.

Gigi solves this with a **state machine enforcer** that tracks every task through a completion loop:

```
Code Changed? → Branch Pushed? → PR Created? → Notification Sent? → ✅ Done
```

At each step, if the agent stalls, the enforcer **injects a continuation prompt** automatically. The agent cannot go idle with unfinished work. This is enforced by code, not by system prompt suggestions.

### Conversation-Driven Workflow

Every issue and PR gets its own persistent conversation. Gitea webhooks automatically route events to the right thread:

| Event | What Happens |
|-------|-------------|
| Issue opened | Conversation created, agent has full context |
| PR merged | Conversation updated, linked issues closed |
| `@gigi` in a comment | Agent responds in the linked conversation |
| Push event | Commit summary attached to repo conversation |
| Pipeline failure | Agent notified, can auto-investigate |

You chat with the agent about a specific issue, and all context — code changes, reviews, deployments — stays linked in one place.

### Shared Browser

Gigi runs a persistent Chromium instance via [neko](https://github.com/m1k1o/neko) that both the agent and you can see simultaneously:

- The agent navigates pages, inspects DOM, reads `console.error`, takes screenshots
- You watch the browser live via WebRTC in the Browser tab
- Either of you can take control at any time
- The agent **verifies its own work visually** — it doesn't need you to keep a tab open

### Token & Cost Tracking

Every message tracks input/output tokens and estimated cost. Per-conversation and aggregate views show exactly where your budget is going. No surprise bills from runaway agent loops.

### Self-Extension

Gigi's source code lives in a Gitea repo that the agent itself can modify:

1. Identifies a missing capability or bug
2. Clones its own repo, creates a feature branch
3. Implements the change
4. Creates a PR for you to review
5. Notifies you via Telegram or Web UI

After you merge, CI/CD deploys the update automatically. The agent evolves itself — new tools, prompt improvements, UI features, bug fixes.

### Multi-Channel Communication

- **Web UI** — real-time dashboard with Kanban, chat, Gitea integration, shared browser
- **Telegram** — message your agent on the go, get notifications on task completion

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Gigi Instance                                           │
│                                                          │
│  ┌────────────┐   ┌──────────┐   ┌────────────────────┐ │
│  │  Gigi      │   │  Gitea   │   │  PostgreSQL        │ │
│  │  Agent     │   │  (forge) │   │  (state + history) │ │
│  └─────┬──────┘   └──────────┘   └────────────────────┘ │
│        │                                                 │
│        ├── Claude Agent SDK (session persistence)        │
│        ├── MCP tools (gitea, telegram, browser, ask)     │
│        ├── Task enforcer (state machine)                 │
│        ├── Webhook router (events → conversations)       │
│        │                                                 │
│        ├──► Neko (shared Chromium browser)                │
│        │    ↕ WebRTC stream to user                      │
│        │                                                 │
│        └──► Svelte 5 Web UI                              │
│             ├── Kanban board (real-time)                  │
│             ├── Chat (conversations + tool output)        │
│             ├── Gitea views (issues, PRs, code)           │
│             └── Browser tab (live neko stream)            │
└──────────────────────────────────────────────────────────┘
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

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 (TypeScript, strict mode) |
| HTTP | [Hono](https://hono.dev/) |
| Agent | [Claude Agent SDK](https://docs.anthropic.com/) + MCP |
| Frontend | [Svelte 5](https://svelte.dev/) + [Vite](https://vitejs.dev/) |
| Validation | [Zod](https://zod.dev/) |
| Database | PostgreSQL |
| Browser | [Neko](https://github.com/m1k1o/neko) (Chromium via WebRTC) |
| Telegram | [grammY](https://grammy.dev/) |
| Deployment | Docker Swarm, Gitea Actions CI/CD |

### Project Structure

```
lib/
├── core/           # Agent loop, router, store, events, enforcer
├── api/            # HTTP routes (Hono), webhooks, Telegram, Gitea proxy
├── api-gitea/      # Typed Gitea API client
├── domain/         # Business logic (issues, projects, setup wizard)
├── tools/          # MCP tool servers (gitea, telegram, ask-user, browser)
└── backup/         # Repository backup & mirror system

web/app/
├── components/     # Svelte 5 UI (AppShell, Kanban, chat, panels)
├── lib/stores/     # Reactive state (chat, panels, navigation, kanban)
├── lib/services/   # WebSocket client, API layer
└── lib/utils/      # Markdown, formatting, link handling

src/
├── index.ts        # Server bootstrap: HTTP + WS + Telegram + enforcer
└── server.ts       # WebSocket server management
```

## Configuration

Configuration is stored in PostgreSQL and managed via the web UI setup wizard at `/setup`.

### Required Services

| Service | Purpose |
|---------|---------|
| **PostgreSQL** | Conversations, messages, config, task state |
| **Gitea** | Git hosting, issues, PRs, project boards, webhooks |
| **Anthropic API** | Claude models for the agent |

### Optional Services

| Service | Purpose |
|---------|---------|
| **Neko** | Shared browser for visual verification |
| **Telegram Bot** | Mobile notifications and chat |
| **Backup Gitea** | Repository mirroring to secondary instance |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | *required* |
| `PORT` | HTTP server port | `3000` |
| `BROWSER_MODE` | `headless` (Playwright) or `neko` (shared browser) | `headless` |
| `CHROME_CDP_URL` | Chrome DevTools Protocol URL for browser control | — |
| `GITEA_URL` | Gitea instance base URL | — |
| `GITEA_TOKEN` | Gitea API token for agent operations | — |
| `NEKO_NAT1TO1` | External IP/hostname for WebRTC connectivity | — |

## MCP Tools

The agent operates through these tool servers:

| Tool | Capabilities |
|------|-------------|
| **gitea** | Create repos, manage issues/PRs, update labels, post comments |
| **ask_user** | Ask the operator a question via web UI (blocks until answered) |
| **telegram_send** | Send Markdown-formatted notifications |
| **Chrome DevTools** | Navigate, screenshot, evaluate JS, click, fill, inspect network |

## How It Compares

| | IDE / CLI AI Assistants | Gigi |
|---|---|---|
| **Designed for** | Human-assisted coding | Autonomous agent operations |
| **Visibility** | Terminal scroll | Kanban + live browser + linked chats |
| **Task completion** | Hope the agent finishes | State machine enforcement |
| **Context** | Lost between sessions | Persistent, linked to issues/PRs |
| **Cost awareness** | Check your bill later | Real-time token tracking |
| **Self-improvement** | You update the config | Agent PRs its own repo |
| **Hosting** | Cloud vendor | Self-hosted, your hardware |

## CI/CD

Automated via Gitea Actions (`.gitea/workflows/build.yml`):

1. Build Docker images (ARM64 + AMD64)
2. Push to Gitea container registry
3. Deploy stack via `docker stack deploy`
4. Update reverse proxy config

## License

GPL-2.0
