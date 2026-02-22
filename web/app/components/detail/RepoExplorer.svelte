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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 11v2H8v2H6v-2H4v-2h2V9h2v2h12zM10 7H8v2h2V7zm0 0h2V5h-2v2zm0 10H8v-2h2v2zm0 0h2v2h-2v-2z"/>
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22 2H2v14h2V4h16v12h-8v2h-2v2H8v-4H2v2h4v4h4v-2h2v-2h10V2h-2z"/>
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/>
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
