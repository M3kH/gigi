<script lang="ts">
  /**
   * Conversation list with enriched data:
   * channel icon, activity dot, linked issues, time, preview, cost.
   * Supports filtering errors, auto-generated titles, archive, and delete.
   */
  import {
    getConversations,
    getArchivedConversations,
    getActiveConversationId,
    isAgentRunning,
    selectConversation,
    loadConversations,
    archiveConversation,
    unarchiveConversation,
    deleteConversation,
    stopThread,
    reopenThread,
    forkConversation,
  } from '$lib/stores/chat.svelte'
  import { getPanelState, setPanelState } from '$lib/stores/panels.svelte'
  import { formatRelativeTime, formatCost, formatTokens } from '$lib/utils/format'
  import type { Conversation } from '$lib/types/chat'

  const conversations = $derived(getConversations())
  const archived = $derived(getArchivedConversations())
  const activeId = $derived(getActiveConversationId())

  // Filter state: hide error-only conversations
  let hideErrors = $state(false)
  // Show/hide archived section
  let showArchived = $state(false)

  // Detect error/timeout conversations
  function isErrorConversation(conv: Conversation): boolean {
    const p = conv.lastMessagePreview?.toLowerCase() || ''
    const t = conv.topic?.toLowerCase() || ''
    return (
      p.includes('request timed out') ||
      p.includes('error: claude code process exited') ||
      p.includes('error:') ||
      t.includes('error') ||
      t.includes('timed out')
    )
  }

  // Auto-generate display title from preview when topic is generic
  function displayTitle(conv: Conversation): string {
    const topic = conv.topic
    // If topic is generic channel name, try to use the preview
    if (topic === 'web' || topic === 'telegram' || topic === 'webhook' || topic === 'Untitled') {
      if (conv.lastMessagePreview) {
        // Use first ~50 chars of preview, strip context prefix
        const stripped = conv.lastMessagePreview.replace(/^\[Viewing [^\]]+\]\n?/, '')
        const trimmed = stripped.trim().slice(0, 50)
        return trimmed + (stripped.length > 50 ? '...' : '') || topic
      }
    }
    return topic
  }

  const filteredConversations = $derived(
    hideErrors ? conversations.filter(c => !isErrorConversation(c)) : conversations
  )

  const errorCount = $derived(
    conversations.filter(c => isErrorConversation(c)).length
  )

  function handleSelect(conv: Conversation) {
    selectConversation(conv.id)
    if (getPanelState('chatOverlay') === 'hidden') {
      setPanelState('chatOverlay', 'compact')
    }
  }

  async function handleArchive(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    await archiveConversation(conv.id)
  }

  async function handleUnarchive(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    await unarchiveConversation(conv.id)
  }

  async function handleDelete(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    if (!confirm(`Permanently delete "${displayTitle(conv)}"?`)) return
    await deleteConversation(conv.id)
  }

  async function handleStopThread(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    await stopThread(conv.id)
  }

  async function handleReopen(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    await reopenThread(conv.id)
  }

  async function handleFork(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    await forkConversation(conv.id)
  }

  function statusClass(conv: Conversation): string {
    if (isAgentRunning(conv.id)) return 'active'
    return conv.status || 'paused'
  }

  function statusTooltip(conv: Conversation): string {
    if (isAgentRunning(conv.id)) return 'Agent running'
    switch (conv.status) {
      case 'active': return 'Agent running'
      case 'paused': return 'Ready for more work'
      case 'stopped': return 'Completed'
      case 'archived': return 'Archived'
      default: return conv.status
    }
  }

  function channelIcon(channel: string): string {
    switch (channel) {
      case 'telegram': return '📱'
      case 'webhook': return '⚡'
      case 'web': return '💬'
      case 'gitea_comment': return '💬'
      case 'gitea_review': return '👀'
      case 'system': return '⚙️'
      default: return '💬'
    }
  }

  function channelLabel(channel: string): string {
    switch (channel) {
      case 'telegram': return 'TG'
      case 'webhook': return 'WH'
      case 'web': return 'WB'
      case 'gitea_comment': return 'GI'
      case 'gitea_review': return 'RV'
      case 'system': return 'SY'
      default: return 'WB'
    }
  }
</script>

<div class="chat-list">
  <!-- Error filter toggle -->
  {#if errorCount > 0}
    <button class="filter-toggle" onclick={() => hideErrors = !hideErrors}>
      {hideErrors ? `Show ${errorCount} errors` : `Hide ${errorCount} errors`}
    </button>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  {#each filteredConversations as conv (conv.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="chat-item"
      class:active={conv.id === activeId}
      class:error-conv={isErrorConversation(conv)}
      onclick={() => handleSelect(conv)}
      onkeydown={(e) => e.key === 'Enter' && handleSelect(conv)}
      tabindex="0"
      role="button"
    >
      <!-- Row 1: channel icon + title + spinner + actions -->
      <div class="chat-item-header">
        <span class="channel-icon" title={conv.channel}>{channelIcon(conv.channel)}<span class="channel-label">{channelLabel(conv.channel)}</span></span>
        <span class="status-badge {statusClass(conv)}" title={statusTooltip(conv)}></span>
        <span class="chat-title">{displayTitle(conv)}</span>
        {#if isAgentRunning(conv.id)}
          <span class="spinner">&#x27F3;</span>
        {/if}
        <div class="action-btns">
          {#if conv.status === 'paused' || conv.status === 'active'}
            <button
              class="action-btn stop-btn"
              title="Stop thread (mark as done)"
              onclick={(e) => handleStopThread(e, conv)}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M4.5 2A2.5 2.5 0 002 4.5v7A2.5 2.5 0 004.5 14h7a2.5 2.5 0 002.5-2.5v-7A2.5 2.5 0 0011.5 2h-7z"/>
              </svg>
            </button>
          {/if}
          {#if conv.status === 'stopped'}
            <button
              class="action-btn reopen-btn"
              title="Reopen thread"
              onclick={(e) => handleReopen(e, conv)}
            >↩</button>
          {/if}
          <button
            class="action-btn fork-btn"
            title="Fork thread (explore alternate direction)"
            onclick={(e) => handleFork(e, conv)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-1.72 1.97a2.25 2.25 0 1 0-1.06 0C2.08 6.45 2 7.69 2 8v.75c0 1.107.608 2.076 1.508 2.585a2.25 2.25 0 1 0 1.042-.044A1.75 1.75 0 0 1 3.5 9.75V8c0-.536.034-1.058.272-1.78h-.002ZM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm7.772-1.72a.75.75 0 1 0-1.042.044c.9.509 1.508 1.478 1.508 2.585v.341h-.002A2.25 2.25 0 1 0 14 12.75v-.75c0-.311-.08-1.55-.228-2.78ZM11.25 3a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm0 10.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z"/>
            </svg>
          </button>
          <button
            class="action-btn archive-btn"
            title="Archive conversation"
            onclick={(e) => handleArchive(e, conv)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M1.75 2.5a.25.25 0 0 0-.25.25v1.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-1.5a.25.25 0 0 0-.25-.25Zm0-1.5h12.5A1.75 1.75 0 0 1 16 2.75v1.5A1.75 1.75 0 0 1 14.25 6H1.75A1.75 1.75 0 0 1 0 4.25v-1.5A1.75 1.75 0 0 1 1.75 1ZM1.5 7.75v6.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25ZM1.75 6A1.75 1.75 0 0 0 0 7.75v6.5C0 15.216.784 16 1.75 16h12.5A1.75 1.75 0 0 0 16 14.25v-6.5A1.75 1.75 0 0 0 14.25 6Zm4.75 3.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z"/>
            </svg>
          </button>
          <button
            class="action-btn delete-btn"
            title="Delete conversation"
            onclick={(e) => handleDelete(e, conv)}
          >&times;</button>
        </div>
      </div>

      <!-- Row 2: preview -->
      {#if conv.lastMessagePreview}
        <div class="chat-preview">{conv.lastMessagePreview}</div>
      {/if}

      <!-- Row 3: meta (time, repo/tags, cost) -->
      <div class="chat-meta">
        {#if conv.createdAt}
          <span class="meta-time">{formatRelativeTime(conv.createdAt)}</span>
        {/if}
        {#if conv.repo}
          <span class="meta-repo">{conv.repo}</span>
        {/if}
        {#each conv.tags.slice(0, 2) as tag}
          <span class="chat-tag">{tag}</span>
        {/each}
        {#if conv.refCount && conv.refCount > 0}
          <span class="meta-refs" title="{conv.refCount} linked ref{conv.refCount > 1 ? 's' : ''}">🔗{conv.refCount}</span>
        {/if}
        <span class="meta-spacer"></span>
        {#if conv.usageCost}
          <span class="meta-cost" title="{formatTokens(conv.usageInputTokens)} in / {formatTokens(conv.usageOutputTokens)} out">
            {formatCost(conv.usageCost)}
          </span>
        {/if}
      </div>
    </div>
  {:else}
    <div class="empty-list">
      <span class="empty-text">{hideErrors ? 'No non-error conversations' : 'No conversations yet'}</span>
    </div>
  {/each}

  <!-- Archived section -->
  {#if archived.length > 0}
    <button class="archive-toggle" onclick={() => showArchived = !showArchived}>
      <svg class="archive-chevron" class:open={showArchived} viewBox="0 0 16 16" width="10" height="10" fill="currentColor">
        <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
      </svg>
      Archived ({archived.length})
    </button>

    {#if showArchived}
      {#each archived as conv (conv.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="chat-item archived"
          class:active={conv.id === activeId}
          onclick={() => handleSelect(conv)}
          onkeydown={(e) => e.key === 'Enter' && handleSelect(conv)}
          tabindex="0"
          role="button"
        >
          <div class="chat-item-header">
            <span class="channel-icon" title={conv.channel}>{channelIcon(conv.channel)}</span>
            <span class="chat-title">{displayTitle(conv)}</span>
            <div class="action-btns">
              <button
                class="action-btn unarchive-btn"
                title="Unarchive"
                onclick={(e) => handleUnarchive(e, conv)}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                  <path d="M3.5 6.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1-.5-.5Zm4-4.5a.5.5 0 0 1 .5.5v5.793l1.146-1.147a.5.5 0 1 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 8.293V2.5a.5.5 0 0 1 .5-.5Z"/>
                </svg>
              </button>
              <button
                class="action-btn delete-btn"
                title="Delete permanently"
                onclick={(e) => handleDelete(e, conv)}
              >&times;</button>
            </div>
          </div>
          {#if conv.lastMessagePreview}
            <div class="chat-preview">{conv.lastMessagePreview}</div>
          {/if}
          <div class="chat-meta">
            {#if conv.createdAt}
              <span class="meta-time">{formatRelativeTime(conv.createdAt)}</span>
            {/if}
            <span class="meta-spacer"></span>
            {#if conv.usageCost}
              <span class="meta-cost">{formatCost(conv.usageCost)}</span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .chat-list {
    display: flex;
    flex-direction: column;
  }

  .filter-toggle {
    display: block;
    width: 100%;
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    background: var(--gigi-bg-tertiary);
    border: none;
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    color: var(--gigi-accent-blue);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    text-align: center;
    font-family: var(--gigi-font-sans);
  }

  .filter-toggle:hover {
    background: var(--gigi-bg-hover);
  }

  .chat-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    cursor: pointer;
    border: none;
    background: transparent;
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    transition: background var(--gigi-transition-fast);
    font-family: var(--gigi-font-sans);
    position: relative;
  }

  .chat-item:hover {
    background: var(--gigi-bg-hover);
  }

  .chat-item.active {
    background: var(--gigi-bg-active);
    border-left: 2px solid var(--gigi-accent-green);
  }

  .chat-item.error-conv {
    opacity: 0.6;
  }

  .chat-item.archived {
    opacity: 0.65;
  }

  /* ── Header row ──────────────────────────────────────────────── */

  .chat-item-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
  }

  .channel-icon {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    font-size: 9px;
    font-weight: 700;
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-tertiary);
    padding: 1px 3px;
    border-radius: 2px;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .channel-label {
    font-size: 7px;
    opacity: 0.7;
  }

  .status-badge {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-badge.paused {
    background: var(--gigi-accent-green);
  }

  .status-badge.active {
    background: var(--gigi-accent-orange);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-badge.stopped {
    background: var(--gigi-text-muted);
  }

  .status-badge.archived {
    background: var(--gigi-text-muted);
    opacity: 0.5;
  }

  /* Legacy compat */
  .status-badge.open {
    background: var(--gigi-accent-green);
  }

  .status-badge.closed {
    background: var(--gigi-text-muted);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .chat-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .spinner {
    font-size: 0.75rem;
    animation: spin 1s linear infinite;
    flex-shrink: 0;
    color: var(--gigi-accent-orange);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Action buttons ─────────────────────────────────────────── */

  .action-btns {
    display: none;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .chat-item:hover .action-btns {
    display: flex;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    padding: 2px;
    line-height: 1;
    font-family: var(--gigi-font-sans);
    border-radius: var(--gigi-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: var(--gigi-bg-tertiary);
  }

  .stop-btn:hover {
    color: var(--gigi-text-muted);
  }

  .reopen-btn {
    font-size: 0.75rem;
  }

  .reopen-btn:hover {
    color: var(--gigi-accent-green);
  }

  .fork-btn:hover {
    color: var(--gigi-accent-purple, #a371f7);
  }

  .archive-btn:hover {
    color: var(--gigi-accent-blue);
  }

  .unarchive-btn:hover {
    color: var(--gigi-accent-green);
  }

  .delete-btn {
    font-size: 1rem;
  }

  .delete-btn:hover {
    color: var(--gigi-accent-red);
  }

  /* ── Archive toggle ─────────────────────────────────────────── */

  .archive-toggle {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    width: 100%;
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    background: var(--gigi-bg-tertiary);
    border: none;
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
  }

  .archive-toggle:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-secondary);
  }

  .archive-chevron {
    transition: transform var(--gigi-transition-fast);
  }

  .archive-chevron.open {
    transform: rotate(90deg);
  }

  /* ── Preview ─────────────────────────────────────────────────── */

  .chat-preview {
    font-size: 11px;
    color: var(--gigi-text-muted);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  /* ── Meta row ────────────────────────────────────────────────── */

  .chat-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 3px;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .meta-time {
    font-size: 10px;
    color: var(--gigi-text-muted);
    flex-shrink: 0;
  }

  .meta-repo {
    font-size: 9px;
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.1);
    padding: 0 4px;
    border-radius: var(--gigi-radius-full);
    flex-shrink: 0;
  }

  .chat-tag {
    font-size: 9px;
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-tertiary);
    padding: 0 4px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .meta-refs {
    font-size: 9px;
    color: var(--gigi-accent-blue);
    flex-shrink: 0;
  }

  .meta-spacer {
    flex: 1;
  }

  .meta-cost {
    font-size: 9px;
    color: var(--gigi-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  /* ── Empty state ─────────────────────────────────────────────── */

  .empty-list {
    padding: var(--gigi-space-lg);
    text-align: center;
  }

  .empty-text {
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
  }
</style>
