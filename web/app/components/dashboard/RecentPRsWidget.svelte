<script lang="ts">
  /**
   * Pull Requests Widget
   *
   * Shows open PRs prominently sorted recent → old.
   * When no open PRs exist, shows Gigi zen logo with a
   * collapsible archive drawer for recently closed/merged PRs.
   */

  import { formatRelativeTime } from '$lib/utils/format'
  import { navigateToPull } from '$lib/stores/navigation.svelte'

  interface RecentPR {
    number: number
    title: string
    state: string // 'open' | 'merged' | 'closed'
    user: { login: string; avatar_url: string } | null
    repo: string
    head_branch: string
    base_branch: string
    html_url: string
    created_at: string
    updated_at: string
    merged_at: string | null
  }

  interface Props {
    openPRs: RecentPR[]
    closedPRs: RecentPR[]
    owner: string
    loading?: boolean
  }

  let { openPRs, closedPRs, owner, loading = false }: Props = $props()

  let archiveOpen = $state(false)

  const hasOpenPRs = $derived(openPRs.length > 0)

  function getStateIcon(state: string): string {
    switch (state) {
      case 'merged': return 'merged'
      case 'open': return 'open'
      case 'closed': return 'closed'
      default: return 'open'
    }
  }

  function toggleArchive(): void {
    archiveOpen = !archiveOpen
  }
</script>

<section class="widget">
  <h2 class="widget-title">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/>
    </svg>
    Pull Requests
    {#if openPRs.length > 0}
      <span class="widget-count">{openPRs.length} open</span>
    {/if}
  </h2>

  {#if loading}
    <div class="loading-list">
      {#each Array(3) as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if hasOpenPRs}
    <!-- Open PRs list -->
    <div class="pr-list">
      {#each openPRs as pr}
        <button
          class="pr-item"
          onclick={() => navigateToPull(owner, pr.repo, pr.number)}
          title="#{pr.number} {pr.title}"
        >
          <span class="pr-state pr-state-open">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
          </span>
          <div class="pr-info">
            <div class="pr-header">
              <span class="pr-title">
                <span class="pr-number">#{pr.number}</span>
                {pr.title}
              </span>
            </div>
            <div class="pr-meta">
              <span class="pr-label pr-label-open">open</span>
              <span class="pr-repo">{pr.repo}</span>
              {#if pr.user}
                <span class="pr-author">{pr.user.login}</span>
              {/if}
              <span class="pr-time">{formatRelativeTime(pr.updated_at)}</span>
            </div>
          </div>
        </button>
      {/each}
    </div>

    <!-- Archive drawer for closed PRs when open PRs exist -->
    {#if closedPRs.length > 0}
      <button class="archive-toggle" onclick={toggleArchive}>
        <svg class="archive-chevron" class:archive-chevron-open={archiveOpen} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 17V7l5 5-5 5z"/>
        </svg>
        {closedPRs.length} recently closed
      </button>
      {#if archiveOpen}
        <div class="pr-list archive-list">
          {#each closedPRs as pr}
            <button
              class="pr-item pr-item-archived"
              onclick={() => navigateToPull(owner, pr.repo, pr.number)}
              title="#{pr.number} {pr.title}"
            >
              <span class="pr-state pr-state-{getStateIcon(pr.state)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
              </span>
              <div class="pr-info">
                <div class="pr-header">
                  <span class="pr-title">
                    <span class="pr-number">#{pr.number}</span>
                    {pr.title}
                  </span>
                </div>
                <div class="pr-meta">
                  <span class="pr-label pr-label-{getStateIcon(pr.state)}">{pr.state}</span>
                  <span class="pr-repo">{pr.repo}</span>
                  <span class="pr-time">{formatRelativeTime(pr.merged_at ?? pr.updated_at)}</span>
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {:else}
    <!-- No open PRs: zen state -->
    <div class="zen-state">
      <img src="/gigi-zen.png" alt="Gigi zen" class="zen-logo" width="96" />
      <p class="zen-text">All clear — no open pull requests</p>
    </div>

    <!-- Archive drawer for closed PRs -->
    {#if closedPRs.length > 0}
      <button class="archive-toggle" onclick={toggleArchive}>
        <svg class="archive-chevron" class:archive-chevron-open={archiveOpen} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 17V7l5 5-5 5z"/>
        </svg>
        See the latest {closedPRs.length} closed PRs
      </button>
      {#if archiveOpen}
        <div class="pr-list archive-list">
          {#each closedPRs as pr}
            <button
              class="pr-item pr-item-archived"
              onclick={() => navigateToPull(owner, pr.repo, pr.number)}
              title="#{pr.number} {pr.title}"
            >
              <span class="pr-state pr-state-{getStateIcon(pr.state)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
              </span>
              <div class="pr-info">
                <div class="pr-header">
                  <span class="pr-title">
                    <span class="pr-number">#{pr.number}</span>
                    {pr.title}
                  </span>
                </div>
                <div class="pr-meta">
                  <span class="pr-label pr-label-{getStateIcon(pr.state)}">{pr.state}</span>
                  <span class="pr-repo">{pr.repo}</span>
                  <span class="pr-time">{formatRelativeTime(pr.merged_at ?? pr.updated_at)}</span>
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
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
    background: rgba(63, 185, 80, 0.12);
    color: var(--gigi-accent-green);
    padding: 1px 7px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
    margin-left: 2px;
  }

  .pr-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .pr-item {
    display: flex;
    align-items: flex-start;
    gap: var(--gigi-space-sm);
    width: 100%;
    text-align: left;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    font-family: var(--gigi-font-sans);
    color: inherit;
  }

  .pr-item:hover {
    border-color: var(--gigi-accent-purple);
    background: var(--gigi-bg-hover);
  }

  .pr-item-archived {
    opacity: 0.7;
  }

  .pr-item-archived:hover {
    opacity: 1;
  }

  .pr-state {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .pr-state-open { color: var(--gigi-accent-green); }
  .pr-state-merged { color: var(--gigi-accent-purple); }
  .pr-state-closed { color: var(--gigi-accent-red); }

  .pr-info {
    flex: 1;
    min-width: 0;
  }

  .pr-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .pr-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 1.3;
  }

  .pr-number {
    color: var(--gigi-text-muted);
    font-weight: 400;
    margin-right: 4px;
  }

  .pr-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    margin-top: 2px;
  }

  .pr-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0px 5px;
    border-radius: var(--gigi-radius-full);
  }

  .pr-label-open {
    color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.12);
  }
  .pr-label-merged {
    color: var(--gigi-accent-purple);
    background: rgba(188, 140, 255, 0.12);
  }
  .pr-label-closed {
    color: var(--gigi-accent-red);
    background: rgba(248, 81, 73, 0.12);
  }

  .pr-repo {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.08);
    padding: 0 5px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
  }

  .pr-author {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .pr-time {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  /* ── Zen / Empty State ──────────────────────────────────────── */

  .zen-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xl) var(--gigi-space-lg);
  }

  .zen-logo {
    opacity: 0.5;
    filter: grayscale(0.3);
    transition: opacity var(--gigi-transition-fast);
  }

  .zen-state:hover .zen-logo {
    opacity: 0.7;
  }

  .zen-text {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-muted);
    text-align: center;
  }

  /* ── Archive Drawer ──────────────────────────────────────────── */

  .archive-toggle {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    width: 100%;
    margin-top: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: none;
    border: none;
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    text-align: left;
  }

  .archive-toggle:hover {
    color: var(--gigi-text-secondary);
    background: var(--gigi-bg-hover);
  }

  .archive-chevron {
    transition: transform var(--gigi-transition-fast);
    flex-shrink: 0;
  }

  .archive-chevron-open {
    transform: rotate(90deg);
  }

  .archive-list {
    margin-top: var(--gigi-space-xs);
    padding-left: 0;
  }

  /* Loading */
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
</style>
