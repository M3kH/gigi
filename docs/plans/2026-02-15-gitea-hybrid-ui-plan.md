# Gitea Hybrid UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Embed Gitea's web pages (issues, PRs, code explorer, settings) inside the Gigi SPA via iframe in Section D, stripping Gitea's chrome so it looks native.

**Architecture:** Caddy proxies `/gitea/*` to the internal Gitea instance. The SPA router decides whether Section D renders a custom component (dashboard, chat, kanban, editor, browser) or an iframe pointing to a Gitea page. Gitea's header/footer are removed via custom templates. A postMessage bridge enables bidirectional communication between the SPA and iframe.

**Tech Stack:** Svelte 5 SPA (existing), Hono backend (existing), Gitea custom templates, Caddy reverse proxy, TypeScript.

**Design doc:** `docs/plans/2026-02-15-gitea-hybrid-ui-design.md`

---

## Task 1: Gitea Custom Templates — Strip Chrome

**Files:**
- Create: `gitea/custom/templates/base/head_navbar.tmpl`
- Create: `gitea/custom/templates/base/footer.tmpl`
- Create: `gitea/custom/templates/custom/header.tmpl`
- Create: `gitea/custom/templates/custom/extra_links.tmpl`

Store Gitea template overrides in the repo under `gitea/custom/` so they're versioned and mountable.

**Step 1: Create empty head_navbar template**

```
gitea/custom/templates/base/head_navbar.tmpl
```

```html
{{/* Stripped: Gigi platform wraps Gitea in an iframe */}}
```

This removes Gitea's top navigation bar entirely.

**Step 2: Create empty footer template**

```
gitea/custom/templates/base/footer.tmpl
```

```html
{{/* Stripped: Gigi platform provides its own layout */}}
```

**Step 3: Create custom header with bridge script**

```
gitea/custom/templates/custom/header.tmpl
```

```html
<script>
(function() {
  // Gigi-Gitea postMessage bridge
  // Only activate when loaded inside an iframe
  if (window.self === window.top) return;

  // Notify parent of page load
  window.parent.postMessage({
    type: 'gitea:loaded',
    path: window.location.pathname,
    title: document.title
  }, '*');

  // Intercept link clicks for SPA navigation
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    // External links open in new tab
    if (href.startsWith('http') && !href.includes(window.location.host)) {
      link.target = '_blank';
      return;
    }
  });

  // Listen for commands from parent SPA
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'gigi:scrollTo') {
      var el = document.querySelector(e.data.selector);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (e.data.type === 'gigi:getHeight') {
      window.parent.postMessage({
        type: 'gitea:height',
        height: document.documentElement.scrollHeight
      }, '*');
    }
  });
})();
</script>
```

**Step 4: Create extra_links with CSS overrides**

```
gitea/custom/templates/custom/extra_links.tmpl
```

```html
<style>
  /* When in iframe, content fills the viewport */
  body {
    margin: 0 !important;
    padding: 0 !important;
  }

  /* Hide any remaining navigation elements */
  .ui.secondary.menu.no-horizontal-scrollbar,
  .page-footer,
  #navbar {
    display: none !important;
  }

  /* Content area takes full width */
  .page-content {
    padding-top: 0 !important;
    width: 100% !important;
  }

  .page-content > .ui.container {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 8px 16px !important;
  }
</style>
```

**Step 5: Commit**

```bash
git add gitea/custom/
git commit -m "feat: add Gitea custom templates to strip chrome for iframe embedding"
```

---

## Task 2: Mount Custom Templates in Docker Compose

**Files:**
- Modify: `docker-compose.local.yml` (gitea service volumes)

**Step 1: Add volume mount for custom templates**

In `docker-compose.local.yml`, add a volume to the `gitea` service:

```yaml
    volumes:
      - gitea-data:/data
      - ./gitea/custom/templates:/data/gitea/templates:ro
```

This mounts the custom templates into Gitea's expected path.

**Step 2: Verify Gitea picks up the templates**

Run: `docker compose -f docker-compose.local.yml up gitea -d`
Run: `curl -s http://localhost:3000/idea/gigi | grep -c 'navbar'`
Expected: `0` (navbar is gone)

**Step 3: Commit**

```bash
git add docker-compose.local.yml
git commit -m "feat: mount Gitea custom templates in local dev compose"
```

---

## Task 3: Add Caddy Route for Gitea Proxy

**Files:**
- Modify: `Caddyfile`

**Step 1: Add /gitea/* reverse proxy route**

Add a new matcher and handler to the `claude.cluster.local` block in `Caddyfile`, **before** the main catch-all `reverse_proxy`:

```caddy
	# Gitea UI proxy (iframe embedding)
	@gitea {
		path /gitea/*
	}
	handle @gitea {
		uri strip_prefix /gitea
		reverse_proxy idea-biancifiore-gigi_gitea:3000
	}
```

This strips the `/gitea` prefix and forwards to Gitea. So `/gitea/idea/gigi/issues/42` becomes `/idea/gigi/issues/42` on Gitea.

For local dev, we need the same in the Vite proxy config.

**Step 2: Add Vite dev proxy for /gitea**

In `vite.config.ts`, add to the `server.proxy` section:

```ts
      '/gitea': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/gitea/, ''),
      },
```

**Step 3: Verify proxy works**

Run Vite dev: `cd web/app && npx vite`
Open: `http://localhost:5173/gitea/idea/gigi`
Expected: Gitea repo page renders without header/footer

**Step 4: Commit**

```bash
git add Caddyfile vite.config.ts
git commit -m "feat: add Caddy and Vite proxy routes for Gitea iframe"
```

---

## Task 4: Add `gitea-iframe` View Type to Navigation Store

**Files:**
- Modify: `web/app/lib/stores/navigation.svelte.ts`

**Step 1: Extend ViewType and NavigationTarget**

Add `'gitea'` to the `ViewType` union and add a `giteaPath` field:

```ts
export type ViewType = 'overview' | 'issue' | 'pull' | 'repo' | 'gitea'

export interface NavigationTarget {
  view: ViewType
  owner?: string
  repo?: string
  number?: number
  giteaPath?: string  // full path for iframe src, e.g. '/gitea/idea/gigi/issues/42'
}
```

**Step 2: Add navigateToGitea helper**

```ts
export function navigateToGitea(path: string): void {
  navigate({ view: 'gitea', giteaPath: `/gitea${path}` })
}
```

**Step 3: Update navigateToIssue, navigateToPull, navigateToRepo to use Gitea iframe**

Replace the existing helpers to route through the iframe instead of custom components:

```ts
export function navigateToIssue(owner: string, repo: string, number: number): void {
  navigate({ view: 'gitea', owner, repo, number, giteaPath: `/gitea/${owner}/${repo}/issues/${number}` })
}

export function navigateToPull(owner: string, repo: string, number: number): void {
  navigate({ view: 'gitea', owner, repo, number, giteaPath: `/gitea/${owner}/${repo}/pulls/${number}` })
}

export function navigateToRepo(owner: string, repo: string): void {
  navigate({ view: 'gitea', owner, repo, giteaPath: `/gitea/${owner}/${repo}` })
}
```

**Step 4: Commit**

```bash
git add web/app/lib/stores/navigation.svelte.ts
git commit -m "feat: add gitea iframe view type to navigation store"
```

---

## Task 5: Create GiteaFrame Component

**Files:**
- Create: `web/app/components/GiteaFrame.svelte`

**Step 1: Create the iframe wrapper component**

```svelte
<script lang="ts">
  /**
   * GiteaFrame — Renders a Gitea page inside Section D via iframe
   *
   * Handles:
   * - Loading state
   * - postMessage bridge (listen for Gitea events)
   * - Navigation sync (update SPA route when iframe navigates)
   * - Forward commands to iframe (scrollTo, etc.)
   */

  import { navigate } from '$lib/stores/navigation.svelte'
  import { onMount } from 'svelte'

  interface Props {
    src: string
  }

  let { src }: Props = $props()

  let iframe: HTMLIFrameElement
  let loading = $state(true)

  onMount(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data?.type?.startsWith('gitea:')) return

      if (e.data.type === 'gitea:loaded') {
        loading = false
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  })

  function onIframeLoad() {
    loading = false
  }
</script>

<div class="gitea-frame-wrapper">
  {#if loading}
    <div class="gitea-frame-loading">Loading...</div>
  {/if}
  <iframe
    bind:this={iframe}
    {src}
    title="Gitea"
    class="gitea-frame"
    class:loaded={!loading}
    onload={onIframeLoad}
  ></iframe>
</div>

<style>
  .gitea-frame-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .gitea-frame {
    width: 100%;
    height: 100%;
    border: none;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .gitea-frame.loaded {
    opacity: 1;
  }

  .gitea-frame-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-sm);
  }
</style>
```

**Step 2: Commit**

```bash
git add web/app/components/GiteaFrame.svelte
git commit -m "feat: add GiteaFrame iframe wrapper component"
```

---

## Task 6: Wire GiteaFrame into GigiMainView

**Files:**
- Modify: `web/app/components/GigiMainView.svelte`

**Step 1: Replace custom detail components with GiteaFrame**

Update `GigiMainView.svelte` to render the iframe for `gitea` views:

```svelte
<script lang="ts">
  /**
   * Section D: Main content area — View router
   *
   * Routes between:
   * - overview: Dashboard with repo summaries, stats, activity
   * - gitea: Gitea page rendered in iframe (issues, PRs, code explorer)
   */

  import { getCurrentView } from '$lib/stores/navigation.svelte'
  import OverviewDashboard from '$components/dashboard/OverviewDashboard.svelte'
  import GiteaFrame from '$components/GiteaFrame.svelte'

  const view = $derived(getCurrentView())
</script>

<main class="gigi-main-view">
  {#if view.view === 'overview'}
    <OverviewDashboard />
  {:else if view.view === 'gitea' && view.giteaPath}
    {#key view.giteaPath}
      <GiteaFrame src={view.giteaPath} />
    {/key}
  {/if}
</main>

<style>
  .gigi-main-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-primary);
    overflow: hidden;
  }
</style>
```

The old `IssueDetail`, `PullDetail`, and `RepoExplorer` imports are removed. These components can stay in the codebase for now (don't delete) — they may be useful as reference or fallback.

**Step 2: Verify the dashboard still renders**

Run: `npx vite --config vite.config.ts`
Open: `http://localhost:5173`
Expected: Overview dashboard renders as before

**Step 3: Commit**

```bash
git add web/app/components/GigiMainView.svelte
git commit -m "feat: route issue/PR/repo views through Gitea iframe in Section D"
```

---

## Task 7: End-to-End Smoke Test

**Files:** None (manual verification)

**Step 1: Start the full local stack**

```bash
docker compose -f docker-compose.local.yml up gitea postgres init -d
```

Wait for init to complete.

**Step 2: Start Vite dev server**

```bash
npx vite --config vite.config.ts
```

**Step 3: Verify Gitea chrome stripping**

Open: `http://localhost:3000/idea/gigi` (direct Gitea)
Expected: No header, no footer, content fills page, bridge script loaded

**Step 4: Verify iframe proxy**

Open: `http://localhost:5173/gitea/idea/gigi`
Expected: Same stripped page, served through Vite proxy

**Step 5: Verify SPA iframe embedding**

In the SPA at `http://localhost:5173`:
1. Click a repo in the dashboard
2. Section D should show the Gitea repo page in an iframe
3. Kanban (A), chat sidebar (B), filters (C), and chat overlay (F) remain visible
4. Click an issue link inside the iframe — iframe navigates, SPA shell stays

**Step 6: Document any CSS/layout issues**

Note anything that needs tweaking in the custom templates (spacing, colors, elements still showing). Create follow-up issues as needed.

**Step 7: Commit any template tweaks**

```bash
git add gitea/custom/
git commit -m "fix: adjust Gitea template CSS after smoke test"
```

---

## Task 8: Update docker-compose.yml (Production)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Caddyfile`

**Step 1: Add template volume mount to production gitea service**

Add the same volume mount as local dev, plus ensure Caddy has the `/gitea/*` route.

**Step 2: Verify Caddyfile changes from Task 3 work in production context**

The Caddy route needs to reference the correct Docker service name for Gitea in production.

**Step 3: Commit**

```bash
git add docker-compose.yml Caddyfile
git commit -m "feat: add Gitea iframe proxy to production deployment"
```

---

## Summary

| Task | What | Estimated Scope |
|------|------|----------------|
| 1 | Custom templates (strip chrome + bridge script) | 4 files, ~60 lines |
| 2 | Mount templates in docker-compose.local.yml | 1 line change |
| 3 | Caddy + Vite proxy routes | 2 files, ~10 lines each |
| 4 | Navigation store — add `gitea` view type | 1 file, ~15 lines changed |
| 5 | GiteaFrame.svelte component | 1 new file, ~80 lines |
| 6 | Wire into GigiMainView | 1 file, simplified |
| 7 | Smoke test | Manual verification |
| 8 | Production deployment config | 2 files |

After this plan: issue/PR/code views render via Gitea iframe inside Section D. The SPA shell (kanban, chats, filters, chat overlay) remains fully custom and always visible.
