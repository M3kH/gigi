<script lang="ts">
  /**
   * Repository Explorer — Shows repo overview with issues and PRs
   * Read-only file explorer comes in Phase 4.
   */

  import { onMount } from 'svelte'
  import { getCurrentView, goBack, navigateToIssue, navigateToPull } from '$lib/stores/navigation.svelte'
  import { formatRelativeTime } from '$lib/utils/format'

  interface IssueSummary {
    number: number
    title: string
    state: string
    labels: Array<{ name: string; color: string }>
    user?: { login: string }
    created_at?: string
    comments: number
  }

  interface PRSummary {
    number: number
    title: string
    state: string
    merged: boolean
    labels: Array<{ name: string; color: string }>
    user?: { login: string }
    created_at?: string
    comments: number
  }

  let issues = $state<IssueSummary[]>([])
  let pulls = $state<PRSummary[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)

  const nav = $derived(getCurrentView())

  onMount(async () => {
    if (!nav.owner || !nav.repo) {
      error = 'Missing repo reference'
      loading = false
      return
    }
    try {
      const [issueRes, prRes] = await Promise.all([
        fetch(`/api/gitea/repos/${nav.owner}/${nav.repo}/issues?state=open&limit=10`),
        fetch(`/api/gitea/repos/${nav.owner}/${nav.repo}/pulls?state=open&limit=10`),
      ])
      if (!issueRes.ok) throw new Error(`Issues: HTTP ${issueRes.status}`)
      if (!prRes.ok) throw new Error(`PRs: HTTP ${prRes.status}`)
      issues = await issueRes.json()
      pulls = await prRes.json()
    } catch (err) {
      error = (err as Error).message
    } finally {
      loading = false
    }
  })
</script>

<div class="repo-explorer">
  <div class="detail-header">
    <button class="back-btn" onclick={goBack}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z"/>
      </svg>
      Back
    </button>
    <h1 class="repo-title">{nav.owner}/{nav.repo}</h1>
  </div>

  {#if loading}
    <div class="loading">Loading repository...</div>
  {:else if error}
    <div class="error">Error: {error}</div>
  {:else}
    <div class="repo-grid">
      <!-- Open Issues -->
      <section class="section">
        <h2 class="section-title">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
            <path fill-rule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/>
          </svg>
          Open Issues ({issues.length})
        </h2>
        {#if issues.length === 0}
          <div class="empty">No open issues</div>
        {:else}
          <div class="item-list">
            {#each issues as issue}
              <button class="list-item" onclick={() => navigateToIssue(nav.owner!, nav.repo!, issue.number)}>
                <div class="item-title">
                  <span class="item-num">#{issue.number}</span>
                  {issue.title}
                </div>
                <div class="item-meta">
                  {#if issue.user}
                    <span>{issue.user.login}</span>
                  {/if}
                  {#if issue.created_at}
                    <span>{formatRelativeTime(issue.created_at)}</span>
                  {/if}
                  {#if issue.comments > 0}
                    <span>{issue.comments} 💬</span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Open PRs -->
      <section class="section">
        <h2 class="section-title">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
          </svg>
          Open Pull Requests ({pulls.length})
        </h2>
        {#if pulls.length === 0}
          <div class="empty">No open pull requests</div>
        {:else}
          <div class="item-list">
            {#each pulls as pr}
              <button class="list-item" onclick={() => navigateToPull(nav.owner!, nav.repo!, pr.number)}>
                <div class="item-title">
                  <span class="item-num">#{pr.number}</span>
                  {pr.title}
                </div>
                <div class="item-meta">
                  {#if pr.user}
                    <span>{pr.user.login}</span>
                  {/if}
                  {#if pr.created_at}
                    <span>{formatRelativeTime(pr.created_at)}</span>
                  {/if}
                  {#if pr.comments > 0}
                    <span>{pr.comments} 💬</span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .repo-explorer {
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

  .repo-title {
    font-size: var(--gigi-font-size-lg);
    font-weight: 600;
    color: var(--gigi-accent-blue);
    font-family: var(--gigi-font-mono);
  }

  .repo-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gigi-space-xl);
  }

  @media (max-width: 768px) {
    .repo-grid { grid-template-columns: 1fr; }
  }

  .section-title {
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

  .item-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .list-item {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    font-family: var(--gigi-font-sans);
    color: var(--gigi-text-primary);
  }

  .list-item:hover {
    border-color: var(--gigi-accent-blue);
    background: var(--gigi-bg-hover);
  }

  .item-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    margin-bottom: 2px;
  }

  .item-num {
    color: var(--gigi-text-muted);
    font-weight: 400;
    margin-right: var(--gigi-space-xs);
  }

  .item-meta {
    display: flex;
    gap: var(--gigi-space-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .empty {
    text-align: center;
    padding: var(--gigi-space-lg);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
  }

  .loading, .error {
    padding: var(--gigi-space-xl);
    text-align: center;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }

  .error { color: var(--gigi-accent-red); }
</style>
