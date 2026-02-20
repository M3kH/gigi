<script lang="ts">
  /**
   * Conversation list with enriched data:
   * channel icon, activity dot, linked issues, time, preview, cost.
   * Supports filtering errors, auto-generated titles, and delete functionality.
   */
  import {
    getConversations,
    getActiveConversationId,
    isAgentRunning,
    selectConversation,
    loadConversations,
  } from '$lib/stores/chat.svelte'
  import { getPanelState, setPanelState } from '$lib/stores/panels.svelte'
  import { formatRelativeTime, formatCost, formatTokens } from '$lib/utils/format'
  import type { Conversation } from '$lib/types/chat'

  const conversations = $derived(getConversations())
  const activeId = $derived(getActiveConversationId())

  // Filter state: hide error-only conversations
  let hideErrors = $state(false)

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

  async function handleDelete(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    if (!confirm(`Delete conversation "${displayTitle(conv)}"?`)) return
    try {
      await fetch(`/api/conversations/${conv.id}`, { method: 'DELETE' })
      await loadConversations()
    } catch (err) {
      console.error('[chat] Delete failed:', err)
    }
  }

  function statusClass(conv: Conversation): string {
    if (isAgentRunning(conv.id)) return 'active'
    return conv.status || 'open'
  }

  function channelIcon(channel: string): string {
    switch (channel) {
      case 'telegram': return 'TG'
      case 'webhook': return 'WH'
      case 'web': return 'WB'
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

  {#each filteredConversations as conv (conv.id)}
    <button
      class="chat-item"
      class:active={conv.id === activeId}
      class:error-conv={isErrorConversation(conv)}
      onclick={() => handleSelect(conv)}
    >
      <!-- Row 1: channel icon + title + spinner + delete -->
      <div class="chat-item-header">
        <span class="channel-icon" title={conv.channel}>{channelIcon(conv.channel)}</span>
        <span class="status-badge {statusClass(conv)}"></span>
        <span class="chat-title">{displayTitle(conv)}</span>
        {#if isAgentRunning(conv.id)}
          <span class="spinner">⟳</span>
        {/if}
        <button
          class="delete-btn"
          title="Delete conversation"
          onclick={(e) => handleDelete(e, conv)}
        >×</button>
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
        <span class="meta-spacer"></span>
        {#if conv.usageCost}
          <span class="meta-cost" title="{formatTokens(conv.usageInputTokens)} in / {formatTokens(conv.usageOutputTokens)} out">
            {formatCost(conv.usageCost)}
          </span>
        {/if}
      </div>
    </button>
  {:else}
    <div class="empty-list">
      <span class="empty-text">{hideErrors ? 'No non-error conversations' : 'No conversations yet'}</span>
    </div>
  {/each}
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

  /* ── Header row ──────────────────────────────────────────────── */

  .chat-item-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
  }

  .channel-icon {
    font-size: 8px;
    font-weight: 700;
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-tertiary);
    padding: 1px 3px;
    border-radius: 2px;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .status-badge {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-badge.open {
    background: var(--gigi-accent-green);
  }

  .status-badge.active {
    background: var(--gigi-accent-orange);
    animation: pulse 1.5s ease-in-out infinite;
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

  .delete-btn {
    display: none;
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    font-family: var(--gigi-font-sans);
  }

  .delete-btn:hover {
    color: var(--gigi-accent-red);
  }

  .chat-item:hover .delete-btn {
    display: block;
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
