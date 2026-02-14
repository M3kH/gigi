<script lang="ts">
  /**
   * Issue Detail View — Shows a single Gitea issue
   * Placeholder with data fetching skeleton for Phase 2.
   */

  import { onMount } from 'svelte'
  import { getCurrentView, goBack } from '$lib/stores/navigation.svelte'
  import { formatRelativeTime } from '$lib/utils/format'

  interface IssueData {
    number: number
    title: string
    body: string
    state: string
    user?: { login: string; avatar_url: string }
    labels: Array<{ name: string; color: string }>
    created_at?: string
    updated_at?: string
    comments: number
  }

  let issue = $state<IssueData | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)

  const nav = $derived(getCurrentView())

  onMount(async () => {
    if (!nav.owner || !nav.repo || !nav.number) {
      error = 'Missing issue reference'
      loading = false
      return
    }
    try {
      const res = await fetch(`/api/gitea/repos/${nav.owner}/${nav.repo}/issues/${nav.number}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      issue = await res.json()
    } catch (err) {
      error = (err as Error).message
    } finally {
      loading = false
    }
  })
</script>

<div class="issue-detail">
  <div class="detail-header">
    <button class="back-btn" onclick={goBack}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z"/>
      </svg>
      Back
    </button>
    {#if nav.repo}
      <span class="breadcrumb">{nav.owner}/{nav.repo}</span>
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading issue...</div>
  {:else if error}
    <div class="error">Error: {error}</div>
  {:else if issue}
    <div class="issue-content">
      <div class="issue-title-row">
        <span class="issue-state" class:open={issue.state === 'open'} class:closed={issue.state === 'closed'}>
          {issue.state}
        </span>
        <h1 class="issue-title">{issue.title} <span class="issue-num">#{issue.number}</span></h1>
      </div>

      {#if issue.labels.length > 0}
        <div class="labels">
          {#each issue.labels as label}
            <span class="label" style:background="#{label.color}" style:color={parseInt(label.color, 16) > 0x888888 ? '#000' : '#fff'}>
              {label.name}
            </span>
          {/each}
        </div>
      {/if}

      <div class="issue-meta">
        {#if issue.user}
          <span>{issue.user.login}</span>
        {/if}
        {#if issue.created_at}
          <span>opened {formatRelativeTime(issue.created_at)}</span>
        {/if}
        <span>{issue.comments} comment{issue.comments === 1 ? '' : 's'}</span>
      </div>

      {#if issue.body}
        <div class="issue-body">
          <pre>{issue.body}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .issue-detail {
    padding: var(--gigi-space-lg) var(--gigi-space-xl);
    overflow-y: auto;
    height: 100%;
  }

  .detail-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-md);
    margin-bottom: var(--gigi-space-lg);
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    background: none;
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    color: var(--gigi-text-secondary);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    font-size: var(--gigi-font-size-sm);
    transition: all var(--gigi-transition-fast);
  }

  .back-btn:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-primary);
  }

  .breadcrumb {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-muted);
    font-family: var(--gigi-font-mono);
  }

  .issue-title-row {
    display: flex;
    align-items: flex-start;
    gap: var(--gigi-space-md);
    margin-bottom: var(--gigi-space-md);
  }

  .issue-state {
    font-size: var(--gigi-font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--gigi-radius-full);
    flex-shrink: 0;
    margin-top: 4px;
  }

  .issue-state.open {
    background: rgba(63, 185, 80, 0.15);
    color: var(--gigi-accent-green);
  }

  .issue-state.closed {
    background: rgba(188, 140, 255, 0.15);
    color: var(--gigi-accent-purple);
  }

  .issue-title {
    font-size: var(--gigi-font-size-xl);
    font-weight: 600;
    color: var(--gigi-text-primary);
    line-height: 1.3;
  }

  .issue-num {
    color: var(--gigi-text-muted);
    font-weight: 400;
  }

  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gigi-space-xs);
    margin-bottom: var(--gigi-space-md);
  }

  .label {
    font-size: var(--gigi-font-size-xs);
    padding: 2px 8px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
  }

  .issue-meta {
    display: flex;
    gap: var(--gigi-space-md);
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-muted);
    margin-bottom: var(--gigi-space-lg);
  }

  .issue-body {
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-lg);
  }

  .issue-body pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: var(--gigi-font-sans);
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-primary);
    line-height: 1.6;
  }

  .loading, .error {
    padding: var(--gigi-space-xl);
    text-align: center;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }

  .error { color: var(--gigi-accent-red); }
</style>
