# Gigi 2.0 — Gigi as Platform

> The AI-first development environment. Not a git forge with AI bolted on.
> Not an IDE with a chat sidebar. A platform where the AI is a peer.

## The Vision

Gigi is a self-hostable development platform where repositories are **dialogs** between the user and an AI agent. The upstream lives somewhere else (GitHub, GitLab, wherever). Gigi's copy is where the work happens — where the AI reads, writes, tests, deploys, and reports back.

The user sees one unified interface: a kanban board, a chat, a code view, a browser — all connected. The AI sees the same workspace and can navigate it alongside the user.

We're not building a GitHub competitor. We're building the cockpit for AI-assisted development.

---

## Architecture Decision: Gitea as Headless Backend

### Why not fork Gitea/Forgejo?

Forking means inheriting a Go codebase, Go templates, and a UI designed for human-only workflows. We'd spend months fighting the existing architecture to make it AI-native. Instead:

- **Gitea runs as a service** — accessed exclusively via its REST API
- **Our frontend is 100% custom** — not a derivative of Gitea's UI
- **No GPL concerns** — Gitea is MIT, and even if we used Forgejo (GPLv3), API clients are not derivative works (Forgejo explicitly kept their API spec MIT for this reason)
- **Self-hosting** — users run Gitea + Gigi Platform as separate containers, same as today
- **Swappable** — if Forgejo goes AGPL someday, or if a better lightweight forge appears, the backend is an implementation detail

### What Gitea provides (so we don't have to build it)

- Git hosting (repos, branches, tags, commits)
- Pull requests with review, merge strategies
- Issues with labels, milestones
- Project boards (kanban) — exposed via API
- Container registry
- Actions (CI/CD, GitHub Actions compatible)
- Webhooks (repo events, issue events, PR events)
- User management and auth (OAuth2 provider)
- API: comprehensive REST + Swagger spec

### What we build on top

- The entire UI (no Gitea web pages exposed to users)
- Real-time event streaming (SSE/WebSocket)
- AI agent orchestration (multi-conversation, multi-repo)
- Chat ↔ issue/PR linkage
- Shared browser (neko)
- Code editor (Monaco)
- Token/cost tracking
- Onboarding flow
- 24/7 agent scheduling (cron)

---

## Approach: Evolve, Don't Replace

The current Gigi **is** tenant #1 of the platform. She's already running, connected to Gitea, has conversations, tools, the whole loop. We don't start fresh — we grow the platform around her.

### Principles

- **Everything keeps working at every step.** No migration day. No downtime. No "new Gigi" replacing "old Gigi".
- **Scaffold alongside, migrate incrementally.** Add `lib/`, `tsconfig.json`, `vite.config.ts` next to the existing `src/*.js`. Then move modules one by one.
- **Gigi works on her own issues.** Self-modification loop: clone → branch → PR → review → merge. The platform's first project is itself.

### Migration path

1. **Scaffold** — Add TypeScript config (`allowJs: true`), Vite, `lib/` directory structure, `core-protocol` schemas. The existing `src/*.js` and `web/index.html` keep running untouched.

2. **Migrate core** — Move modules one at a time: `src/agent.js` → `lib/core-agent/agent.ts`, `src/store.js` → `lib/core-store/store.ts`, etc. Each move is one PR. Tests stay green.

3. **New frontend** — Vite-built SPA served at `/app` (or takes over `/`). Old `web/index.html` stays until the new UI is feature-complete.

4. **Add auth** — Gitea OAuth2. Self-hosted single-user = auto-login (current behavior). Auth layer exists for when multi-tenant comes.

5. **WebSocket upgrade** — Replace SSE with WebSocket. `lib/core-protocol/` Zod schemas define the contract.

6. **Platform features** — Kanban, editor, browser, cron — each lands as a `lib/feat-*` via its own issue/PR.

### Current modules → lib/ mapping

| Current | Target | Notes |
|---------|--------|-------|
| `src/agent.js` (453 lines) | `lib/core-agent/` | Agent loop, system prompt, structured events — **core of the platform** |
| `src/router.js` (227) | `lib/core-router/` | Message routing — add per-user channels |
| `src/events.js` (10) | `lib/core-events/` | Event bus — add per-user scoping |
| `src/store.js` (274) | `lib/core-store/` | Extend schema for multi-tenant |
| `src/web.js` (235) | `src/server.ts` | Rebuild as typed Hono + WebSocket |
| `src/webhooks.js` (128) | `lib/api-webhooks/` | Keep, add more event types |
| `src/tools/` (~400) | `lib/core-agent/tools/` | MCP tools stay with the agent |
| `src/issue_handler.js` (139) | `lib/domain-projects/` | Merge with project management |
| `src/project_manager.js` (214) | `lib/domain-projects/` | Gitea board management |
| `src/task_enforcer.js` (225) | `lib/core-agent/enforcer.ts` | Keep with agent |
| `src/telegram.js` (173) | `lib/api-telegram/` | Adapt for per-user bots |
| `src/setup.js` (61) | `lib/feat-onboarding/` | Web wizard replaces CLI |
| `src/health.js` (56) | `lib/core-health/` | Keep |
| `web/index.html` | `web/` (Vite SPA) | Gradual rewrite |

### Target structure (inside gigi/)

```
gigi/
├── lib/                       # Flat, fat, discoverable
│   ├── core-agent/            # Agent loop (from src/agent.js)
│   │   ├── agent.ts
│   │   ├── enforcer.ts        # (from src/task_enforcer.js)
│   │   ├── tools/             # MCP tool implementations
│   │   └── agent.test.ts
│   ├── core-protocol/         # Shared message schemas (NEW)
│   │   ├── client.ts          # ClientMessage union
│   │   ├── server.ts          # ServerMessage union
│   │   └── protocol.test.ts
│   ├── core-events/           # Event bus (from src/events.js)
│   │   └── events.ts
│   ├── core-router/           # Message routing (from src/router.js)
│   │   └── router.ts
│   ├── core-store/            # DB layer (from src/store.js)
│   │   ├── store.ts
│   │   ├── schema.sql
│   │   └── store.test.ts
│   ├── core-health/           # Health checks (from src/health.js)
│   │   └── health.ts
│   ├── domain-auth/           # OAuth2 via Gitea (NEW)
│   │   └── auth.ts
│   ├── domain-projects/       # Projects + boards (from src/project_manager.js, issue_handler.js)
│   │   ├── projects.ts
│   │   └── projects.test.ts
│   ├── domain-scheduler/      # Cron jobs (NEW)
│   │   └── scheduler.ts
│   ├── api-gitea/             # Gitea REST client (NEW, extracted from tools)
│   │   ├── gitea.ts
│   │   └── gitea.test.ts
│   ├── api-webhooks/          # Webhook handlers (from src/webhooks.js)
│   │   └── webhooks.ts
│   ├── api-telegram/          # Telegram (from src/telegram.js)
│   │   └── telegram.ts
│   ├── feat-onboarding/       # Setup wizard (from src/setup.js → web)
│   │   ├── onboarding.ts
│   │   └── Onboarding.ts
│   ├── feat-kanban/           # Section A (NEW)
│   │   └── Kanban.ts
│   ├── feat-chat/             # Section B + F (from web/index.html chat)
│   │   ├── ChatList.ts
│   │   └── ChatDialog.ts
│   ├── feat-explorer/         # Section D (NEW)
│   │   └── Explorer.ts
│   ├── feat-editor/           # Monaco (NEW)
│   │   └── Editor.ts
│   ├── feat-browser/          # Neko/WebRTC (from web/browser-control.html)
│   │   └── Browser.ts
│   ├── ui-button/
│   ├── ui-card/
│   ├── ui-modal/
│   └── ui-panel/
├── src/                       # Server entry (migrates to TS incrementally)
│   ├── server.ts              # Hono + WebSocket (replaces web.js)
│   └── index.ts               # Entry point
├── web/                       # Vite SPA (new frontend, built alongside old)
│   ├── index.html
│   └── app.ts
├── docker-compose.yml
├── Dockerfile
├── Caddyfile
├── vite.config.ts
├── tsconfig.json
└── package.json
```

Each `lib/*` is self-contained. Frontend features (`feat-*`, `ui-*`) and backend logic (`core-*`, `domain-*`, `api-*`) coexist in the same flat namespace. Vite resolves `lib/*` imports for the frontend; the server imports them directly.

### Tech stack

**TypeScript, functional, minimal dependencies.**

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Bun (or Node.js 20+ fallback) | Native TS, faster startup, built-in test runner. ARM64 Linux supported. Node as fallback if Bun has edge-case issues on TuringPi. |
| Language | TypeScript | Type checking, Zod for runtime validation |
| HTTP | Hono | Already using, fast, works on both Bun and Node |
| Validation | Zod | Runtime schemas, type inference, API boundary validation |
| API | tRPC-inspired | End-to-end type safety. But primary transport is WebSocket, not HTTP RPC — so likely a thin custom protocol with Zod-validated messages rather than full tRPC. |
| Realtime | WebSocket | Bidirectional: chat, agent events, view control, presence. Replaces SSE. |
| Browser | WebRTC (via Neko) | Video/audio streaming for shared browser. Neko handles the WebRTC layer. |
| Database | PostgreSQL | Already using, shared with Gitea |
| AI | Claude Agent SDK | Already using |
| Git forge | Gitea (MIT) | Already running on cluster, full API |
| Editor | Monaco (CDN) | VS Code's editor, self-contained |
| Frontend | TypeScript + Vite | No framework (or Preact if needed). Vite for HMR + build. |

#### Why WebSocket over SSE

SSE is server→client only. For Gigi 2.0 we need bidirectional:
- **Server→Client:** agent events, view navigation commands, kanban updates, typing indicators
- **Client→Server:** chat messages, view state sync, editor cursor, presence

One WebSocket connection per session replaces both SSE and REST for real-time operations. REST stays for CRUD (create repo, update settings, etc.) where request/response semantics are natural.

#### Why Bun (tentatively)

- Native TypeScript execution (no `tsc` compile step for dev)
- ~3x faster startup than Node
- Built-in test runner (aligns with integration testing preference)
- Built-in SQLite if we ever want local-first features
- `Bun.serve()` with native WebSocket support (no `ws` library needed)
- ARM64 Linux support since Bun 1.0

**Risk:** Bun on ARM64 SBCs (RK3588 on TuringPi) is less battle-tested than Node. Keep Hono as the HTTP layer so we can swap runtimes if needed — Hono runs on both.

#### tRPC-inspired, not tRPC

Full tRPC assumes HTTP request/response. Our primary channel is WebSocket. Instead:

```ts
// Shared message schemas (lib/core-protocol)
const ChatMessage = z.object({
  type: z.literal('chat.send'),
  conversationId: z.number(),
  message: z.string(),
})

const ViewNavigate = z.object({
  type: z.literal('view.navigate'),
  target: z.enum(['issue', 'pr', 'code', 'kanban']),
  id: z.number().optional(),
})

// Union of all client→server messages
const ClientMessage = z.discriminatedUnion('type', [ChatMessage, ViewNavigate, ...])

// Union of all server→client messages
const ServerMessage = z.discriminatedUnion('type', [AgentEvent, ViewCommand, ...])
```

Same end-to-end type safety as tRPC, but over WebSocket with discriminated union message types. The shared schema in `lib/core-protocol` is the contract between frontend and backend.

---

## Onboarding Flow

### 1. Landing → Login/Subscribe

```
GET gigi.ai → landing page
POST /auth/login → OAuth2 (Gitea is the OAuth2 provider)
POST /auth/register → creates Gitea user + platform user
```

For self-hosted: Gitea is the identity provider. The platform authenticates via Gitea's OAuth2.
For SaaS: same flow, Gitea is internal.

### 2. Environment Setup (async)

After login, the user sees:

```
Welcome to Gigi.

We're setting up your workspace...

┌─────────────────────────────────────────┐
│ Do you have repositories to import?     │
│                                         │
│ [GitHub URL]  [GitLab URL]  [Git URL]   │
│                                         │
│ [Import]              [Skip for now]    │
└─────────────────────────────────────────┘
```

**Background (while user browses):**
- Gitea org/user created via API
- Default project board created
- Workspace volume provisioned
- Agent container allocated (or shared pool)

**Import flow:**
- User pastes a repo URL
- Platform creates a Gitea mirror/fork via API
- Clone happens in background, progress shown
- Webhooks auto-configured on the Gitea repo

### 3. Configure AI

```
┌─────────────────────────────────────────┐
│ Connect your AI                         │
│                                         │
│ Claude API Key: [________________]      │
│   ○ Use platform credits instead        │
│                                         │
│ [Next]                                  │
└─────────────────────────────────────────┘
```

For SaaS: platform provides pooled API access (user pays via subscription).
For self-hosted: user provides their own API key.

### 4. Configure Messaging (optional)

```
┌─────────────────────────────────────────┐
│ Connect messaging (optional)            │
│                                         │
│ Telegram: [@botfather → token]          │
│ Slack: [OAuth connect]                  │
│ Discord: [Bot token]                    │
│                                         │
│ [Skip]                    [Finish]      │
└─────────────────────────────────────────┘
```

### 5. → App Layout

---

## App Layout

```
+-----------------------------------------------------------+
| A: Kanban Board (collapsible: full / compact / hidden)    |
|                                                           |
+----------+------------------------------------------------+
| B: Chats | C: Filters / Project Selector                  |
|          |------------------------------------------------|
|          | D: Main View (overview / code / PR / issue)     |
|          |                                                |
|          |                                                |
|          |  +------------------------------------------+  |
|          |  | F: Chat Overlay (expand / compact / hide)|  |
|          |  |                                          |  |
+----------+--+------------------------------------------+--+
```

### Section A — Kanban Board

- **Source:** Gitea project board, fetched and kept in sync via API + webhooks
- **Three states:** full-screen / compact strip (just column headers + counts) / hidden
- **Real-time:** webhook events update cards live (agent moves a ticket → user sees it move)
- **Actions:** create issue, drag between columns, assign to agent, set priority
- **Agent integration:** when the agent starts working on a ticket, the card shows a live indicator
- **Filters:** affected by Section C (project/repo selection, priority filter)

### Section B — Chat List

- Chronologically ordered conversations
- Each shows: title, status badge, repo tag, last message preview, timestamp
- Active conversations show a spinner/pulse
- Click → loads conversation in Section F
- Collapsible (hamburger on mobile)
- **Smart grouping:** by project/repo or flat timeline

### Section C — Filters & Context

- **Project/repo selector:** dropdown or tabs
- **Affects:** A (which board), B (which chats), D (which overview)
- **Filters:** priority, status, assignee (user vs. agent), label
- **Search:** full-text across issues, PRs, chat messages, code
- **Breadcrumb:** shows current context (e.g., `org-press > #21 > PR #7`)

### Section D — Main View

**Default (fresh login):** Overview dashboard
- All projects summary (repos, open issues, PRs, recent activity)
- Agent activity feed (what Gigi did while you were away)
- Statistics: tokens used, cost, issues closed, PRs merged
- Quick actions: "Ask Gigi to...", "Create issue", "Import repo"

**When navigating:**
- **Issue view:** full issue detail, comments, linked chat, AI-suggested actions
- **PR view:** diff viewer, review comments, merge controls, linked chat
- **Code explorer:** file tree + Monaco editor (read/write)
- **Browser view:** neko iframe (shared browser session with agent)
- **Logs/Console:** agent execution logs, CI/CD output

### Section F — Chat Overlay

- **Three states:** expanded (takes D's space) / compact (bottom panel) / hidden
- **Pinned to context:** when viewing issue #21, chat shows the conversation about #21
- **Can be detached:** user manually switches to a different chat
- **Features:**
  - Message stream with tool blocks (collapsible, as already built)
  - "Gigi is thinking..." indicator
  - Token counter per message and per conversation
  - Stop button (abort running agent)
  - Input with file attachment, code snippet, screenshot paste
- **Alternative modes:**
  - Console (shell output, CI logs)
  - Agent log (structured event stream)

---

## Features Deep Dive

### Shared Browser (Agent + User)

- Neko provides the remote browser (chromium, already integrated)
- Agent controls browser via Playwright (headless) or neko API (interactive)
- User watches in real-time via neko's video stream in Section D
- Toggle: "Let Gigi drive" / "I'll drive" / "Co-pilot" (both can interact)
- Use case: debugging a deployed app together, testing UI changes, web scraping

### Code Editor (Monaco)

- Monaco loaded from CDN (or vendored)
- File tree from Gitea API (repo contents endpoint)
- Read/write via Gitea API (create/update file endpoints → auto-commits)
- Agent can open files in the user's editor (with permission)
- Syntax highlighting, diff view, inline comments
- Not a full IDE — for quick edits and review. Heavy lifting done by the agent.

### Agent View Control

The agent can suggest or request UI changes:

```
Agent → SSE event: { type: 'view_navigate', target: 'issue', id: 42 }
Agent → SSE event: { type: 'view_expand', section: 'kanban' }
Agent → SSE event: { type: 'file_open', repo: 'org-press', path: 'src/parser.js', line: 42 }
```

**Permission model:**
- **Ask every time** (default): "Gigi wants to show you issue #42. [Allow] [Deny]"
- **Allow for this session:** toggle in settings
- **Always allow:** persistent preference

### Token Statistics

- Per-message token count (input + output)
- Per-conversation total
- Per-project aggregate
- Daily/weekly/monthly cost breakdown
- Model usage breakdown (which model, how many tokens)
- Stored in DB, shown in overview dashboard and per-chat

### Chat ↔ Issue/PR Linking

Already partially built. Extend:
- Creating an issue from chat ("Gigi, create a ticket for this")
- Auto-linking when agent mentions `#42` or creates a PR
- Bidirectional: issue view shows linked chat, chat shows linked issues
- Webhook: when issue status changes, chat gets notified

### Container Proxy (Agent-Exposed Services)

- Agent can spin up containers (e.g., `docker run -p 8080:80 myapp`)
- Platform auto-creates a reverse proxy route via Caddy API
- User gets a URL: `https://{user}-{service}.gigi.ai` (SaaS) or `https://{service}.cluster.local` (self-hosted)
- Timeout/cleanup: containers auto-stop after inactivity
- Use case: "Gigi, deploy this branch so I can test it"

### CI/CD Integration

- Gitea Actions already compatible with GitHub Actions
- Webhooks notify the platform on pipeline events
- Agent reacts to failures: "Pipeline failed on commit abc123. Error: test_login failed. Let me fix it."
- Agent can trigger pipelines, read logs, suggest fixes
- Pipeline status shown on kanban cards and PR views

### Cron / 24/7 Agent

- User defines scheduled tasks: "Every morning, check for dependency updates"
- Platform runs agent conversations on schedule
- Results posted to chat and/or messaging (Telegram/Slack)
- Use cases:
  - Nightly dependency audit
  - Weekly code review of open PRs
  - Monitor deployed services, fix issues proactively
  - Sync upstream repos, resolve conflicts

### Webhooks (Reactive UI)

All Gitea events flow through webhooks to the platform:

| Event | Platform Reaction |
|-------|-------------------|
| Push | Update code view, notify linked chats |
| Issue created/updated | Update kanban, notify linked chat |
| PR created/merged | Update kanban, notify, trigger agent review |
| Pipeline success/fail | Update status badges, trigger agent fix on failure |
| Release | Update overview dashboard |
| Comment | Notify linked chat |

The UI is **always live.** No polling. Gitea webhook → platform → SSE → browser.

---

## Database Schema (Multi-Tenant)

```sql
-- Users (mirrors Gitea users, extended with platform config)
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    gitea_id    INT UNIQUE NOT NULL,
    username    TEXT UNIQUE NOT NULL,
    email       TEXT,
    api_key     TEXT,           -- encrypted Claude API key (or null for platform credits)
    telegram_token TEXT,        -- encrypted per-user bot token
    preferences JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Projects (maps to Gitea repos)
CREATE TABLE projects (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id),
    gitea_repo_id INT NOT NULL,
    name        TEXT NOT NULL,
    upstream_url TEXT,           -- original repo URL (GitHub, etc.)
    config      JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Conversations (extended from current schema)
CREATE TABLE conversations (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id),
    project_id  INT REFERENCES projects(id),
    session_id  TEXT,
    topic       TEXT,
    status      TEXT DEFAULT 'open',
    tags        TEXT[] DEFAULT '{}',
    linked_issues INT[] DEFAULT '{}',  -- Gitea issue IDs
    linked_prs  INT[] DEFAULT '{}',    -- Gitea PR IDs
    token_count INT DEFAULT 0,
    cost_usd    NUMERIC(10,6) DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Messages (extended from current schema)
CREATE TABLE messages (
    id          SERIAL PRIMARY KEY,
    conversation_id INT REFERENCES conversations(id),
    role        TEXT NOT NULL,
    content     JSONB NOT NULL,
    message_type TEXT DEFAULT 'text',
    tool_calls  JSONB,
    tool_outputs JSONB,
    token_input INT,
    token_output INT,
    model       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Scheduled jobs
CREATE TABLE scheduled_jobs (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id),
    project_id  INT REFERENCES projects(id),
    name        TEXT NOT NULL,
    cron_expr   TEXT NOT NULL,          -- cron expression
    prompt      TEXT NOT NULL,          -- what to tell the agent
    enabled     BOOLEAN DEFAULT true,
    last_run    TIMESTAMPTZ,
    next_run    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Agent sessions (for container/resource tracking)
CREATE TABLE agent_sessions (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id),
    conversation_id INT REFERENCES conversations(id),
    container_id TEXT,
    status      TEXT DEFAULT 'running',
    resources   JSONB DEFAULT '{}',
    started_at  TIMESTAMPTZ DEFAULT now(),
    ended_at    TIMESTAMPTZ
);
```

---

## Deployment Architecture

### Self-Hosted (Docker Compose)

```yaml
services:
  gigi:
    image: gigi-platform:latest
    environment:
      DATABASE_URL: postgresql://...
      GITEA_URL: http://gitea:3000
      GITEA_ADMIN_TOKEN: ...
    ports:
      - "3000:3000"
    networks:
      - internal

  gitea:
    image: gitea/gitea:1.22
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: postgres:5432
    volumes:
      - gitea-data:/data
    networks:
      - internal

  postgres:
    image: postgres:16
    volumes:
      - pg-data:/var/lib/postgresql/data
    networks:
      - internal

  neko:
    image: ghcr.io/m1k1o/neko/chromium
    networks:
      - internal

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    networks:
      - internal
```

One `docker compose up` and you have the full platform.

### SaaS (gigi.ai)

Same stack, but:
- Multi-tenant routing (user isolation via Gitea orgs)
- Shared Gitea instance (one per region) or per-user instances
- Managed neko pool (allocated on demand)
- Stripe billing integration
- Platform-provided AI credits (no API key needed)

---

## Licensing

### The forge: Gitea (MIT)

Gitea has **not** changed its license. It remains MIT. (Forgejo switched to GPLv3 in v9.0, August 2024.)

MIT gives us complete freedom:
- Embed, fork, modify — no obligations beyond including the license notice
- Our custom frontend is not a derivative work
- Even API-only usage has zero GPL concerns (and Gitea isn't GPL anyway)

If we ever want Forgejo features, the API-client architecture means our code has no copyleft obligations regardless (API clients are not derivative works; Forgejo explicitly kept their API spec MIT for interoperability).

### Gigi Platform

Options:
- **MIT or Apache 2.0** for maximum adoption and self-hosting friendliness
- **AGPL** if we want to require SaaS operators to share modifications (Gitea's original approach before going open-core)
- **BSL/SSPL** if we want to prevent competitors from offering it as a service (but this limits community)

**Recommendation:** Start MIT. If the project gains traction and we need a business model, consider dual licensing or an open-core approach (platform MIT, enterprise features proprietary).

### The current Gigi repo

Currently licensed GPL-2.0 in package.json. Since we're starting a new project that extracts modules (and Mauro is the sole author), we can relicense freely.

---

## Competitive Position

No product today combines all four: **git forge + AI agent + project management + real-time collaboration.**

| Product | AI | Git | PM | Collab | Self-host |
|---------|-----|-----|-----|--------|-----------|
| GitHub + Copilot | Good | Yes | Basic | Limited | No |
| GitLab Duo | Moderate | Yes | Strong | Limited | Partial |
| Cursor | Strong | No | No | No | No |
| Claude Code | Strong | No | No | Early | No |
| Devin | Moderate | No | No | Slack | No |
| Replit | Good | Minimal | No | Multiplayer | No |
| **Gigi Platform** | **Strong** | **Yes** | **Yes** | **Yes** | **Yes** |

The closest competitor is GitHub (Copilot + Codespaces + Projects), but it's a constellation of separate products, not a unified experience — and it's entirely proprietary/cloud-locked.

**Our differentiator:** repos are dialogs. The AI is not a sidebar — it's a peer that shares the same workspace, the same board, the same browser. And you can run it on your own hardware.

---

## Implementation Phases

### Phase 0: Scaffold (overnight agent or first PR)

Add the new structure alongside existing code. Nothing breaks.

- [ ] `tsconfig.json` with `allowJs: true` (existing JS keeps working)
- [ ] `vite.config.ts` (frontend build, dev server)
- [ ] `lib/` directory with empty typed modules (index.ts with exports)
- [ ] `lib/core-protocol/` with Zod message schemas (the contract)
- [ ] `web/index.html` (new Vite SPA shell, served at `/app`)
- [ ] Basic Hono WebSocket wiring in new `src/server.ts`
- [ ] Update `Dockerfile` to handle TypeScript (Bun or tsc build step)
- [ ] Integration test scaffold (one test that boots the server)

### Phase 1: Migrate Core (one module per issue)

Move existing modules into `lib/`, converting to TypeScript. Each PR migrates one module. Current functionality stays intact.

- [ ] `src/store.js` → `lib/core-store/store.ts` (+ extend schema)
- [ ] `src/events.js` → `lib/core-events/events.ts` (+ per-user channels)
- [ ] `src/agent.js` → `lib/core-agent/agent.ts` (+ typed events)
- [ ] `src/router.js` → `lib/core-router/router.ts`
- [ ] `src/webhooks.js` → `lib/api-webhooks/webhooks.ts`
- [ ] `src/telegram.js` → `lib/api-telegram/telegram.ts`
- [ ] `src/tools/` → `lib/core-agent/tools/`
- [ ] `src/project_manager.js` + `src/issue_handler.js` → `lib/domain-projects/`
- [ ] `src/web.js` → `src/server.ts` (Hono + WebSocket, replaces SSE)
- [ ] Delete old `src/*.js` files once all migrated

### Phase 2: New Frontend (chat + overview)

Build the new Vite SPA. Old `web/index.html` stays until parity.

- [ ] App shell with layout (A/B/C/D/F sections, resizable panels)
- [ ] WebSocket connection (`lib/core-protocol/` messages)
- [ ] `lib/feat-chat/` — chat list (B) + dialog (F) with tool blocks
- [ ] `lib/feat-explorer/` — overview dashboard (D)
- [ ] Conversation ↔ project linking in UI
- [ ] Dark theme, responsive layout
- [ ] Retire old `web/index.html`

### Phase 3: Project Management

- [ ] `lib/api-gitea/` — typed Gitea REST client
- [ ] `lib/feat-kanban/` — kanban board (Section A, via Gitea project boards)
- [ ] Issue/PR detail views in Section D
- [ ] Webhook → WebSocket pipeline (Gitea event → realtime UI update)
- [ ] Filters and project context (Section C)
- [ ] Chat ↔ issue/PR auto-linking

### Phase 4: Rich Workspace

- [ ] `lib/feat-editor/` — Monaco editor (read/write via Gitea API)
- [ ] `lib/feat-browser/` — neko/WebRTC shared browser (already working, wrap in lib)
- [ ] Agent view control (navigate, expand, open file — with permission model)
- [ ] Container proxy (agent-exposed services via Caddy API)
- [ ] Diff viewer for PRs

### Phase 5: Automation & Auth

- [ ] `lib/domain-auth/` — Gitea OAuth2 (self-hosted = auto-login)
- [ ] `lib/feat-onboarding/` — web setup wizard (replaces CLI)
- [ ] `lib/domain-scheduler/` — cron jobs, 24/7 agent routines
- [ ] CI/CD integration (pipeline status, auto-fix on failure)
- [ ] Token/cost tracking per conversation and per project
- [ ] Telegram/Slack per-user integration

### Phase 6: Platform (when ready for multi-tenant)

- [ ] Multi-user support, user isolation
- [ ] Usage metering and billing
- [ ] Platform-provided AI credits
- [ ] Security hardening
- [ ] Documentation

---

## Practices

### Project Structure: Flat, Fat, Discoverable by Domain

No nested module hierarchies. Everything lives in `lib/` with a clear naming convention:

```
lib/[domain]-[name](?--[variant])
```

| Pattern | Example | What it is |
|---------|---------|-----------|
| `domain-name` | `lib/domain-payments` | Business logic module |
| `feat-name` | `lib/feat-kanban` | Full UI feature |
| `feat-name--variant` | `lib/feat-chat--compact` | Feature variant (A/B, modes) |
| `ui-name` | `lib/ui-button` | Reusable UI component |
| `helper-name` | `lib/helper-date` | Pure utility |
| `core-name` | `lib/core-agent` | Platform core (agent, events) |
| `api-name` | `lib/api-gitea` | External service client |

Each lib is self-contained: its code, its types, its tests, its exports. You find what you need by scanning `lib/`. No treasure hunts through nested directories.

### TypeScript + Zod

TypeScript for type checking. Zod for runtime validation at system boundaries (API input, webhook payloads, config). Types flow end-to-end.

```ts
const CreateConversation = z.object({
  projectId: z.number(),
  message: z.string().min(1),
})

type CreateConversation = z.infer<typeof CreateConversation>
```

No `any`. No `as` casts unless truly unavoidable. Let the types guide the API design — if the types are awkward, the API is wrong.

### Code Style: Functional Composition

```ts
pipe(
  fetchIssues,
  withPriorityFilter('high'),
  withAssigneeFilter(userId),
  toKanbanColumns
)
```

- Functions compose. Data flows through pipes.
- No classes unless the domain demands it (e.g., WebSocket connections).
- State lives in the store, not in objects.
- Side effects are explicit and pushed to the edges.

### Build: Simple Vite

Vite for the frontend. No elaborate webpack configs, no custom plugins, no framework magic.

- `vite dev` for development with HMR
- `vite build` for production
- `vite preview` for local production preview
- Config should fit on one screen

### Testing: Integration First

**Preferred:** Integration tests that exercise real module boundaries.

```js
// Good: tests the actual flow
test('creating a conversation links it to the project', async () => {
  const project = await createProject(user, { name: 'test-repo' })
  const conv = await startConversation(user, { projectId: project.id, message: 'fix the login bug' })
  const loaded = await getConversation(conv.id)
  assert.equal(loaded.project_id, project.id)
})
```

**Avoid:**
- Browser e2e in the pipeline (slow, flaky). Gigi herself can run e2e scripts via neko for manual/scheduled verification.
- Unit tests for trivial functions that are only tested, never used elsewhere.
- Mocks that replicate half the system — test the real thing or don't test it.

**Coverage:** track it, but don't worship it. A function that exists only to be tested has no reason to exist. If coverage is low, the question is "is the API surface clean?" not "do we need more tests?"

### Agent-Callable by Default

Every `lib/` module's public API should be callable by the agent. Gigi is a platform participant, not just a chat responder.

Convention: any module that wants to expose functions to the agent exports `agentTools`:

```ts
// lib/feat-kanban/index.ts
export const moveCard = (cardId: number, column: string) => { ... }

export const agentTools: AgentTool[] = [
  { name: 'kanban.move_card', description: 'Move a card to a column', schema: MoveCardSchema, handler: moveCard },
]
```

The tool registry scans all `lib/*/index.ts` for `agentTools` at startup and registers them with the MCP server. Same functions power both the UI and the agent — one API, two consumers.

UI control tools (navigate, expand, open file) emit WebSocket events with a permission model: ask every time (default), allow for session, or always allow.

### Boy Scout Principle

> Don't leave for tomorrow what you can do today. Don't sidetrack, but improve along the way.

- If you touch a file, leave it better than you found it.
- If a function name is misleading, rename it now.
- If there's dead code, remove it now.
- If the types are wrong, fix them now.
- But don't refactor the whole module when you came to fix a bug. Improve *along the path*, not orthogonal to it.

### Quality over Quantity

The measure of the codebase:

1. **Is the API clean and concise?** — If the public surface reads well, the internals follow.
2. **Does the structure self-document?** — `lib/feat-kanban` tells you what it is. No README needed.
3. **Do the tests describe behavior?** — Tests are the spec. If the tests read like requirements, we're solid.

If these three hold, the product is solid. Everything else is secondary.

---

## Open Questions

1. **Frontend framework or vanilla JS?** Vite as the build tool is decided. The question is whether we need a view library (Preact, Lit, web components) or stay vanilla JS with manual DOM. The `lib/` structure works either way — each `ui-*` or `feat-*` module exports its own render logic.

2. **One Gitea per user or shared instance?** Shared is simpler operationally. Per-user gives better isolation. For self-hosted single-user, it's the same Gitea instance. For SaaS, shared instance with org-based isolation is likely sufficient.

3. **Agent per user or shared pool?** For self-hosted: one agent. For SaaS: pool of agent workers processing a job queue. The agent core is stateless (conversations are in DB), so this is a deployment concern, not an architecture one.

4. **Monaco loading strategy?** CDN for SaaS, vendored for self-hosted. Monaco is ~2MB gzipped — acceptable for a development platform.

5. **Neko scaling?** One neko instance per active browser session? Shared pool? For self-hosted single-user, one instance (current approach). For SaaS, on-demand allocation from a pool.
