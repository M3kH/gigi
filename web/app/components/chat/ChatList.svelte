<script lang="ts">
  /**
   * Conversation list with enriched data:
   * channel icon, activity dot, linked issues, time, preview, cost.
   */
  import {
    getConversations,
    getActiveConversationId,
    isAgentRunning,
    selectConversation,
  } from '$lib/stores/chat.svelte'
  import { getPanelState, setPanelState } from '$lib/stores/panels.svelte'
  import { formatRelativeTime, formatCost, formatTokens } from '$lib/utils/format'
  import type { Conversation } from '$lib/types/chat'

  const conversations = $derived(getConversations())
  const activeId = $derived(getActiveConversationId())

  function handleSelect(conv: Conversation) {
    selectConversation(conv.id)
    if (getPanelState('chatOverlay') === 'hidden') {
      setPanelState('chatOverlay', 'compact')
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
  {#each conversations as conv (conv.id)}
    <button
      class="chat-item"
      class:active={conv.id === activeId}
      onclick={() => handleSelect(conv)}
    >
      <!-- Row 1: channel icon + title + spinner -->
      <div class="chat-item-header">
        <span class="channel-icon" title={conv.channel}>{channelIcon(conv.channel)}</span>
        <span class="status-badge {statusClass(conv)}"></span>
        <span class="chat-title">{conv.topic}</span>
        {#if isAgentRunning(conv.id)}
          <span class="spinner">⟳</span>
        {/if}
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
      <span class="empty-text">No conversations yet</span>
    </div>
  {/each}
</div>

<style>
  .chat-list {
    display: flex;
    flex-direction: column;
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
  }

  .chat-item:hover {
    background: var(--gigi-bg-hover);
  }

  .chat-item.active {
    background: var(--gigi-bg-active);
    border-left: 2px solid var(--gigi-accent-green);
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
