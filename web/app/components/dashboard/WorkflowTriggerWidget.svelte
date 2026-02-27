<script lang="ts">
  /**
   * Workflow Trigger Widget
   *
   * Lists workflows that support manual dispatch (workflow_dispatch).
   * Allows users to trigger them directly from the dashboard.
   */

  import { onMount } from 'svelte'
  import { onGiteaEvent } from '$lib/stores/chat.svelte'
  import { navigateToGitea } from '$lib/stores/navigation.svelte'

  interface DispatchableWorkflow {
    repo: string
    file: string
    path: string
    name: string
    default_branch: string
  }

  interface Props {
    owner?: string
  }

  let { owner = 'idea' }: Props = $props()

  let workflows = $state<DispatchableWorkflow[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let dispatching = $state<string | null>(null)   // "repo/file" key while dispatching
  let dispatchResult = $state<{ key: string; ok: boolean; message: string } | null>(null)

  async function fetchWorkflows(): Promise<void> {
    try {
      const res = await fetch('/api/gitea/overview/workflows')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      workflows = data.workflows ?? []
      error = null
    } catch (err) {
      error = (err as Error).message
      console.error('[WorkflowTriggerWidget] fetch error:', err)
    } finally {
      loading = false
    }
  }

  async function triggerWorkflow(wf: DispatchableWorkflow): Promise<void> {
    const key = `${wf.repo}/${wf.file}`
    dispatching = key
    dispatchResult = null

    try {
      const res = await fetch('/api/gitea/workflows/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: wf.repo,
          workflow: wf.file,
          branch: wf.default_branch,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${res.status}`)
      }

      dispatchResult = { key, ok: true, message: 'Triggered!' }

      // Clear success message after a few seconds
      setTimeout(() => {
        if (dispatchResult?.key === key) dispatchResult = null
      }, 4000)
    } catch (err) {
      dispatchResult = { key, ok: false, message: (err as Error).message }
    } finally {
      dispatching = null
    }
  }

  function getWorkflowKey(wf: DispatchableWorkflow): string {
    return `${wf.repo}/${wf.file}`
  }

  onMount(() => {
    fetchWorkflows()
    const unsub = onGiteaEvent((ev) => {
      if (['push', 'create'].includes(ev.event)) {
        // Workflow files may have changed
        setTimeout(fetchWorkflows, 2000)
      }
    })
    return () => { unsub() }
  })
</script>

<section class="widget">
  <h2 class="widget-title">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 2h7v7H2V2zm2 2v3h3V4H4zm9-2h7v7h-7V2zm2 2v3h3V4h-3zM2 13h7v7H2v-7zm2 2v3h3v-3H4zm11.5-1.5L12 17l3.5 3.5L17 19l-2-2 2-2-1.5-1.5z"/>
    </svg>
    Run Workflow
    {#if workflows.length > 0}
      <span class="widget-count">{workflows.length}</span>
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
      <span>Failed to load workflows</span>
      <button onclick={fetchWorkflows}>Retry</button>
    </div>
  {:else if workflows.length === 0}
    <div class="widget-empty">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
        <path d="M2 2h7v7H2V2zm2 2v3h3V4H4zm9-2h7v7h-7V2zm2 2v3h3V4h-3zM2 13h7v7H2v-7zm2 2v3h3v-3H4zm11.5-1.5L12 17l3.5 3.5L17 19l-2-2 2-2-1.5-1.5z"/>
      </svg>
      <p>No dispatchable workflows</p>
      <span class="empty-hint">Add <code>workflow_dispatch</code> trigger to a workflow</span>
    </div>
  {:else}
    <div class="workflow-list">
      {#each workflows as wf}
        {@const key = getWorkflowKey(wf)}
        {@const isDispatching = dispatching === key}
        {@const result = dispatchResult?.key === key ? dispatchResult : null}
        <div class="workflow-item" class:workflow-success={result?.ok} class:workflow-error={result && !result.ok}>
          <button
            class="workflow-info"
            onclick={() => navigateToGitea(`/${owner}/${wf.repo}/actions`)}
            title="View {wf.name} actions in {wf.repo}"
          >
            <span class="workflow-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 2h7v7H2V2zm2 2v3h3V4H4zm9-2h7v7h-7V2zm2 2v3h3V4h-3zM2 13h7v7H2v-7zm2 2v3h3v-3H4zm11.5-1.5L12 17l3.5 3.5L17 19l-2-2 2-2-1.5-1.5z"/>
              </svg>
            </span>
            <div class="workflow-details">
              <span class="workflow-name">{wf.name}</span>
              <div class="workflow-meta">
                <span class="workflow-repo">{wf.repo}</span>
                <span class="workflow-branch">{wf.default_branch}</span>
              </div>
            </div>
          </button>
          <button
            class="trigger-btn"
            class:trigger-loading={isDispatching}
            onclick={() => triggerWorkflow(wf)}
            disabled={isDispatching}
            title="Run {wf.name} on {wf.default_branch}"
          >
            {#if isDispatching}
              <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 2h20v20H2V2zm2 2v16h16V4H4zm6 4h2v5h3v2h-5v-7z"/>
              </svg>
            {:else if result?.ok}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 4h2v2h-2V4zm-2 4V6h2v2h-2zm-2 0h2v2h-2V8zm0 0h-2V6h2v2zM3 6h8v2H3V6zm8 10H3v2h8v-2zm7 2v-2h2v-2h-2v2h-2v-2h-2v2h2v2h-2v2h2v-2h2zm0 0v2h2v-2h-2z"/>
              </svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4h2v2h2v2h2v2h2V8h-2V6h-2V4h8v16h-8v-2h2v-2h2v-2h-2v2h-2v2H6V4z"/>
              </svg>
            {/if}
          </button>

          {#if result && !result.ok}
            <div class="result-toast result-error">
              {result.message}
            </div>
          {/if}
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

  /* Workflow list */
  .workflow-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .workflow-item {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    position: relative;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    transition: all var(--gigi-transition-fast);
  }

  .workflow-item:hover {
    border-color: var(--gigi-accent-purple);
  }

  .workflow-success {
    border-color: var(--gigi-accent-green) !important;
    background: rgba(63, 185, 80, 0.04);
  }

  .workflow-error {
    border-color: var(--gigi-accent-red) !important;
  }

  .workflow-info {
    display: flex;
    align-items: flex-start;
    gap: var(--gigi-space-sm);
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    color: inherit;
    text-align: left;
  }

  .workflow-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--gigi-accent-purple);
    opacity: 0.7;
  }

  .workflow-details {
    flex: 1;
    min-width: 0;
  }

  .workflow-name {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 1.3;
  }

  .workflow-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    margin-top: 2px;
  }

  .workflow-repo {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .workflow-branch {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.08);
    padding: 0 5px;
    border-radius: var(--gigi-radius-full);
    font-family: var(--gigi-font-mono, monospace);
  }

  /* Trigger button */
  .trigger-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    margin-right: var(--gigi-space-sm);
    background: rgba(188, 140, 255, 0.1);
    border: var(--gigi-border-width) solid rgba(188, 140, 255, 0.2);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-accent-purple);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
  }

  .trigger-btn:hover:not(:disabled) {
    background: rgba(188, 140, 255, 0.2);
    border-color: var(--gigi-accent-purple);
    transform: scale(1.05);
  }

  .trigger-btn:active:not(:disabled) {
    transform: scale(0.95);
  }

  .trigger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .trigger-loading {
    color: var(--gigi-accent-orange);
    border-color: rgba(210, 153, 34, 0.3);
    background: rgba(210, 153, 34, 0.08);
  }

  .workflow-success .trigger-btn {
    color: var(--gigi-accent-green);
    border-color: rgba(63, 185, 80, 0.3);
    background: rgba(63, 185, 80, 0.1);
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Error toast */
  .result-toast {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    font-size: var(--gigi-font-size-xs);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    border-radius: var(--gigi-radius-sm);
    white-space: nowrap;
    z-index: 10;
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-error {
    background: rgba(248, 81, 73, 0.15);
    color: var(--gigi-accent-red);
    border: var(--gigi-border-width) solid rgba(248, 81, 73, 0.3);
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

  .empty-hint {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    opacity: 0.7;
  }

  .empty-hint code {
    font-family: var(--gigi-font-mono, monospace);
    background: var(--gigi-bg-elevated);
    padding: 1px 4px;
    border-radius: 3px;
  }
</style>
