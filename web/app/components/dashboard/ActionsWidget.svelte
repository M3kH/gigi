<script lang="ts">
  /**
   * CI/Actions Status Widget
   *
   * Shows recent workflow runs with status badges (success/failure/running).
   * Auto-refreshes on Gitea webhook events.
   */

  import { onMount } from 'svelte'
  import { onGiteaEvent } from '$lib/stores/chat.svelte'
  import { formatRelativeTime } from '$lib/utils/format'

  interface ActionRun {
    id: number
    name: string
    head_branch: string
    display_title: string
    status: string
    run_number: number
    url: string
    repo: string
    created_at: string
    updated_at: string
  }

  let runs = $state<ActionRun[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)

  async function fetchActions(): Promise<void> {
    try {
      const res = await fetch('/api/gitea/overview/actions')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      runs = data.runs ?? []
      error = null
    } catch (err) {
      error = (err as Error).message
      console.error('[ActionsWidget] fetch error:', err)
    } finally {
      loading = false
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'success': return 'success'
      case 'failure': return 'failure'
      case 'running': case 'waiting': return 'running'
      case 'cancelled': return 'cancelled'
      default: return 'unknown'
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'success': return 'passed'
      case 'failure': return 'failed'
      case 'running': return 'running'
      case 'waiting': return 'queued'
      case 'cancelled': return 'cancelled'
      default: return status
    }
  }

  /** Truncate branch name for display */
  function truncateBranch(branch: string, max = 20): string {
    if (branch.length <= max) return branch
    return branch.slice(0, max - 1) + '\u2026'
  }

  onMount(() => {
    fetchActions()
    const unsub = onGiteaEvent((ev) => {
      if (['push', 'pull_request', 'create'].includes(ev.event)) {
        // Slight delay to let CI start
        setTimeout(fetchActions, 2000)
      }
    })
    return () => { unsub() }
  })
</script>

<section class="widget">
  <h2 class="widget-title">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 2h20v20H2V2zm2 2v16h16V4H4zm7 3h2v2h-2V7zM9 9h2v2H9V9zm4 0h2v2h-2V9zM7 11h2v2H7v-2zm8 0h2v2h-2v-2zm-4 2h2v2h-2v-2zM9 15h2v2H9v-2zm4 0h2v2h-2v-2z"/>
    </svg>
    CI Status
    {#if runs.length > 0}
      <span class="widget-count">{runs.length}</span>
    {/if}
  </h2>

  {#if loading}
    <div class="loading-list">
      {#each Array(3) as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if error}
    <div class="widget-error">
      <span>Failed to load CI status</span>
      <button onclick={fetchActions}>Retry</button>
    </div>
  {:else if runs.length === 0}
    <div class="widget-empty">
      <p>No CI runs found</p>
    </div>
  {:else}
    <div class="run-list">
      {#each runs as run}
        <a
          class="run-item"
          href={run.url}
          target="_blank"
          rel="noopener noreferrer"
          title="{run.display_title} ({run.status})"
        >
          <span class="run-status run-status-{getStatusIcon(run.status)}" class:pulse={run.status === 'running' || run.status === 'waiting'}>
            {#if run.status === 'success'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h2v2h-2V4zm-2 4V6h2v2h-2zm-2 0h2v2h-2V8zm0 0h-2V6h2v2zM3 6h8v2H3V6zm8 10H3v2h8v-2zm7 2v-2h2v-2h-2v2h-2v-2h-2v2h2v2h-2v2h2v-2h2zm0 0v2h2v-2h-2z"/></svg>
            {:else if run.status === 'failure'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2v2H7V5zm8 0h-2v2h2V5zM9 7h2v2H9V7zm4 0h-2v2h2V7zm-2 2h2v2h-2V9zm0 4h2v-2h-2v2zm-2 2h2v-2H9v2zm4 0h-2v2h2v-2zm-6 0h2v-2H7v2zm8 0h-2v2h2v-2zm2-2h-2v-2h2v2zm-2 4h2v-2h-2v2z"/></svg>
            {:else if run.status === 'running' || run.status === 'waiting'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h20v20H2V2zm2 2v16h16V4H4zm6 4h2v5h3v2h-5v-7z"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 7h2v6h-2V7zm0 8h2v2h-2v-2z"/></svg>
            {/if}
          </span>
          <div class="run-info">
            <span class="run-title">{run.display_title}</span>
            <div class="run-meta">
              <span class="run-label run-label-{getStatusIcon(run.status)}">{getStatusLabel(run.status)}</span>
              <span class="run-branch" title={run.head_branch}>{truncateBranch(run.head_branch)}</span>
              <span class="run-time">{formatRelativeTime(run.created_at)}</span>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  .widget {
    min-width: 0;
  }

  .widget-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--gigi-space-md);
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .widget-title svg { opacity: 0.6; }

  .widget-count {
    font-size: var(--gigi-font-size-xs);
    background: var(--gigi-bg-elevated);
    color: var(--gigi-text-muted);
    padding: 1px 7px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
    margin-left: 2px;
  }

  .run-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .run-item {
    display: flex;
    align-items: flex-start;
    gap: var(--gigi-space-sm);
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    text-decoration: none;
    color: inherit;
  }

  .run-item:hover {
    border-color: var(--gigi-accent-blue);
    background: var(--gigi-bg-hover);
  }

  .run-status {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: var(--gigi-radius-sm);
    margin-top: 1px;
  }

  .run-status-success { color: var(--gigi-accent-green); }
  .run-status-failure { color: var(--gigi-accent-red); }
  .run-status-running { color: var(--gigi-accent-orange); }
  .run-status-cancelled { color: var(--gigi-text-muted); }
  .run-status-unknown { color: var(--gigi-text-muted); }

  .pulse {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .run-info {
    flex: 1;
    min-width: 0;
  }

  .run-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 1.3;
  }

  .run-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    margin-top: 2px;
  }

  .run-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0px 5px;
    border-radius: var(--gigi-radius-full);
  }

  .run-label-success {
    color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.12);
  }
  .run-label-failure {
    color: var(--gigi-accent-red);
    background: rgba(248, 81, 73, 0.12);
  }
  .run-label-running {
    color: var(--gigi-accent-orange);
    background: rgba(210, 153, 34, 0.12);
  }
  .run-label-cancelled, .run-label-unknown {
    color: var(--gigi-text-muted);
    background: rgba(110, 118, 129, 0.12);
  }

  .run-branch {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.08);
    padding: 0 5px;
    border-radius: var(--gigi-radius-full);
    font-family: var(--gigi-font-mono, monospace);
  }

  .run-time {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  /* Loading / Error / Empty */
  .loading-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .skeleton-row {
    height: 48px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.8; }
  }

  .widget-error {
    background: rgba(248, 81, 73, 0.08);
    border: var(--gigi-border-width) solid rgba(248, 81, 73, 0.3);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-secondary);
  }

  .widget-error button {
    background: none;
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    padding: 2px 8px;
    cursor: pointer;
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-secondary);
    font-family: var(--gigi-font-sans);
  }

  .widget-empty {
    text-align: center;
    padding: var(--gigi-space-lg);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }
</style>
