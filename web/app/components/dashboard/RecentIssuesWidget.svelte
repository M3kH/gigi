<script lang="ts">
  /**
   * Recent Issues Widget
   *
   * Shows the latest recently-updated issues across all repos.
   * Data comes from the overview API response.
   */

  import { formatRelativeTime } from '$lib/utils/format'

  interface IssueLabel {
    name: string
    color: string
  }

  interface RecentIssue {
    number: number
    title: string
    state: string // 'open' | 'closed'
    user: { login: string; avatar_url: string } | null
    repo: string
    labels: IssueLabel[]
    comments: number
    html_url: string
    created_at: string
    updated_at: string
    closed_at: string | null
  }

  interface Props {
    issues: RecentIssue[]
    loading?: boolean
  }

  let { issues, loading = false }: Props = $props()

  /** Get non-status labels for compact display */
  function displayLabels(labels: IssueLabel[]): IssueLabel[] {
    return labels.filter(l => !l.name.startsWith('status/')).slice(0, 3)
  }

  /** Normalize hex color for CSS (add # if missing) */
  function normalizeColor(color: string): string {
    return color.startsWith('#') ? color : `#${color}`
  }
</script>

<section class="widget">
  <h2 class="widget-title">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 2H6v2H4v2H2v12h2v2h2v2h12v-2h2v-2h2V6h-2V4h-2V2zm0 2v2h2v12h-2v2H6v-2H4V6h2V4h12zm-8 6h4v4h-4v-4zM8 6h8v2H8V6zm0 10H6V8h2v8zm8 0v2H8v-2h8zm0 0h2V8h-2v8z"/>
    </svg>
    Recent Issues
    {#if issues.length > 0}
      <span class="widget-count">{issues.length}</span>
    {/if}
  </h2>

  {#if loading}
    <div class="loading-list">
      {#each Array(3) as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if issues.length === 0}
    <div class="widget-empty">
      <p>No recent issues</p>
    </div>
  {:else}
    <div class="issue-list">
      {#each issues as issue}
        <a
          class="issue-item"
          href={issue.html_url}
          target="_blank"
          rel="noopener noreferrer"
          title="#{issue.number} {issue.title}"
        >
          <span class="issue-state" class:issue-open={issue.state === 'open'} class:issue-closed={issue.state === 'closed'}>
            {#if issue.state === 'open'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6v2H4v2H2v12h2v2h2v2h12v-2h2v-2h2V6h-2V4h-2V2zm0 2v2h2v12h-2v2H6v-2H4V6h2V4h12zm-8 6h4v4h-4v-4zM8 6h8v2H8V6zm0 10H6V8h2v8zm8 0v2H8v-2h8zm0 0h2V8h-2v8z"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h2v2h-2V4zm-2 4V6h2v2h-2zm-2 0h2v2h-2V8zm0 0h-2V6h2v2zM3 6h8v2H3V6zm8 10H3v2h8v-2zm7 2v-2h2v-2h-2v2h-2v-2h-2v2h2v2h-2v2h2v-2h2zm0 0v2h2v-2h-2z"/></svg>
            {/if}
          </span>
          <div class="issue-info">
            <div class="issue-header">
              <span class="issue-title">
                <span class="issue-number">#{issue.number}</span>
                {issue.title}
              </span>
            </div>
            <div class="issue-meta">
              <span class="issue-label issue-label-{issue.state}">{issue.state}</span>
              <span class="issue-repo">{issue.repo}</span>
              {#each displayLabels(issue.labels) as label}
                <span class="label-dot" style="background: {normalizeColor(label.color)}" title={label.name}></span>
              {/each}
              {#if issue.comments > 0}
                <span class="issue-comments" title="{issue.comments} comments">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z"/></svg>
                  {issue.comments}
                </span>
              {/if}
              <span class="issue-time">{formatRelativeTime(issue.updated_at)}</span>
            </div>
          </div>
        </a>
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

  .issue-list {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  .issue-item {
    display: flex;
    align-items: flex-start;
    gap: var(--gigi-space-sm);
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
    text-decoration: none;
    color: inherit;
  }

  .issue-item:hover {
    border-color: var(--gigi-accent-orange);
    background: var(--gigi-bg-hover);
  }

  .issue-state {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .issue-open { color: var(--gigi-accent-green); }
  .issue-closed { color: var(--gigi-accent-purple); }

  .issue-info {
    flex: 1;
    min-width: 0;
  }

  .issue-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .issue-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 1.3;
  }

  .issue-number {
    color: var(--gigi-text-muted);
    font-weight: 400;
    margin-right: 4px;
  }

  .issue-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    margin-top: 2px;
    flex-wrap: wrap;
  }

  .issue-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0px 5px;
    border-radius: var(--gigi-radius-full);
  }

  .issue-label-open {
    color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.12);
  }
  .issue-label-closed {
    color: var(--gigi-accent-purple);
    background: rgba(188, 140, 255, 0.12);
  }

  .issue-repo {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.08);
    padding: 0 5px;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
  }

  .label-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .issue-comments {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .issue-time {
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
