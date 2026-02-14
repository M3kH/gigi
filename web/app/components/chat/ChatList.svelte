<script lang="ts">
  /**
   * Conversation list with live status badges and spinners.
   *
   * Fetches from the chat store, shows status, tags, and running indicator.
   */
  import {
    getConversations,
    getActiveConversationId,
    isAgentRunning,
    selectConversation,
    newConversation,
  } from '$lib/stores/chat.svelte'
  import { formatTime } from '$lib/utils/format'
  import type { Conversation } from '$lib/types/chat'

  interface Props {
    compact?: boolean
  }

  const { compact = false }: Props = $props()

  const conversations = $derived(getConversations())
  const activeId = $derived(getActiveConversationId())

  function handleSelect(conv: Conversation) {
    selectConversation(conv.id)
  }

  function handleNewChat() {
    newConversation()
  }

  function statusClass(conv: Conversation): string {
    if (isAgentRunning(conv.id)) return 'active'
    return conv.status || 'open'
  }
</script>

<div class="chat-list">
  {#each conversations as conv (conv.id)}
    <button
      class="chat-item"
      class:active={conv.id === activeId}
      onclick={() => handleSelect(conv)}
    >
      <div class="chat-item-header">
        <span class="status-badge {statusClass(conv)}"></span>
        <span class="chat-title">{conv.topic}</span>
        {#if isAgentRunning(conv.id)}
          <span class="spinner">⟳</span>
        {/if}
      </div>
      {#if !compact}
        {#if conv.tags.length > 0}
          <div class="chat-tags">
            {#each conv.tags as tag}
              <span class="chat-tag">{tag}</span>
            {/each}
          </div>
        {/if}
      {/if}
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

  .chat-item-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
  }

  .status-badge {
    width: 8px;
    height: 8px;
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

  .chat-tags {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.2rem;
    flex-wrap: wrap;
  }

  .chat-tag {
    font-size: 0.6rem;
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-tertiary);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }

  .empty-list {
    padding: var(--gigi-space-lg);
    text-align: center;
  }

  .empty-text {
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
  }
</style>
