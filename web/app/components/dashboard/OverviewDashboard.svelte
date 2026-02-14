<script lang="ts">
  /**
   * Overview Dashboard — Main landing view (Section D)
   *
   * Shows:
   * - Quick stats (repos, open issues, open PRs)
   * - Repository cards with issue/PR counts
   * - Recent conversations (activity feed)
   * - Quick actions
   */

  import { onMount } from 'svelte'
  import { getConversations, loadConversations, selectConversation } from '$lib/stores/chat.svelte'
  import { navigateToRepo } from '$lib/stores/navigation.svelte'
  import { formatRelativeTime } from '$lib/utils/format'

  // ── Types ──────────────────────────────────────────────────────────

  interface RepoSummary {
    name: string
    full_name: string
    description: string
    html_url: string
    open_issues_count: number
    stars_count: number
    forks_count: number
    archived: boolean
    default_branch: string
    updated_at: string
    open_pr_count: number
  }

  interface OverviewData {
    repos: RepoSummary[]
    totalRepos: number
    totalOpenIssues: number
    totalOpenPRs: number
  }

  // ── State ──────────────────────────────────────────────────────────

  let overview = $state<OverviewData | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)

  // ── Derived ────────────────────────────────────────────────────────

  const conversations = $derived(getConversations())
  const recentConversations = $derived(
    conversations
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
  )

  // ── Fetch ──────────────────────────────────────────────────────────

  async function fetchOverview(): Promise<void> {
    loading = true
    error = null
    try {
      const res = await fetch('/api/gitea/overview')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      overview = await res.json()
    } catch (err) {
      error = (err as Error).message
      console.error('[dashboard] Failed to load overview:', err)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    fetchOverview()
    loadConversations()
  })

  // ── Handlers ───────────────────────────────────────────────────────

  function handleRepoClick(repo: RepoSummary): void {
    navigateToRepo('idea', repo.name)
  }

  function handleConversationClick(convId: string): void {
    selectConversation(convId)
  }
</script>

<div class="dashboard">
  <!-- Quick Stats -->
  <div class="stats-row">
    <div class="stat-card">
      <span class="stat-value">{overview?.totalRepos ?? '—'}</span>
      <span class="stat-label">Repositories</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{overview?.totalOpenIssues ?? '—'}</span>
      <span class="stat-label">Open Issues</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{overview?.totalOpenPRs ?? '—'}</span>
      <span class="stat-label">Open PRs</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{conversations.length}</span>
      <span class="stat-label">Conversations</span>
    </div>
  </div>

  <!-- Main grid: repos + activity -->
  <div class="dashboard-grid">
    <!-- Repositories -->
    <section class="section">
      <h2 class="section-title">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/>
        </svg>
        Repositories
      </h2>

      {#if loading}
        <div class="loading-placeholder">
          {#each Array(3) as _}
            <div class="skeleton-card"></div>
          {/each}
        </div>
      {:else if error}
        <div class="error-banner">
          <span>Failed to load: {error}</span>
          <button onclick={fetchOverview}>Retry</button>
        </div>
      {:else if overview?.repos}
        <div class="repo-list">
          {#each overview.repos as repo}
            <button class="repo-card" onclick={() => handleRepoClick(repo)}>
              <div class="repo-header">
                <span class="repo-name">{repo.name}</span>
                {#if repo.updated_at}
                  <span class="repo-updated">{formatRelativeTime(repo.updated_at)}</span>
                {/if}
              </div>
              {#if repo.description}
                <p class="repo-desc">{repo.description}</p>
              {/if}
              <div class="repo-stats">
                {#if repo.open_issues_count > 0}
                  <span class="badge badge-issues" title="Open issues">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                      <path fill-rule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/>
                    </svg>
                    {repo.open_issues_count}
                  </span>
                {/if}
                {#if repo.open_pr_count > 0}
                  <span class="badge badge-prs" title="Open PRs">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
                    </svg>
                    {repo.open_pr_count}
                  </span>
                {/if}
                {#if repo.open_issues_count === 0 && repo.open_pr_count === 0}
                  <span class="badge badge-clean">All clear</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Activity Feed -->
    <section class="section">
      <h2 class="section-title">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zM8 0a8 8 0 100 16A8 8 0 008 0zm.5 4.75a.75.75 0 00-1.5 0v3.5a.75.75 0 00.37.65l2.5 1.5a.75.75 0 00.76-1.3L8.5 7.94V4.75z"/>
        </svg>
        Recent Activity
      </h2>

      {#if recentConversations.length === 0}
        <div class="empty-state">
          <p>No conversations yet</p>
        </div>
      {:else}
        <div class="activity-list">
          {#each recentConversations as conv}
            <button
              class="activity-item"
              onclick={() => handleConversationClick(conv.id)}
            >
              <div class="activity-header">
                <span class="activity-title">{conv.topic}</span>
                <span class="activity-channel">{conv.channel}</span>
              </div>
              <div class="activity-meta">
                <span class="activity-status" class:open={conv.status === 'open'} class:active={conv.status === 'active'} class:closed={conv.status === 'closed'}>
                  {conv.status}
                </span>
                <span class="activity-time">{formatRelativeTime(conv.updatedAt)}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Quick Actions -->
      <h2 class="section-title" style="margin-top: var(--gigi-space-xl)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M7.429 1.525a3.5 3.5 0 011.142 0l.009.002.038.013a2.25 2.25 0 011.207.692 2.25 2.25 0 011.384.065l.036.015.009.004a3.5 3.5 0 01.808.808l.004.009.015.036a2.25 2.25 0 01.065 1.384c.292.342.497.753.592 1.207l.013.038.002.009a3.5 3.5 0 010 1.142l-.002.009-.013.038a2.25 2.25 0 01-.592 1.207 2.25 2.25 0 01-.065 1.384l-.015.036-.004.009a3.5 3.5 0 01-.808.808l-.009.004-.036.015a2.25 2.25 0 01-1.384.065 2.25 2.25 0 01-1.207.592l-.038.013-.009.002a3.5 3.5 0 01-1.142 0l-.009-.002-.038-.013a2.25 2.25 0 01-1.207-.592 2.25 2.25 0 01-1.384-.065l-.036-.015-.009-.004a3.5 3.5 0 01-.808-.808l-.004-.009-.015-.036a2.25 2.25 0 01-.065-1.384 2.25 2.25 0 01-.592-1.207l-.013-.038-.002-.009a3.5 3.5 0 010-1.142l.002-.009.013-.038a2.25 2.25 0 01.592-1.207 2.25 2.25 0 01.065-1.384l.015-.036.004-.009a3.5 3.5 0 01.808-.808l.009-.004.036-.015a2.25 2.25 0 011.384-.065 2.25 2.25 0 011.207-.592l.038-.013.009-.002zM8 12.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm3.549-4.938L8.361 4.374a.5.5 0 00-.722 0L4.451 7.562a.5.5 0 00.361.848h1.688v3.09a.5.5 0 00.5.5h2a.5.5 0 00.5-.5v-3.09h1.688a.5.5 0 00.361-.848z"/>
        </svg>
        Quick Actions
      </h2>
      <div class="quick-actions">
        <button class="action-btn" onclick={() => { /* chat overlay opens on new message */ }}>
          <span class="action-icon">💬</span>
          <span>Ask Gigi</span>
        </button>
        <button class="action-btn" onclick={() => window.open('http://192.168.1.80:3000/idea', '_blank')}>
          <span class="action-icon">📦</span>
          <span>Gitea</span>
        </button>
      </div>
    </section>
  </div>
</div>

<style>
  .dashboard {
    padding: var(--gigi-space-lg) var(--gigi-space-xl);
    overflow-y: auto;
    height: 100%;
  }

  /* ── Stats Row ─────────────────────────────────────────────────── */

  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--gigi-space-md);
    margin-bottom: var(--gigi-space-xl);
  }

  .stat-card {
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-md) var(--gigi-space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .stat-value {
    font-size: var(--gigi-font-size-xl);
    font-weight: 700;
    color: var(--gigi-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── Grid ───────────────────────────────────────────────────────── */

  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gigi-space-xl);
  }

  @media (max-width: 900px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ── Sections ───────────────────────────────────────────────────── */

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

  .section-title svg {
    opacity: 0.6;
  }

  /* ── Repo List ──────────────────────────────────────────────────── */

  .repo-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-sm);
  }

  .repo-card {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-md);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    font-family: var(--gigi-font-sans);
    color: var(--gigi-text-primary);
  }

  .repo-card:hover {
    border-color: var(--gigi-accent-blue);
    background: var(--gigi-bg-hover);
  }

  .repo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--gigi-space-xs);
  }

  .repo-name {
    font-size: var(--gigi-font-size-base);
    font-weight: 600;
    color: var(--gigi-accent-blue);
  }

  .repo-updated {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .repo-desc {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-secondary);
    margin-bottom: var(--gigi-space-sm);
    line-height: 1.4;
  }

  .repo-stats {
    display: flex;
    gap: var(--gigi-space-sm);
    align-items: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--gigi-font-size-xs);
    padding: 2px 8px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
  }

  .badge-issues {
    background: rgba(63, 185, 80, 0.15);
    color: var(--gigi-accent-green);
  }

  .badge-prs {
    background: rgba(88, 166, 255, 0.15);
    color: var(--gigi-accent-blue);
  }

  .badge-clean {
    background: rgba(110, 118, 129, 0.15);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
  }

  /* ── Activity Feed ──────────────────────────────────────────────── */

  .activity-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .activity-item {
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

  .activity-item:hover {
    border-color: var(--gigi-accent-purple);
    background: var(--gigi-bg-hover);
  }

  .activity-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gigi-space-sm);
    margin-bottom: 2px;
  }

  .activity-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .activity-channel {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    flex-shrink: 0;
  }

  .activity-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .activity-status {
    font-size: var(--gigi-font-size-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .activity-status.open { color: var(--gigi-accent-green); }
  .activity-status.active { color: var(--gigi-accent-orange); }
  .activity-status.closed { color: var(--gigi-text-muted); }

  .activity-time {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  /* ── Quick Actions ──────────────────────────────────────────────── */

  .quick-actions {
    display: flex;
    gap: var(--gigi-space-sm);
    flex-wrap: wrap;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm) var(--gigi-space-lg);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    font-family: var(--gigi-font-sans);
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-primary);
  }

  .action-btn:hover {
    border-color: var(--gigi-accent-green);
    background: var(--gigi-bg-hover);
  }

  .action-icon {
    font-size: var(--gigi-font-size-lg);
  }

  /* ── Loading / Error ────────────────────────────────────────────── */

  .loading-placeholder {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-sm);
  }

  .skeleton-card {
    height: 72px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.8; }
  }

  .error-banner {
    background: rgba(248, 81, 73, 0.1);
    border: var(--gigi-border-width) solid var(--gigi-accent-red);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-md);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gigi-space-md);
    color: var(--gigi-accent-red);
    font-size: var(--gigi-font-size-sm);
  }

  .error-banner button {
    background: var(--gigi-accent-red);
    color: white;
    border: none;
    border-radius: var(--gigi-radius-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    cursor: pointer;
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
  }

  .empty-state {
    text-align: center;
    padding: var(--gigi-space-xl);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }
</style>
