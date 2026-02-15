<script lang="ts">
  /**
   * Section C: Two-row filters bar
   *
   * Row 1 — Menu: sidebar toggle, Overview, Repositories, connection badge
   * Row 2 — Repo filter chips: fetched from /api/gitea/overview
   */
  import type { ConnectionState } from '$lib/services/ws-client'
  import { getPanelState, togglePanel, type PanelState } from '$lib/stores/panels.svelte'
  import { goHome, navigateToGitea, navigateToBrowser, getCurrentView } from '$lib/stores/navigation.svelte'
  import { onMount } from 'svelte'

  interface Props {
    connectionState?: ConnectionState
  }

  const { connectionState = 'disconnected' }: Props = $props()

  const sidebarState: PanelState = $derived(getPanelState('sidebar'))
  const currentView = $derived(getCurrentView())

  // Repo filter chips
  interface RepoSummary {
    name: string
    open_issues_count: number
    open_pr_count: number
  }

  let repos = $state<RepoSummary[]>([])
  let selectedRepo = $state<string | null>(null)
  let filtersExpanded = $state(true)
  let browserAvailable = $state(false)

  onMount(async () => {
    try {
      const res = await fetch('/api/gitea/overview')
      if (res.ok) {
        const data = await res.json()
        repos = data.repos ?? []
      }
    } catch { /* ignore */ }

    try {
      const res = await fetch('/api/browser/status')
      if (res.ok) {
        const data = await res.json()
        browserAvailable = data.available
      }
    } catch { /* ignore */ }
  })

  function handleOverview() {
    goHome()
  }

  function handleRepositories() {
    navigateToGitea('/idea')
  }

  function handleBrowser() {
    navigateToBrowser()
  }

  function handleToggleSidebar() {
    togglePanel('sidebar')
  }

  function selectRepo(name: string | null) {
    selectedRepo = name
  }

  export function getSelectedRepo(): string | null {
    return selectedRepo
  }
</script>

<div class="gigi-filters">
  <!-- Row 1: Menu -->
  <div class="filter-row menu-row">
    {#if sidebarState === 'hidden'}
      <button class="menu-btn" onclick={handleToggleSidebar} title="Show sidebar">
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" fill="currentColor"/>
        </svg>
      </button>
    {/if}

    <button
      class="nav-btn"
      class:active={currentView.view === 'overview'}
      onclick={handleOverview}
    >Overview</button>

    <button
      class="nav-btn"
      class:active={currentView.view === 'gitea'}
      onclick={handleRepositories}
    >Repositories</button>

    {#if browserAvailable}
      <button
        class="nav-btn"
        class:active={currentView.view === 'browser'}
        onclick={handleBrowser}
      >Browser</button>
    {/if}

    <div class="filter-spacer"></div>

    <div class="connection-badge" title="WebSocket: {connectionState}">
      <span
        class="status-dot"
        class:connected={connectionState === 'connected'}
        class:connecting={connectionState === 'connecting' || connectionState === 'reconnecting'}
        class:disconnected={connectionState === 'disconnected'}
      ></span>
    </div>
  </div>

  <!-- Row 2: Repo filter chips -->
  {#if repos.length > 0}
    <div class="filter-row chips-row" class:collapsed={!filtersExpanded}>
      <button
        class="chip"
        class:active={selectedRepo === null}
        onclick={() => selectRepo(null)}
      >All</button>
      {#each repos as repo}
        <button
          class="chip"
          class:active={selectedRepo === repo.name}
          onclick={() => selectRepo(repo.name)}
        >
          {repo.name}
          {#if repo.open_issues_count > 0}
            <span class="chip-count">{repo.open_issues_count}</span>
          {/if}
        </button>
      {/each}

      <button
        class="collapse-toggle"
        onclick={() => filtersExpanded = !filtersExpanded}
        title={filtersExpanded ? 'Collapse filters' : 'Expand filters'}
      >{filtersExpanded ? '▲' : '▼'}</button>
    </div>
  {/if}
</div>

<style>
  .gigi-filters {
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-secondary);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    width: 100%;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    min-height: 32px;
  }

  .menu-row {
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
  }

  /* ── Menu buttons ────────────────────────────────────────────── */

  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--gigi-text-secondary);
    cursor: pointer;
    padding: var(--gigi-space-xs);
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
  }

  .menu-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .nav-btn {
    background: none;
    border: none;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
    white-space: nowrap;
  }

  .nav-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .nav-btn.active {
    color: var(--gigi-text-primary);
    font-weight: 600;
    background: var(--gigi-bg-tertiary);
  }

  .filter-spacer {
    flex: 1;
  }

  /* ── Connection badge ────────────────────────────────────────── */

  .connection-badge {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .status-dot {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gigi-border-default);
    transition: background var(--gigi-transition-fast);
  }

  .status-dot.connected {
    background: var(--gigi-accent-green);
  }

  .status-dot.connecting {
    background: var(--gigi-accent-orange);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-dot.disconnected {
    background: var(--gigi-accent-red);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ── Repo filter chips ───────────────────────────────────────── */

  .chips-row {
    overflow-x: auto;
    scrollbar-width: none;
    gap: var(--gigi-space-xs);
  }

  .chips-row::-webkit-scrollbar {
    display: none;
  }

  .chips-row.collapsed {
    display: none;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--gigi-bg-tertiary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-full);
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--gigi-transition-fast);
    flex-shrink: 0;
  }

  .chip:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-primary);
  }

  .chip.active {
    background: var(--gigi-accent-blue);
    color: #fff;
    border-color: var(--gigi-accent-blue);
  }

  .chip-count {
    font-size: 9px;
    background: rgba(255, 255, 255, 0.2);
    padding: 0 4px;
    border-radius: var(--gigi-radius-full);
    font-weight: 600;
  }

  .chip.active .chip-count {
    background: rgba(255, 255, 255, 0.3);
  }

  .chip:not(.active) .chip-count {
    background: var(--gigi-bg-secondary);
    color: var(--gigi-text-muted);
  }

  .collapse-toggle {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    font-size: 8px;
    cursor: pointer;
    padding: var(--gigi-space-xs);
    margin-left: auto;
    flex-shrink: 0;
    transition: color var(--gigi-transition-fast);
  }

  .collapse-toggle:hover {
    color: var(--gigi-text-primary);
  }
</style>
