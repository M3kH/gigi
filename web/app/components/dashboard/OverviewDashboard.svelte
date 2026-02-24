<script lang="ts">
  /**
   * Overview Dashboard — Main landing view (Section D)
   *
   * Shows:
   * - Quick stats with color-coded icons and tinted backgrounds
   * - Quick Actions prominently in stats row (above fold)
   * - CI/Actions status with pass/fail/running badges
   * - Repository cards with descriptions, language, size
   * - Recent PRs (open + merged) across all repos
   * - Recent issues across all repos with label dots
   */

  import { onMount } from 'svelte'
  import { getConversations, loadConversations, onGiteaEvent, newConversation, addLocalMessage, setPendingPrompt } from '$lib/stores/chat.svelte'
  import { navigateToRepo, navigateToGitea } from '$lib/stores/navigation.svelte'
  import { setPanelState } from '$lib/stores/panels.svelte'
  import { formatRelativeTime } from '$lib/utils/format'
  import CostWidget from '$components/dashboard/CostWidget.svelte'
  import ActionsWidget from '$components/dashboard/ActionsWidget.svelte'
  import RecentPRsWidget from '$components/dashboard/RecentPRsWidget.svelte'
  import RecentIssuesWidget from '$components/dashboard/RecentIssuesWidget.svelte'

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
    language: string
    size: number
  }

  interface RecentPR {
    number: number
    title: string
    state: string
    user: { login: string; avatar_url: string } | null
    repo: string
    head_branch: string
    base_branch: string
    html_url: string
    created_at: string
    updated_at: string
    merged_at: string | null
  }

  interface RecentIssue {
    number: number
    title: string
    state: string
    user: { login: string; avatar_url: string } | null
    repo: string
    labels: { name: string; color: string }[]
    comments: number
    html_url: string
    created_at: string
    updated_at: string
    closed_at: string | null
  }

  interface OverviewData {
    org: { id: number; name: string }
    repos: RepoSummary[]
    totalRepos: number
    totalOpenIssues: number
    totalOpenPRs: number
    recentPRs: RecentPR[]
    recentIssues: RecentIssue[]
  }

  // ── State ──────────────────────────────────────────────────────────

  let overview = $state<OverviewData | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)

  // ── Derived ────────────────────────────────────────────────────────

  const conversations = $derived(getConversations())

  const userRepos = $derived(overview?.repos ?? [])
  const isEmpty = $derived(!loading && !error && userRepos.length === 0)
  const totalOpenIssues = $derived(overview?.totalOpenIssues ?? 0)
  const totalOpenPRs = $derived(overview?.totalOpenPRs ?? 0)

  // ── Fetch ──────────────────────────────────────────────────────────

  let initialLoad = true

  async function fetchOverview(): Promise<void> {
    loading = true
    error = null
    try {
      const res = await fetch('/api/gitea/overview')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      overview = await res.json()

      // On first load, hide chat if welcome page (no repos)
      if (initialLoad) {
        initialLoad = false
        const hasRepos = (overview?.repos.filter(r => r.name !== 'gigi') ?? []).length > 0
        if (!hasRepos) setPanelState('chatOverlay', 'hidden')
      }
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

    // Auto-refresh when Gitea state changes (repo created/deleted, issues, PRs)
    const unsubGitea = onGiteaEvent((ev) => {
      if (['repository', 'create', 'delete', 'issues', 'pull_request', 'push'].includes(ev.event)) {
        fetchOverview()
      }
    })

    return () => { unsubGitea() }
  })

  // ── Handlers ───────────────────────────────────────────────────────

  function handleRepoClick(repo: RepoSummary): void {
    navigateToRepo(overview?.org.name ?? 'gigi', repo.name)
  }

  /** Get a color for a programming language (GitHub-style) */
  function getLanguageColor(lang: string): string {
    const colors: Record<string, string> = {
      'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Python': '#3572A5',
      'Go': '#00ADD8', 'Rust': '#dea584', 'Java': '#b07219', 'C': '#555555',
      'C++': '#f34b7d', 'Shell': '#89e051', 'HTML': '#e34c26', 'CSS': '#563d7c',
      'Svelte': '#ff3e00', 'Vue': '#41b883', 'Ruby': '#701516', 'PHP': '#4F5D95',
    }
    return colors[lang] || '#8b949e'
  }

  /** Format repo size to human-readable */
  function formatSize(sizeKB: number): string {
    if (!sizeKB || sizeKB === 0) return ''
    if (sizeKB < 1024) return `${sizeKB} KB`
    const mb = sizeKB / 1024
    if (mb < 1024) return `${mb.toFixed(1)} MB`
    return `${(mb / 1024).toFixed(1)} GB`
  }

</script>

<div class="dashboard">
  {#if isEmpty}
    <!-- Welcome / Empty state -->
    <div class="welcome">
      <div class="welcome-header">
          <img src="/gigi-zen.png" width="200px" alt="Gigi">
        <h1 class="welcome-title">Welcome to Gigi</h1>
        <p class="welcome-subtitle">Your AI-powered development workspace. Let's get started.</p>
      </div>

      <div class="welcome-actions">
        <button class="welcome-card" onclick={() => navigateToGitea(`/repo/migrate${overview?.org ? `?org=${overview.org.id}` : ''}`)}>
          <span class="welcome-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5h2v2H8V5zM6 7h2v2H6V7zM4 9h2v2H4V9zm-2 2h2v2H2v-2zm2 2h2v2H4v-2zm2 2h2v2H6v-2zm2 2h2v2H8v-2zm8-12h-2v2h2V5zm2 2h-2v2h2V7zm2 2h-2v2h2V9zm2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2z"/>
            </svg>
          </span>
          <span class="welcome-card-title">Import a repository</span>
          <span class="welcome-card-desc">Bring an existing project from GitHub, GitLab, or any git URL</span>
        </button>

        <button class="welcome-card" onclick={() => navigateToGitea(`/repo/create${overview?.org ? `?org=${overview.org.id}` : ''}`)}>
          <span class="welcome-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z"/>
            </svg>
          </span>
          <span class="welcome-card-title">Create a new project</span>
          <span class="welcome-card-desc">Start fresh with an empty repository</span>
        </button>

        <button class="welcome-card welcome-card-accent" onclick={() => {
          newConversation()
          setPanelState('chatOverlay', 'compact')
          addLocalMessage('assistant', 'So.. what would you like to build today?')
          setPendingPrompt('The user is describing a new project. Make sure to create a repository for it.')
        }}>
          <span class="welcome-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z"/>
            </svg>
          </span>
          <span class="welcome-card-title">Describe your project to Gigi</span>
          <span class="welcome-card-desc">Tell Gigi what you want to build and she'll set it up for you</span>
        </button>
      </div>
    </div>
  {:else}
    <!-- Quick Actions + Quick Stats row -->
    <div class="stats-row">
      <div class="stat-actions">
        <button class="action-chip action-chip-primary" onclick={() => { newConversation(); setPanelState('chatOverlay', 'compact') }} title="Start a conversation with Gigi">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z"/>
          </svg>
          Ask Gigi
        </button>
        <button class="action-chip" onclick={() => navigateToGitea(`/${overview?.org?.name ?? 'idea'}`)} title="Open Gitea">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5h2v2H8V5zM6 7h2v2H6V7zM4 9h2v2H4V9zm-2 2h2v2H2v-2zm2 2h2v2H4v-2zm2 2h2v2H6v-2zm2 2h2v2H8v-2zm8-12h-2v2h2V5zm2 2h-2v2h2V7zm2 2h-2v2h2V9zm2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2z"/>
          </svg>
          Gitea
        </button>
      </div>

      <div class="stat-card stat-repos">
        <div class="stat-icon stat-icon-blue">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5h2v2H8V5zM6 7h2v2H6V7zM4 9h2v2H4V9zm-2 2h2v2H2v-2zm2 2h2v2H4v-2zm2 2h2v2H6v-2zm2 2h2v2H8v-2zm8-12h-2v2h2V5zm2 2h-2v2h2V7zm2 2h-2v2h2V9zm2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{userRepos.length}</span>
          <span class="stat-label">Repositories</span>
        </div>
      </div>

      <div class="stat-card stat-issues" class:stat-urgent={totalOpenIssues > 5}>
        <div class="stat-icon" class:stat-icon-orange={totalOpenIssues <= 5} class:stat-icon-red={totalOpenIssues > 5}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 2H6v2H4v2H2v12h2v2h2v2h12v-2h2v-2h2V6h-2V4h-2V2zm0 2v2h2v12h-2v2H6v-2H4V6h2V4h12zm-8 6h4v4h-4v-4zM8 6h8v2H8V6zm0 10H6V8h2v8zm8 0v2H8v-2h8zm0 0h2V8h-2v8z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{overview?.totalOpenIssues ?? '—'}</span>
          <span class="stat-label">Open Issues</span>
        </div>
      </div>

      <div class="stat-card stat-prs">
        <div class="stat-icon stat-icon-purple">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{overview?.totalOpenPRs ?? '—'}</span>
          <span class="stat-label">Open PRs</span>
        </div>
      </div>

      <div class="stat-card stat-conversations">
        <div class="stat-icon stat-icon-green">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{conversations.length}</span>
          <span class="stat-label">Conversations</span>
        </div>
      </div>

      <div class="stat-cost">
        <CostWidget />
      </div>
    </div>

    <!-- Main grid: CI + PRs | Repos + Issues -->
    <div class="dashboard-grid">
      <!-- Left column -->
      <div class="grid-column">
        <ActionsWidget />
        <!-- Repositories -->
        <section class="section">
          <h2 class="section-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5h2v2H8V5zM6 7h2v2H6V7zM4 9h2v2H4V9zm-2 2h2v2H2v-2zm2 2h2v2H4v-2zm2 2h2v2H6v-2zm2 2h2v2H8v-2zm8-12h-2v2h2V5zm2 2h-2v2h2V7zm2 2h-2v2h2V9zm2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2zm-2 2h-2v2h2v-2z"/>
            </svg>
            Repositories
            <span class="section-count">{userRepos.length}</span>
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
          {:else}
            <div class="repo-list">
              {#each userRepos as repo}
                <button class="repo-card" onclick={() => handleRepoClick(repo)}>
                  <div class="repo-header">
                    <span class="repo-name">{repo.name}</span>
                    <div class="repo-header-right">
                      {#if repo.size}
                        <span class="repo-size">{formatSize(repo.size)}</span>
                      {/if}
                      {#if repo.updated_at}
                        <span class="repo-updated">{formatRelativeTime(repo.updated_at)}</span>
                      {/if}
                    </div>
                  </div>
                  {#if repo.description}
                    <p class="repo-desc">{repo.description}</p>
                  {:else}
                    <p class="repo-desc repo-desc-empty">No description</p>
                  {/if}
                  <div class="repo-stats">
                    {#if repo.open_issues_count > 0}
                      <span class="badge badge-issues" title="Open issues">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18 2H6v2H4v2H2v12h2v2h2v2h12v-2h2v-2h2V6h-2V4h-2V2zm0 2v2h2v12h-2v2H6v-2H4V6h2V4h12zm-8 6h4v4h-4v-4zM8 6h8v2H8V6zm0 10H6V8h2v8zm8 0v2H8v-2h8zm0 0h2V8h-2v8z"/>
                        </svg>
                        {repo.open_issues_count}
                      </span>
                    {/if}
                    {#if repo.open_pr_count > 0}
                      <span class="badge badge-prs" title="Open PRs">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/>
                        </svg>
                        {repo.open_pr_count}
                      </span>
                    {/if}
                    {#if repo.open_issues_count === 0 && repo.open_pr_count === 0}
                      <span class="badge badge-clean">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 4h2v2h-2V4zm-2 4V6h2v2h-2zm-2 0h2v2h-2V8zm0 0h-2V6h2v2zM3 6h8v2H3V6zm8 10H3v2h8v-2zm7 2v-2h2v-2h-2v2h-2v-2h-2v2h2v2h-2v2h2v-2h2zm0 0v2h2v-2h-2z"/>
                        </svg>
                        All clear
                      </span>
                    {/if}
                    {#if repo.language}
                      <span class="badge badge-lang" title="Primary language">
                        <span class="lang-dot" style="background: {getLanguageColor(repo.language)}"></span>
                        {repo.language}
                      </span>
                    {/if}
                    {#if repo.default_branch && repo.default_branch !== 'main'}
                      <span class="badge badge-branch" title="Default branch">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M5 2h2v12h3v3h7v-7h-3V2h8v8h-3v9h-9v3H2v-8h3V2zm15 6V4h-4v4h4zM8 19v-3H4v4h4v-1z"/>
                        </svg>
                        {repo.default_branch}
                      </span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </section>
      </div>

      <!-- Right column -->
      <div class="grid-column">
        <RecentPRsWidget prs={overview?.recentPRs ?? []} loading={loading} />
        <RecentIssuesWidget issues={overview?.recentIssues ?? []} loading={loading} />
      </div>
    </div>
  {/if}
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
    grid-template-columns: auto repeat(6, 1fr);
    gap: var(--gigi-space-md);
    margin-bottom: var(--gigi-space-md);
    align-items: stretch;
  }

  .stat-cost {
    grid-column: span 2;
    min-width: 0;
  }

  @media (max-width: 900px) {
    .stats-row {
      grid-template-columns: repeat(2, 1fr);
    }
    .stat-actions {
      grid-column: 1 / -1;
    }
    .stat-cost {
      grid-column: 1 / -1;
    }
  }

  .stat-card {
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-md) var(--gigi-space-lg);
    display: flex;
    align-items: center;
    gap: var(--gigi-space-md);
    border-top: 3px solid transparent;
    transition: border-color var(--gigi-transition-fast);
  }

  .stat-card:hover {
    border-color: var(--gigi-border-default);
  }

  /* Color-coded stat cards */
  .stat-repos   { border-top-color: var(--gigi-accent-blue); }
  .stat-issues  { border-top-color: var(--gigi-accent-orange); }
  .stat-prs     { border-top-color: var(--gigi-accent-purple); }
  .stat-conversations { border-top-color: var(--gigi-accent-green); }

  /* Colored icon circles */
  .stat-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--gigi-radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .stat-icon-blue {
    background: rgba(88, 166, 255, 0.12);
    color: var(--gigi-accent-blue);
  }
  .stat-icon-orange {
    background: rgba(210, 153, 34, 0.12);
    color: var(--gigi-accent-orange);
  }
  .stat-icon-red {
    background: rgba(248, 81, 73, 0.12);
    color: var(--gigi-accent-red);
  }
  .stat-icon-purple {
    background: rgba(188, 140, 255, 0.12);
    color: var(--gigi-accent-purple);
  }
  .stat-icon-green {
    background: rgba(63, 185, 80, 0.12);
    color: var(--gigi-accent-green);
  }

  .stat-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  /* Urgent state: glow when issue count is high */
  .stat-urgent {
    border-top-color: var(--gigi-accent-red);
    background: rgba(248, 81, 73, 0.06);
    box-shadow: inset 0 0 0 1px rgba(248, 81, 73, 0.15);
  }

  .stat-repos .stat-value   { color: var(--gigi-accent-blue); }
  .stat-issues .stat-value  { color: var(--gigi-accent-orange); }
  .stat-urgent .stat-value  { color: var(--gigi-accent-red); }
  .stat-prs .stat-value     { color: var(--gigi-accent-purple); }
  .stat-conversations .stat-value { color: var(--gigi-accent-green); }

  .stat-value {
    font-size: var(--gigi-font-size-xl);
    font-weight: 700;
    color: var(--gigi-text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .stat-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    line-height: 1.2;
  }

  /* Quick Actions — first in row, prominent */
  .stat-actions {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
    justify-content: center;
  }

  .action-chip {
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
    font-weight: 500;
    color: var(--gigi-text-primary);
    white-space: nowrap;
  }

  .action-chip:hover {
    border-color: var(--gigi-accent-blue);
    background: var(--gigi-bg-hover);
  }

  .action-chip-primary {
    background: rgba(63, 185, 80, 0.1);
    border-color: rgba(63, 185, 80, 0.3);
    color: var(--gigi-accent-green);
  }

  .action-chip-primary:hover {
    background: rgba(63, 185, 80, 0.18);
    border-color: var(--gigi-accent-green);
  }

  .action-chip svg {
    opacity: 0.8;
    flex-shrink: 0;
  }

  /* ── Grid ───────────────────────────────────────────────────────── */

  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gigi-space-xl);
  }

  .grid-column {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xl);
    min-width: 0;
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

  .section-count {
    font-size: var(--gigi-font-size-xs);
    background: var(--gigi-bg-elevated);
    color: var(--gigi-text-muted);
    padding: 1px 7px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
    margin-left: 2px;
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
    gap: var(--gigi-space-sm);
  }

  .repo-header-right {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    flex-shrink: 0;
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

  .repo-size {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .repo-desc {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-secondary);
    margin-bottom: var(--gigi-space-sm);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .repo-desc-empty {
    color: var(--gigi-text-muted);
    font-style: italic;
  }

  .repo-stats {
    display: flex;
    gap: var(--gigi-space-sm);
    align-items: center;
    flex-wrap: wrap;
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

  .badge-lang {
    background: rgba(110, 118, 129, 0.1);
    color: var(--gigi-text-secondary);
    margin-left: auto;
  }

  .lang-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .badge-branch {
    background: rgba(110, 118, 129, 0.1);
    color: var(--gigi-text-muted);
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
    padding: var(--gigi-space-xl) var(--gigi-space-lg);
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

  /* ── Welcome / Empty State ─────────────────────────────────────── */

  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--gigi-space-2xl, 48px);
    padding: var(--gigi-space-xl);
  }

  .welcome-header {
    text-align: center;
  }

  .welcome-title {
    font-size: 28px;
    font-weight: 700;
    color: var(--gigi-text-primary);
    margin: 0 0 var(--gigi-space-sm) 0;
  }

  .welcome-subtitle {
    font-size: var(--gigi-font-size-base);
    color: var(--gigi-text-secondary);
    margin: 0;
  }

  .welcome-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--gigi-space-md);
    max-width: 780px;
    width: 100%;
  }

  .welcome-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--gigi-space-sm);
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-lg, 12px);
    padding: var(--gigi-space-lg);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    font-family: var(--gigi-font-sans);
    color: var(--gigi-text-primary);
    text-align: left;
  }

  .welcome-card:hover {
    border-color: var(--gigi-accent-blue);
    background: var(--gigi-bg-hover);
    transform: translateY(-2px);
    box-shadow: var(--gigi-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
  }

  .welcome-card-accent {
    border-color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.05);
  }

  .welcome-card-accent:hover {
    border-color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.1);
  }

  .welcome-card-icon {
    color: var(--gigi-text-muted);
  }

  .welcome-card-accent .welcome-card-icon {
    color: var(--gigi-accent-green);
  }

  .welcome-card-title {
    font-size: var(--gigi-font-size-base);
    font-weight: 600;
  }

  .welcome-card-desc {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-secondary);
    line-height: 1.4;
  }
</style>
