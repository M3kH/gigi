<script lang="ts">
  /**
   * Recent Pull Requests Widget
   *
   * Shows the latest PRs (open + recently merged) across all repos.
   * Data comes from the overview API response.
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
    prs: RecentPR[]
    owner: string
    loading?: boolean
  }

  let { prs, owner, loading = false }: Props = $props()

  function getStateIcon(state: string): string {
    switch (state) {
      case 'merged': return 'merged'
      case 'open': return 'open'
      case 'closed': return 'closed'
      default: return 'open'
    }
  }
</script>

<section class="widget">
  <h2 class="widget-title">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/>
    </svg>
    Recent PRs
    {#if prs.length > 0}
      <span class="widget-count">{prs.length}</span>
    {/if}
  </h2>

  {#if loading}
    <div class="loading-list">
      {#each Array(3) as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if prs.length === 0}
    <div class="widget-empty">
      <p>No recent pull requests</p>
    </div>
  {:else}
    <div class="pr-list">
      {#each prs as pr}
        <button
          class="pr-item"
          onclick={() => navigateToPull(owner, pr.repo, pr.number)}
          title="#{pr.number} {pr.title}"
        >
          <span class="pr-state pr-state-{getStateIcon(pr.state)}">
            {#if pr.state === 'merged'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
            {:else if pr.state === 'open'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
            {/if}
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
              {#if pr.user}
                <span class="pr-author">{pr.user.login}</span>
              {/if}
              <span class="pr-time">{formatRelativeTime(pr.merged_at ?? pr.updated_at)}</span>
            </div>
          </div>
        </button>
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

  /* Loading / Empty */
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

  .widget-empty {
    text-align: center;
    padding: var(--gigi-space-lg);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }
</style>
