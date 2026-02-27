<script lang="ts">
  /**
   * Worker Actions Status Widget
   *
   * Shows Gitea Action runners (workers) with online/offline/busy status.
   * Auto-refreshes on Gitea webhook events.
   */

  import { onMount } from 'svelte'
  import { onGiteaEvent } from '$lib/stores/chat.svelte'

  interface RunnerLabel {
    id?: number
    name: string
    type?: string
  }

  interface Runner {
    id: number
    name: string
    status: string
    busy: boolean
    labels: RunnerLabel[]
    version?: string
  }

  let runners = $state<Runner[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)

  const onlineCount = $derived(runners.filter(r => r.status === 'online' || r.status === 'idle' || r.status === 'active').length)
  const busyCount = $derived(runners.filter(r => r.busy).length)

  async function fetchRunners(): Promise<void> {
    try {
      const res = await fetch('/api/gitea/overview/runners')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      runners = data.runners ?? []
      error = null
    } catch (err) {
      error = (err as Error).message
      console.error('[WorkerStatusWidget] fetch error:', err)
    } finally {
      loading = false
    }
  }

  function getRunnerStatusClass(runner: Runner): string {
    if (runner.status === 'offline') return 'offline'
    if (runner.busy) return 'busy'
    return 'idle'
  }

  function getRunnerStatusLabel(runner: Runner): string {
    if (runner.status === 'offline') return 'offline'
    if (runner.busy) return 'busy'
    return 'idle'
  }

  onMount(() => {
    fetchRunners()
    // Refresh periodically since runner status changes often
    const interval = setInterval(fetchRunners, 30_000)
    const unsub = onGiteaEvent((ev) => {
      if (['push', 'pull_request', 'create'].includes(ev.event)) {
        setTimeout(fetchRunners, 3000)
      }
    })
    return () => { clearInterval(interval); unsub() }
  })
</script>

<section class="widget">
  <h2 class="widget-title">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 2h16v2H4V2zm0 4h2v2H4V6zm16 0h-2v2h2V6zM4 10h2v2H4v-2zm16 0h-2v2h2v-2zM4 14h2v2H4v-2zm16 0h-2v2h2v-2zM4 18h16v2H4v-2zm0 4h16v2H4v-2zM8 6h8v12H8V6zm2 2v8h4V8h-4z"/>
    </svg>
    Workers
    {#if runners.length > 0}
      <span class="widget-count">{onlineCount}/{runners.length}</span>
    {/if}
  </h2>

  {#if loading}
    <div class="loading-list">
      {#each Array(2) as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if error}
    <div class="widget-error">
      <span>Failed to load workers</span>
      <button onclick={fetchRunners}>Retry</button>
    </div>
  {:else if runners.length === 0}
    <div class="widget-empty">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
        <path d="M4 2h16v2H4V2zm0 4h2v2H4V6zm16 0h-2v2h2V6zM4 10h2v2H4v-2zm16 0h-2v2h2v-2zM4 14h2v2H4v-2zm16 0h-2v2h2v-2zM4 18h16v2H4v-2zm0 4h16v2H4v-2zM8 6h8v12H8V6zm2 2v8h4V8h-4z"/>
      </svg>
      <p>No runners configured</p>
    </div>
  {:else}
    <!-- Summary bar -->
    <div class="summary-bar">
      <div class="summary-item">
        <span class="dot dot-idle"></span>
        <span class="summary-label">Idle {onlineCount - busyCount}</span>
      </div>
      <div class="summary-item">
        <span class="dot dot-busy"></span>
        <span class="summary-label">Busy {busyCount}</span>
      </div>
      {#if runners.length - onlineCount > 0}
        <div class="summary-item">
          <span class="dot dot-offline"></span>
          <span class="summary-label">Offline {runners.length - onlineCount}</span>
        </div>
      {/if}
    </div>

    <div class="runner-list">
      {#each runners as runner}
        <div
          class="runner-item"
          title="{runner.name} ({getRunnerStatusLabel(runner)})"
        >
          <span class="runner-status runner-{getRunnerStatusClass(runner)}" class:pulse={runner.busy}>
            <span class="status-dot"></span>
          </span>
          <div class="runner-info">
            <span class="runner-name">{runner.name}</span>
            <div class="runner-meta">
              <span class="runner-state runner-state-{getRunnerStatusClass(runner)}">{getRunnerStatusLabel(runner)}</span>
              {#if runner.labels?.length}
                {#each runner.labels.slice(0, 3) as label}
                  <span class="runner-label">{label.name}</span>
                {/each}
              {/if}
              {#if runner.version}
                <span class="runner-version">v{runner.version}</span>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .widget { min-width: 0; }

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

  /* Summary bar */
  .summary-bar {
    display: flex;
    gap: var(--gigi-space-md);
    margin-bottom: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
  }

  .summary-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .summary-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-idle { background: var(--gigi-accent-green); }
  .dot-busy { background: var(--gigi-accent-orange); }
  .dot-offline { background: var(--gigi-text-muted); opacity: 0.5; }

  /* Runner list */
  .runner-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .runner-item {
    display: flex;
    align-items: flex-start;
    gap: var(--gigi-space-sm);
    width: 100%;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    font-family: var(--gigi-font-sans);
    color: inherit;
  }

  .runner-status {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .runner-idle .status-dot { background: var(--gigi-accent-green); }
  .runner-busy .status-dot { background: var(--gigi-accent-orange); }
  .runner-offline .status-dot { background: var(--gigi-text-muted); opacity: 0.4; }

  .pulse .status-dot {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .runner-info {
    flex: 1;
    min-width: 0;
  }

  .runner-name {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 1.3;
  }

  .runner-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    margin-top: 2px;
    flex-wrap: wrap;
  }

  .runner-state {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0px 5px;
    border-radius: var(--gigi-radius-full);
  }

  .runner-state-idle {
    color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.12);
  }
  .runner-state-busy {
    color: var(--gigi-accent-orange);
    background: rgba(210, 153, 34, 0.12);
  }
  .runner-state-offline {
    color: var(--gigi-text-muted);
    background: rgba(110, 118, 129, 0.12);
  }

  .runner-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.08);
    padding: 0 5px;
    border-radius: var(--gigi-radius-full);
    font-family: var(--gigi-font-mono, monospace);
  }

  .runner-version {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    font-family: var(--gigi-font-mono, monospace);
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
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gigi-space-xs);
  }
</style>
