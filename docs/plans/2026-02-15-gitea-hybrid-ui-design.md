# Gitea Hybrid UI — Design Document

> Date: 2026-02-15
> Status: Approved
> Supersedes: Parts of PLATFORM.md Section "Architecture Decision: Gitea as Headless Backend"

## Context

PLATFORM.md proposed a 100% custom frontend with Gitea used purely as a headless API backend. This design revises that: instead of rebuilding every UI from scratch, we embed Gitea's battle-tested views (issues, PRs, code explorer, settings) inside our SPA via iframe, and build custom views only where AI-native behavior is needed.

The motivation: Gitea already has excellent issue pages, PR diff viewers, code explorers, and settings UIs. Rebuilding them from scratch via API costs months and produces an inferior version. The custom parts — chat, kanban, dashboard, editor, browser — are where the product differentiates.

## Architecture

### Two Apps, One Proxy

```
User <-- HTTPS --> Caddy
                     |
                     +--> Gigi App (Hono + Vite SPA)  -- always serves the shell
                     |
                     +--> Gitea (internal only, stripped chrome)
                          accessed via iframe or /gitea-proxy/*
```

- **Gigi App** owns all user-facing URLs. Every request goes through the SPA.
- **Gitea** is internal-only. Not directly accessible to the user.
- **Caddy** routes `/gitea/*` to Gitea for iframe/proxy access. Everything else to Gigi app.

### SPA Layout

```
+-----------------------------------------------------------+
| A: Kanban Board (Gigi SPA)            collapsible          |
+----------+------------------------------------------------+
| B: Chats | C: Filters / Breadcrumb (Gigi SPA)             |
| (Gigi)   |------------------------------------------------|
|          | D: Content Area                                  |
|          |    - Custom component (dashboard/editor/browser) |
|          |    - OR iframe -> Gitea page (stripped chrome)   |
|          |                                                  |
|          |  +-------------------------------------------+   |
|          |  | F: Chat Overlay (Gigi SPA)                |   |
+----------+--+-------------------------------------------+--+
```

Section D is the only area that changes. Everything else is persistent.

### Routing

All URLs are owned by the SPA. The SPA router decides what to render in Section D:

| URL pattern | Section D renders |
|---|---|
| `/` | Custom dashboard (overview, agent activity, stats) |
| `/chat`, `/chat/:id` | Custom chat (expanded in D) |
| `/kanban` | Custom kanban (expanded in D) |
| `/editor/:repo/*` | Custom Monaco editor |
| `/browser` | Custom neko/WebRTC |
| `/:owner/:repo` | iframe -> Gitea code explorer |
| `/:owner/:repo/issues/:id` | iframe -> Gitea issue view |
| `/:owner/:repo/pulls/:id` | iframe -> Gitea PR/diff view |
| `/:owner/:repo/settings` | iframe -> Gitea settings |

### iframe Strategy

Start with a plain iframe for simplicity:

```html
<iframe
  id="section-d-gitea"
  src="/gitea/{owner}/{repo}/issues/{id}"
  style="width: 100%; height: 100%; border: none;"
/>
```

Same Caddy origin means shared cookies, no cross-origin issues.

**Future evolution path:**
1. **iframe** (now) — simplest, proves the concept
2. **srcdoc + proxy** (later) — fetch HTML server-side, strip chrome, inject via `srcdoc` for tighter control
3. **direct DOM injection** (if ever needed) — fetch and inject into SPA DOM, requires script isolation (shadow DOM or cleanup)

### Gitea Chrome Stripping

Gitea's custom template system (`custom/templates/`):

- **`base/head_navbar.tmpl`** — empty (removes top nav)
- **`base/footer.tmpl`** — empty (removes footer)
- **`extra_links.tmpl`** — inject CSS overrides:
  - Content area fills viewport (no shell margins)
  - Color scheme matches Gigi app
  - Hide remaining navigation elements
- **`extra_headers.tmpl`** or footer — inject bridge script (see Navigation Sync)

No Gitea fork. No Go code. Survives upgrades.

### Navigation Sync (postMessage Bridge)

A bridge script injected into Gitea pages via custom templates. Bidirectional:

**Gitea -> SPA (outbound):**
- Link clicks that should route to custom views (e.g., chat links in issue comments)
- Navigation events (page loaded, form submitted)
- `parent.postMessage({ type: 'navigate', path: '/chat/42' })`

**SPA -> Gitea (inbound):**
- Scroll to element, highlight section
- Trigger actions programmatically
- `iframe.contentWindow.postMessage({ type: 'scrollTo', selector: '#comment-5' })`

**SPA listens for iframe navigation:**
```ts
iframe.addEventListener('load', () => {
  const path = new URL(iframe.contentWindow.location.href).pathname
  history.replaceState(null, '', path.replace('/gitea', ''))
  updateBreadcrumb(path)
})
```

### Auth

**Self-hosted (single user):**
- Provisioning script creates Gitea user (already implemented)
- OAuth2 auto-login, transparent to user
- User never sees Gitea's login page

**Hosted (gigi.ai, future):**
- User signs up at gigi.ai
- Platform provisions a container/VM at `[user].gigi.ai`
- Platform creates Gitea user automatically
- Gitea is completely invisible to the user
- Onboarding: Name, Repo, Telegram Token, AI key

## What We Build vs What Gitea Provides

### Custom (Gigi SPA)
- Layout shell (A/B/C/D/F panels)
- Dashboard / overview
- Chat list (Section B) + dialog (Section F)
- Kanban board (Section A) — Gitea boards too basic
- Filters / breadcrumb (Section C)
- Monaco editor
- Neko shared browser
- Onboarding wizard
- Token/cost tracking
- Agent orchestration
- WebSocket protocol
- postMessage bridge

### Gitea (iframe in Section D)
- Issue detail + comments
- PR detail + diff viewer
- Code explorer (file tree, blame, history)
- Repo settings
- Org/user settings
- Admin panel
- Release pages
- Wiki
- Commit history

## Impact on PLATFORM.md

| Area | Change |
|---|---|
| Backend migration (Phase 1) | No change |
| Custom frontend (Phase 2) | Reduced scope — skip issue/PR/code views |
| Kanban (Phase 3) | Still custom |
| Chat (Phase 2) | Still custom |
| Editor/Browser (Phase 4) | Still custom |
| Auth (Phase 5) | Simpler — OAuth2, Gitea handles session |
| `lib/` structure | Same |
| Tech stack | Same |
| Agent tools | Same — agent uses Gitea API, not web UI |

**Phase 3 (Project Management) shrinks dramatically.** No need to build issue detail views, PR diff views, code browser, or settings pages.

## Open Items (Future Sessions)

### Gitea Actions & Self-Deployment Loop

Gitea Actions runner is a fundamental piece of the platform. Gigi's own repo lives on the bundled Gitea, and the self-modification loop is:

```
Gigi edits code -> push -> Gitea Actions build -> redeploy
```

This means the bundled Gitea is not optional — it's core platform infrastructure, not just a UI convenience. Dedicated design session needed.

### "Bring Your Own Gitea" vs Bundled

The architecture supports both (`GITEA_URL` config), but chrome-stripping and custom templates assume a Gitea you control. A federation model (external Gitea <-> Gigi's bundled Gitea) is possible but needs its own design.

### Gitea Version Pinning

Since we depend on template names and HTML structure, we should pin the Gitea version and test upgrades explicitly rather than auto-updating.
