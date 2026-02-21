<script lang="ts">
  /**
   * Overview Dashboard — Main landing view (Section D)
   *
   * Shows:
   * - Quick stats with color-coded icons and tinted backgrounds
   * - Quick Actions prominently in stats row (above fold)
   * - Repository cards with descriptions, language, size
   * - Recent activity with message previews and channel icons
   */

  import { onMount } from 'svelte'
  import { getConversations, loadConversations, selectConversation, onGiteaEvent, newConversation, addLocalMessage, setPendingPrompt } from '$lib/stores/chat.svelte'
  import { navigateToRepo, navigateToGitea } from '$lib/stores/navigation.svelte'
  import { setPanelState } from '$lib/stores/panels.svelte'
  import { formatRelativeTime } from '$lib/utils/format'
  import CostWidget from '$components/dashboard/CostWidget.svelte'

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

  interface OverviewData {
    org: { id: number; name: string }
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

  function handleConversationClick(convId: string): void {
    selectConversation(convId)
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

  /** Show a meaningful title instead of just "web" or channel name */
  function getConversationDisplayTitle(conv: { topic: string; channel: string }): string {
    const topic = conv.topic?.trim()
    if (topic && topic !== conv.channel && topic !== 'Untitled' && topic.length > 1) {
      return topic
    }
    if (conv.channel) {
      return conv.channel.charAt(0).toUpperCase() + conv.channel.slice(1) + ' conversation'
    }
    return 'New conversation'
  }

  /** Format repo size to human-readable */
  function formatSize(sizeKB: number): string {
    if (!sizeKB || sizeKB === 0) return ''
    if (sizeKB < 1024) return `${sizeKB} KB`
    const mb = sizeKB / 1024
    if (mb < 1024) return `${mb.toFixed(1)} MB`
    return `${(mb / 1024).toFixed(1)} GB`
  }

  /** Get a channel icon */
  function getChannelIcon(channel: string): string {
    switch (channel) {
      case 'web': return '🌐'
      case 'telegram': return '📱'
      case 'cli': return '⌨️'
      default: return '💬'
    }
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
            <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/>
            </svg>
          </span>
          <span class="welcome-card-title">Import a repository</span>
          <span class="welcome-card-desc">Bring an existing project from GitHub, GitLab, or any git URL</span>
        </button>

        <button class="welcome-card" onclick={() => navigateToGitea(`/repo/create${overview?.org ? `?org=${overview.org.id}` : ''}`)}>
          <span class="welcome-card-icon">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M7.75 0a.75.75 0 01.75.75V7h6.25a.75.75 0 010 1.5H8.5v6.25a.75.75 0 01-1.5 0V8.5H.75a.75.75 0 010-1.5H7V.75A.75.75 0 017.75 0z"/>
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
            <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M1.5 2.75a.25.25 0 01.25-.25h8.5a.25.25 0 01.25.25v5.5a.25.25 0 01-.25.25h-3.5a.75.75 0 00-.53.22L3.5 11.44V9.25a.75.75 0 00-.75-.75h-1a.25.25 0 01-.25-.25v-5.5zM1.75 1A1.75 1.75 0 000 2.75v5.5C0 9.216.784 10 1.75 10H2v1.543a1.457 1.457 0 002.487 1.03L7.061 10h3.189A1.75 1.75 0 0012 8.25v-5.5A1.75 1.75 0 0010.25 1h-8.5zM14.5 4.75a.25.25 0 00-.25-.25h-.5a.75.75 0 110-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0114.25 12H14v1.543a1.457 1.457 0 01-2.487 1.03L9.22 12.28a.75.75 0 111.06-1.06l2.22 2.22v-2.19a.75.75 0 01.75-.75h1a.25.25 0 00.25-.25v-5.5z"/>
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
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M1.5 2.75a.25.25 0 01.25-.25h8.5a.25.25 0 01.25.25v5.5a.25.25 0 01-.25.25h-3.5a.75.75 0 00-.53.22L3.5 11.44V9.25a.75.75 0 00-.75-.75h-1a.25.25 0 01-.25-.25v-5.5zM1.75 1A1.75 1.75 0 000 2.75v5.5C0 9.216.784 10 1.75 10H2v1.543a1.457 1.457 0 002.487 1.03L7.061 10h3.189A1.75 1.75 0 0012 8.25v-5.5A1.75 1.75 0 0010.25 1h-8.5z"/>
          </svg>
          Ask Gigi
        </button>
        <button class="action-chip" onclick={() => navigateToGitea(`/${overview?.org?.name ?? 'idea'}`)} title="Open Gitea">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/>
          </svg>
          Gitea
        </button>
      </div>

      <div class="stat-card stat-repos">
        <div class="stat-icon stat-icon-blue">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{userRepos.length}</span>
          <span class="stat-label">Repositories</span>
        </div>
      </div>

      <div class="stat-card stat-issues" class:stat-urgent={totalOpenIssues > 5}>
        <div class="stat-icon" class:stat-icon-orange={totalOpenIssues <= 5} class:stat-icon-red={totalOpenIssues > 5}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
            <path fill-rule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{overview?.totalOpenIssues ?? '—'}</span>
          <span class="stat-label">Open Issues</span>
        </div>
      </div>

      <div class="stat-card stat-prs">
        <div class="stat-icon stat-icon-purple">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{overview?.totalOpenPRs ?? '—'}</span>
          <span class="stat-label">Open PRs</span>
        </div>
      </div>

      <div class="stat-card stat-conversations">
        <div class="stat-icon stat-icon-green">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M1.5 2.75a.25.25 0 01.25-.25h8.5a.25.25 0 01.25.25v5.5a.25.25 0 01-.25.25h-3.5a.75.75 0 00-.53.22L3.5 11.44V9.25a.75.75 0 00-.75-.75h-1a.25.25 0 01-.25-.25v-5.5zM1.75 1A1.75 1.75 0 000 2.75v5.5C0 9.216.784 10 1.75 10H2v1.543a1.457 1.457 0 002.487 1.03L7.061 10h3.189A1.75 1.75 0 0012 8.25v-5.5A1.75 1.75 0 0010.25 1h-8.5z"/>
          </svg>
        </div>
        <div class="stat-content">
          <span class="stat-value">{conversations.length}</span>
          <span class="stat-label">Conversations</span>
        </div>
      </div>
    </div>

    <!-- Cost monitoring widget -->
    <div class="cost-section">
      <CostWidget />
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
                    <span class="badge badge-clean">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
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
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
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

    <!-- Activity Feed -->
    <section class="section">
      <h2 class="section-title">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zM8 0a8 8 0 100 16A8 8 0 008 0zm.5 4.75a.75.75 0 00-1.5 0v3.5a.75.75 0 00.37.65l2.5 1.5a.75.75 0 00.76-1.3L8.5 7.94V4.75z"/>
        </svg>
        Recent Activity
        {#if recentConversations.length > 0}
          <span class="section-count">{recentConversations.length}</span>
        {/if}
      </h2>

      {#if recentConversations.length === 0}
        <div class="empty-state">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
            <path fill-rule="evenodd" d="M1.5 2.75a.25.25 0 01.25-.25h8.5a.25.25 0 01.25.25v5.5a.25.25 0 01-.25.25h-3.5a.75.75 0 00-.53.22L3.5 11.44V9.25a.75.75 0 00-.75-.75h-1a.25.25 0 01-.25-.25v-5.5zM1.75 1A1.75 1.75 0 000 2.75v5.5C0 9.216.784 10 1.75 10H2v1.543a1.457 1.457 0 002.487 1.03L7.061 10h3.189A1.75 1.75 0 0012 8.25v-5.5A1.75 1.75 0 0010.25 1h-8.5z"/>
          </svg>
          <p>No conversations yet</p>
          <p class="empty-hint">Start a chat with Gigi to see activity here</p>
        </div>
      {:else}
        <div class="activity-list">
          {#each recentConversations as conv}
            <button
              class="activity-item"
              onclick={() => handleConversationClick(conv.id)}
            >
              <div class="activity-left">
                <span class="activity-channel-icon" title={conv.channel}>{getChannelIcon(conv.channel)}</span>
                <div class="activity-info">
                  <div class="activity-header">
                    <span class="activity-title">{getConversationDisplayTitle(conv)}</span>
                    <span class="activity-status" class:open={conv.status === 'open'} class:active={conv.status === 'active'} class:closed={conv.status === 'closed'}>
                      {conv.status}
                    </span>
                  </div>
                  {#if conv.lastMessagePreview}
                    <p class="activity-preview">{conv.lastMessagePreview}</p>
                  {/if}
                  <div class="activity-meta">
                    <span class="activity-time">{formatRelativeTime(conv.updatedAt)}</span>
                    {#if conv.repo}
                      <span class="activity-repo">{conv.repo.split('/').pop()}</span>
                    {/if}
                    {#if conv.usageCost && conv.usageCost > 0}
                      <span class="activity-cost">${conv.usageCost.toFixed(3)}</span>
                    {/if}
                  </div>
                </div>
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
  .dashboard {
    padding: var(--gigi-space-lg) var(--gigi-space-xl);
    overflow-y: auto;
    height: 100%;
  }

  /* ── Stats Row ─────────────────────────────────────────────────── */

  .stats-row {
    display: grid;
    grid-template-columns: auto repeat(4, 1fr);
    gap: var(--gigi-space-md);
    margin-bottom: var(--gigi-space-md);
    align-items: stretch;
  }

  @media (max-width: 900px) {
    .stats-row {
      grid-template-columns: repeat(2, 1fr);
    }
    .stat-actions {
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

  /* ── Cost Section ─────────────────────────────────────────────── */

  .cost-section {
    margin-bottom: var(--gigi-space-xl);
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

  .activity-left {
    display: flex;
    gap: var(--gigi-space-sm);
    align-items: flex-start;
  }

  .activity-channel-icon {
    font-size: var(--gigi-font-size-base);
    flex-shrink: 0;
    width: 24px;
    text-align: center;
    margin-top: 1px;
  }

  .activity-info {
    flex: 1;
    min-width: 0;
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

  .activity-preview {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 3px;
    line-height: 1.3;
  }

  .activity-status {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: var(--gigi-radius-full);
    flex-shrink: 0;
  }

  .activity-status.open {
    color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.12);
  }
  .activity-status.active {
    color: var(--gigi-accent-orange);
    background: rgba(210, 153, 34, 0.12);
  }
  .activity-status.closed {
    color: var(--gigi-text-muted);
    background: rgba(110, 118, 129, 0.12);
  }

  .activity-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .activity-time {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .activity-repo {
    font-size: 10px;
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.1);
    padding: 0 5px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
  }

  .activity-cost {
    font-size: 10px;
    color: var(--gigi-text-muted);
    font-variant-numeric: tabular-nums;
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
