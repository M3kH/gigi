# Gigi — Self-Extending AI Workspace

## Vision

Gigi is a self-extending AI development environment. Each instance has a `gigi` repo in its org that serves as Gigi's own configuration, skills, and tools. Gigi can modify this repo himself — extending his own capabilities at runtime.

On top of that, Gigi has three runtime capabilities: sandboxed code execution, a persistent embedded browser, and a Docker manager. Together these let Gigi build, deploy, verify, and debug autonomously — without requiring the user to keep a browser tab open.

## The `gigi` Repo (Self-Extension)

Each Gigi org contains a `gigi` repository — Gigi's "dotfiles":

```
idea/gigi
  ├── CLAUDE.md          # System prompt extensions, personality, project context
  ├── skills/            # Custom skills (task-specific workflows)
  └── mcp/               # MCP server definitions (extend Gigi's tool capabilities)
```

- **CLAUDE.md** — Personality, preferences, project-specific instructions. Gigi reads this on every conversation. User edits it directly or asks Gigi to update it.
- **skills/** — Custom skills like debugging workflows, deploy checklists, code review steps. Same format as superpowers skills.
- **mcp/** — MCP server configs that give Gigi new tools. Most powerful extension point — add a Slack MCP and Gigi can post to Slack. Add a monitoring MCP and Gigi can check service health.

### Sandbox Requirements

Code from this repo runs in a sandbox:
- No access to host secrets (unless explicitly granted)
- Cannot crash the main Gigi process
- Resource limits (CPU, memory, time)
- Network access controlled (can reach Gitea API, can't reach arbitrary internet unless configured)

Implementation: each MCP server runs in its own container or V8 isolate. Skills are prompt templates — no execution risk. CLAUDE.md is just text injected into the system prompt.

## Embedded Browser (Chrome + CDP)

A persistent Chrome browser running in a custom container, accessible to both Gigi and the user.

### Why Not Iframe

The current iframe approach requires the user to keep a browser tab open for Gigi to "see" the UI. This is fundamentally limiting:

- User closes the tab → Gigi is blind
- Gigi can't inspect console errors
- Gigi can't run e2e tests
- Gigi can't verify visual output

### Chrome as Gigi's Eyes

With our Chrome container, the browser is **server-side and always running**. Gigi connects to it via Chrome DevTools Protocol (CDP) through the chrome-devtools MCP server, the user watches via noVNC.

**Gigi's autonomous loop:**
1. Write code
2. Deploy to a container
3. Open the URL in the shared browser
4. Inspect DOM, read console.error, take screenshots
5. Fix issues
6. Verify the fix visually
7. Run e2e tests against the live browser
8. Close the ticket only when verified

**User's experience:**
- See what Gigi sees in real-time (noVNC streams the browser)
- Take over control at any time (shared mouse/keyboard)
- User closes their tab — Gigi keeps working
- User reopens — picks up exactly where Gigi is

### Integration

- Chrome runs as a sidecar container alongside Gigi
- Gigi controls it via CDP through the chrome-devtools MCP server
- User views it via noVNC stream embedded in the Gigi UI
- Replace or augment the current Gitea iframe with the browser view when debugging UI

## Docker Manager

Gigi can spin up, manage, and tear down containers for what he's building.

### Capabilities

- **Run containers** — Deploy built artifacts, expose ports
- **Expose URLs** — Auto-generate URLs for running services, open them in the shared browser
- **Stream logs** — Real-time container log output
- **Terminal access** — xterm.js shell into any running container
- **Lifecycle management** — Start, stop, restart, remove containers
- **Resource monitoring** — CPU/memory per container

### UI Components

```
Docker Manager Panel
  ├── Container list (name, status, ports, uptime)
  ├── Per-container actions (start/stop/restart/remove)
  ├── Log viewer (streaming, per-container)
  ├── Terminal (xterm.js, per-container)
  └── URL list (clickable, opens in shared browser or new tab)
```

### How Gigi Uses It

Via MCP tools (or built-in tools):
- `docker_run` — Start a container from an image or Dockerfile
- `docker_logs` — Read container logs
- `docker_exec` — Run commands in a container
- `docker_stop` — Stop a container
- `docker_list` — List running containers

Example flow:
1. User: "Build me a REST API for managing todos"
2. Gigi writes the code, creates a Dockerfile
3. Gigi runs `docker_run` to build and start it
4. Gigi opens `http://localhost:8080` in the shared browser
5. Gigi runs e2e tests against the live API
6. Gigi opens the swagger UI in the shared browser, screenshots it
7. User sees the running API in the Docker manager panel
8. User can open a terminal into the container, check logs, or view in the browser

## Architecture Summary

```
┌─────────────────────────────────────────────────┐
│  Gigi Instance                                  │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Gigi    │  │  Gitea   │  │  Postgres    │  │
│  │  Backend │  │          │  │              │  │
│  └────┬─────┘  └──────────┘  └──────────────┘  │
│       │                                         │
│       ├── reads idea/gigi repo (CLAUDE.md,      │
│       │   skills/, mcp/)                        │
│       │                                         │
│       ├── controls ──┐                          │
│       │              ▼                          │
│       │   ┌──────────────┐                      │
│       │   │  Chrome      │ ← user watches via   │
│       │   │  (browser)   │   noVNC stream       │
│       │   └──────────────┘                      │
│       │                                         │
│       ├── manages ───┐                          │
│       │              ▼                          │
│       │   ┌──────────────┐                      │
│       │   │  User        │ ← containers Gigi    │
│       │   │  Containers  │   builds & deploys   │
│       │   └──────────────┘                      │
│       │                                         │
│       └── runs ──────┐                          │
│                      ▼                          │
│          ┌──────────────┐                       │
│          │  MCP Servers  │ ← from idea/gigi/mcp │
│          │  (sandboxed)  │                      │
│          └──────────────┘                       │
└─────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Self-Extension Basics
- Gigi reads `idea/gigi/CLAUDE.md` on conversation start (inject into system prompt)
- Gigi can edit the repo via existing git tools
- Skills loaded from `idea/gigi/skills/`

### Phase 2: Embedded Browser
- Chrome sidecar container in docker-compose (Xvfb + Chrome + noVNC)
- CDP connection from Gigi backend via chrome-devtools MCP server
- noVNC stream embedded in Gigi UI (replace or alongside Gitea iframe)
- Browser tools: `navigate_page`, `take_screenshot`, `evaluate_script`, etc.

### Phase 3: Docker Manager
- Docker socket access (controlled) for Gigi backend
- MCP tools: `docker_run`, `docker_logs`, `docker_exec`, `docker_stop`
- UI panel: container list, logs, xterm.js terminal
- Auto-URL exposure for running services

### Phase 4: Sandboxed MCP
- MCP server definitions in `idea/gigi/mcp/`
- Each MCP server runs in its own container
- Secret injection via explicit configuration (not ambient)
- Hot-reload when repo changes

## Key Principle

**Every runtime capability is Gigi-first, user-visible second.**

The browser, the Docker manager, the logs — these are Gigi's senses, not just UI panels. Gigi reads container logs to catch errors. Gigi checks the browser console to debug frontend issues. Gigi restarts crashed services. The user gets a real-time window into all of this, but Gigi operates autonomously whether the user is watching or not.

| Capability | Gigi uses it to... | User sees... |
|------------|-------------------|--------------|
| Chrome browser (CDP) | Inspect DOM, read console.error, screenshot, e2e test | Live browser stream (noVNC), can take over |
| Docker manager | Read logs, spot errors, restart services, check health | Container list, log viewer, terminal |
| MCP extensions | Gain new tools at runtime (Slack, monitoring, etc.) | Extended capabilities in chat |
| Self-extension repo | Update his own personality, skills, tools | Changes in idea/gigi repo |

Gigi is not a chat assistant with tools. He's an **autonomous developer with his own browser, his own containers, and the ability to extend himself**. The user watches, guides, and takes over when needed — but Gigi can close the loop independently.
