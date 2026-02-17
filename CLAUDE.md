# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Gigi

Gigi is a persistent AI coordinator running 24/7 on a compute cluster. It manages infrastructure, coordinates agents, tracks issues, and communicates with the operator via Telegram and a real-time web UI.

## Architecture

- **Runtime**: Node.js 22, Docker Swarm, ARM64
- **Language**: TypeScript (strict mode)
- **Framework**: Hono (HTTP/WebSocket), grammY (Telegram)
- **Agent**: Claude Agent SDK with MCP tools, OAuth token auth
- **Database**: PostgreSQL — config, conversations, messages, task context
- **Frontend**: Svelte 5 (runes mode) + Vite
- **Entry point**: `src/index.ts` → starts HTTP server + Telegram bot + backup scheduler

### Directory Structure

```
lib/                     # Core TypeScript modules
├── core/                # Agent, router, store, protocol, events, enforcer
├── api/                 # HTTP routes, webhooks, Telegram, Gitea proxy
├── api-gitea/           # Typed Gitea API client
├── domain/              # Business logic (issues, projects, setup)
├── tools/               # MCP tool implementations
└── backup/              # Repository backup/mirror system

web/app/                 # Svelte 5 frontend
├── components/          # AppShell, panels, chat, dashboard, detail views
├── lib/stores/          # Svelte 5 rune stores (chat, panels, navigation, kanban)
├── lib/services/        # WebSocket client, chat API
├── lib/utils/           # Formatting, markdown, link interception
└── lib/types/           # TypeScript types

src/                     # Server bootstrap
├── index.ts             # Main entry: HTTP + Telegram + enforcer + backup
└── server.ts            # WebSocket server management

.agents/                 # Agent persona definitions
tests/                   # Test suite
docs/                    # Documentation
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `lib/core/agent.ts` | Claude Agent SDK loop with system prompt, MCP server config |
| `lib/core/router.ts` | Routes messages (web/telegram/webhook) → agent, session management |
| `lib/core/store.ts` | PostgreSQL persistence — config, conversations, messages |
| `lib/core/enforcer.ts` | Task completion tracking — detects code changes, enforces PR loop |
| `lib/core/protocol.ts` | Zod schemas for WebSocket client↔server messages |
| `lib/core/events.ts` | Event bus for real-time UI updates |
| `lib/core/mcp.ts` | MCP server bridging tool registry → Claude Agent SDK |
| `lib/api/web.ts` | Hono HTTP routes — health, setup, conversations, webhooks |
| `lib/api/webhookRouter.ts` | Gitea webhook → chat routing, @gigi mention handler |
| `lib/api/telegram.ts` | grammY bot — polling mode, message routing |
| `lib/domain/projects.ts` | Project board management, label sync |
| `lib/tools/gitea.ts` | Gitea API tool (repos, issues, PRs, comments) |
| `lib/tools/telegram.ts` | Telegram send tool |
| `lib/tools/ask-user.ts` | Interactive question tool (blocks until answered) |

### Tools Available to the Agent

The agent runs via Claude Agent SDK with these MCP tools:

| Tool | Description |
|------|-------------|
| `gitea` | Gitea API — repos, issues, PRs, comments, labels |
| `ask_user` | Ask operator a question via web UI (blocks until answered) |
| `telegram_send` | Send Telegram notifications |
| `navigate_page` | Browser automation — navigate URLs |
| `take_screenshot` | Capture browser page |
| `evaluate_script` | Run JavaScript in browser page |
| Plus standard | `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep` |

## Commands

```bash
npm start          # Start server (production)
npm run dev        # Start with --watch (development)
npm test           # Run test suite
```

## CI/CD

`.gitea/workflows/build.yml`:
1. rsync source to cluster manager node
2. `docker-compose build` natively on ARM64
3. Push images to Gitea container registry
4. `docker stack deploy` with docker-compose.yml
5. Deploy Caddyfile via `deploy-site` action

## Self-modification Workflow

Gigi can create PRs on its own repo:
1. Clone to `/workspace/gigi` via git
2. Create branch, edit files
3. Commit and push (Gitea credentials auto-configured)
4. Create PR via gitea tool (include "Closes #N" in body)
5. Update issue status labels via Gitea API
6. Notify operator on Telegram with PR link

## Project Board Workflow

All issues are tracked on the project board.

### Issue State Management (CRITICAL)

When working on issues, ALWAYS update the status:
- **Starting work**: Add `status/in-progress` label, remove `status/ready`
- **Creating a PR**: Add `status/review` label, remove `status/in-progress`
- **Closing/merging**: Add `status/done` label, remove `status/review`

Use the gitea tool to manage labels:
```
gitea({ action: "edit_issue", owner: "...", repo: "...", number: N, labels: [...] })
```

### Required Labels for New Issues
- **Type**: `type/feature`, `type/bug`, `type/docs`, `type/refactor`
- **Status**: `status/ready`, `status/in-progress`, `status/review`, `status/done`
- **Optional**: `priority/*`, `scope/*`, `size/*`

### Always Link PRs to Issues
Include "Closes #N" in the PR description to auto-close the issue on merge.

## Infrastructure

- Compute cluster with ARM64 nodes, Docker Swarm orchestration
- Gitea for repositories, CI/CD, container registry
- Caddy for reverse proxy with automatic TLS
- PostgreSQL for persistent storage
- Configurable via environment variables and database config

## Conventions

- All source files are TypeScript (strict mode)
- Frontend uses Svelte 5 with runes (`$state`, `$derived`, `$effect`)
- Stores are in `web/app/lib/stores/*.svelte.ts`
- Components follow the panel layout: A (Kanban), B (Sidebar), C (Filters), D (Main), F (Chat)
- MCP tools export `agentTools: AgentTool[]` arrays, collected by registry
- WebSocket protocol uses Zod schemas in `lib/core/protocol.ts`
