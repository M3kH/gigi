<p align="center">
  <img src="web/app/public/gigi-zen.png" alt="Gigi" width="200" />
</p>

<h1 align="center">Gigi</h1>

<p align="center">
  <strong>The control plane for autonomous AI development.</strong><br/>
  <em>Not assisted. Autonomous.</em>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#why-gigi">Why Gigi</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#security">Security</a> &middot;
  <a href="#license">License</a>
</p>

---

> [!CAUTION]
> **Gigi is a power tool for developers who understand what they're running.**
>
> - The agent executes shell commands with **full system access** (`dangerouslySkipPermissions`). It can read, write, and delete any file the host process can reach.
> - The bundled Gitea instance uses **automatic web authentication** — anyone with network access can browse repos, create issues, and merge PRs without logging in.
> - API keys and tokens (Anthropic, Gitea, Telegram) are stored in the database and available to the agent at runtime.
>
> **Never expose Gigi to the public internet.** Run it on a private network, behind a VPN, or bound to `localhost` only. You are fully responsible for securing your deployment. See [Security](#security) for details.

## The Problem

IDEs and CLIs were designed for **humans** — a person typing code, reading diffs, clicking buttons. When AI entered the picture, we bolted copilots onto these human-centric tools and called it "AI-assisted development."

But **autonomous development** is a different game. When an AI agent works independently — reading issues, writing code, creating PRs, verifying its own output — it doesn't need syntax highlighting or keybindings. It needs **task tracking, completion enforcement, real-time visibility, and budget control.**

Running autonomous agents through a terminal is like managing a factory floor through a typewriter. You can make it work, but you're burning tokens, losing context, and flying blind.

## Why Gigi

Gigi is the **control plane** for autonomous AI development. Instead of watching an agent scroll through a terminal, you get:

- **A Kanban board** that updates in real-time as the agent moves through tasks
- **Task enforcement** that prevents the agent from stopping mid-work — enforced by code, not prompts
- **Conversations linked to issues** — every webhook, every PR, every comment routed to the right thread
- **A shared browser** the agent uses to debug live websites, inspect the DOM, read console errors, run scripts, and trigger events — powered by Google Chrome DevTools Protocol (MCP)
- **Token and cost tracking** so you know exactly what you're spending
- **Always with you** — Telegram integration means your agent is reachable from anywhere, on any device
- **Self-extension** — the agent evolves its own capabilities through PRs to its own repo

Self-hosted. Open source. Your hardware, your data, your agent.

## Quickstart

### Docker Compose (recommended)

```bash
git clone https://github.com/user/gigi.git
cd gigi
cp .env.example .env
# Edit .env — set DATABASE_URL and your ANTHROPIC_API_KEY
docker compose up -d
```

Open `http://localhost:3100` — the setup wizard walks you through connecting your Anthropic API key, Gitea instance, and (optionally) Telegram.

> [!IMPORTANT]
> Keep Gigi bound to `localhost` or a private network. See [Security](#security) before exposing it to any external network.

**Services started:**

| Service | Description |
|---------|-------------|
| `gigi` | AI agent + real-time web UI |
| `chrome` | Headless Chrome with DevTools Protocol for browser automation |

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

### Live Browser Debugging

Gigi runs a persistent Chrome instance with full **DevTools Protocol** access via the [Chrome DevTools MCP](https://developer.chrome.com/docs/devtools/). The agent can:

- **Navigate pages** and inspect the live DOM
- **Read `console.error`** and other console output in real-time
- **Execute JavaScript** in the page context — trigger events, extract data, manipulate state
- **Take screenshots** and DOM snapshots for visual verification
- **Monitor network requests** — inspect headers, payloads, and response bodies
- **Click, fill forms, and interact** with page elements programmatically

The agent debugs live websites — including its own UI. You watch it happen in the Browser tab. This isn't a simulated environment; it's a real Chrome instance the agent controls through the same protocol your browser DevTools use.

### Token & Cost Tracking

Every message tracks input/output tokens and estimated cost. Per-conversation and aggregate views show exactly where your budget is going. No surprise bills from runaway agent loops.

### Always With You — Telegram Integration

Gigi isn't trapped in a browser tab. With Telegram integration, your agent is **always running, always reachable**:

- **Get notified** when tasks complete, PRs are created, or issues need attention
- **Send instructions** to your agent from your phone, on the train, from bed — anywhere
- **Full two-way chat** — same agent, same context, different channel
- **Cross-channel routing** — start a conversation on the web, continue it on Telegram

Your autonomous development pipeline doesn't stop when you close your laptop.

### Self-Extension

Gigi's source code lives in a Gitea repo that the agent itself can modify:

1. Identifies a missing capability or bug
2. Clones its own repo, creates a feature branch
3. Implements the change
4. Creates a PR for you to review
5. Notifies you via Telegram or Web UI

After you merge, CI/CD deploys the update automatically. The agent evolves itself — new tools, prompt improvements, UI features, bug fixes.

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
│        ├──► Chrome (DevTools Protocol via MCP)            │
│        │    ↕ Live browser visible in UI                  │
│        │                                                 │
│        └──► Svelte 5 Web UI                              │
│             ├── Kanban board (real-time)                  │
│             ├── Chat (conversations + tool output)        │
│             ├── Gitea views (issues, PRs, code)           │
│             └── Browser tab (live Chrome stream)          │
│                                                          │
│        ◄──► Telegram (two-way, always reachable)         │
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
| Browser | Chrome + [DevTools Protocol MCP](https://developer.chrome.com/docs/devtools/) |
| Messaging | [grammY](https://grammy.dev/) (Telegram) |
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
| **Telegram Bot** | Mobile notifications and two-way chat from anywhere |
| **Backup Gitea** | Repository mirroring to secondary instance |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | *required* |
| `PORT` | HTTP server port | `3000` |
| `CHROME_CDP_URL` | Chrome DevTools Protocol URL for browser automation | — |
| `GITEA_URL` | Gitea instance base URL | — |
| `GITEA_TOKEN` | Gitea API token for agent operations | — |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for mobile access | — |

## MCP Tools

The agent operates through these tool servers:

| Tool | Capabilities |
|------|-------------|
| **gitea** | Create repos, manage issues/PRs, update labels, post comments |
| **ask_user** | Ask the operator a question via web UI (blocks until answered) |
| **telegram_send** | Send Markdown-formatted notifications to Telegram |
| **Chrome DevTools** | Navigate, screenshot, evaluate JS, click, fill, inspect network, read console |

## How It Compares

| | IDE / CLI AI Assistants | Gigi |
|---|---|---|
| **Designed for** | Human-assisted coding | Autonomous agent operations |
| **Visibility** | Terminal scroll | Kanban + live browser + linked chats |
| **Task completion** | Hope the agent finishes | State machine enforcement |
| **Context** | Lost between sessions | Persistent, linked to issues/PRs |
| **Cost awareness** | Check your bill later | Real-time token tracking |
| **Browser debugging** | You open DevTools manually | Agent runs Chrome DevTools autonomously |
| **Availability** | Only when your IDE is open | Always on — web + Telegram |
| **Self-improvement** | You update the config | Agent PRs its own repo |
| **Hosting** | Cloud vendor | Self-hosted, your hardware |

## CI/CD

Automated via Gitea Actions (`.gitea/workflows/build.yml`):

1. Build Docker images (ARM64 + AMD64)
2. Push to Gitea container registry
3. Deploy stack via `docker stack deploy`
4. Update reverse proxy config

## Security

Gigi is designed for **trusted, private environments**. It trades sandboxing for autonomy — which is the point — but this means you must secure the perimeter yourself.

### What you should know

| Risk | Detail |
|------|--------|
| **Unrestricted shell** | The agent runs with `dangerouslySkipPermissions` so it can execute any command without confirmation prompts. This is required for autonomous operation but means a misconfigured prompt or malicious input could cause damage. |
| **Pre-authenticated Gitea** | The Gitea proxy injects `X-WEBAUTH-USER` automatically. There is no login screen — anyone who can reach the UI has full access to all repositories. |
| **Credentials in database** | API tokens for Anthropic, Gitea, and Telegram are stored in PostgreSQL. Protect your database connection and backups accordingly. |
| **Browser automation** | The agent controls a real Chrome instance. It can navigate to any URL, execute JavaScript, and interact with pages — including authenticated sessions if cookies are present. |

### Recommendations

- **Bind to localhost** or a private network interface — never `0.0.0.0` on a public-facing machine.
- **Use a VPN or SSH tunnel** if you need remote access.
- **Run in Docker** with appropriate network isolation (the default `docker compose` setup does this).
- **Restrict database access** — don't expose PostgreSQL to the network.
- **Review agent activity** — check the conversation history and Gitea audit logs periodically.
- **Set a cost budget** — use Gigi's built-in token tracking to cap spending and prevent runaway loops.

### Reporting vulnerabilities

If you discover a security issue, please open a private issue or contact the maintainers directly rather than posting publicly.

## License

GPL-2.0
