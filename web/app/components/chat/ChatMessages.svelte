<script lang="ts">
  /**
   * Chat message stream — unified segment rendering
   *
   * Renders the full conversation:
   * - Historical messages (from store) with date separators
   * - Live streaming segments in chronological order
   * - Typing indicator
   */
  import type { StreamSegment, ChatMessage as ChatMessageType, ThreadLineage } from '$lib/types/chat'
  import {
    getMessages,
    getDialogState,
    getStreamSegments,
    getActiveConversationId,
    getThreadLineage,
    selectConversation,
  } from '$lib/stores/chat.svelte'
  import { renderMarkdown, highlightAll } from '$lib/utils/markdown'
  import { getToolDescription } from '$lib/utils/tool-descriptions'
  import { interceptLinks } from '$lib/utils/intercept-links'
  import ChatMessageComponent from './ChatMessage.svelte'
  import ToolBlock from './ToolBlock.svelte'
  import AskUser from './AskUser.svelte'
  import SystemMessage from './SystemMessage.svelte'

  const messages = $derived(getMessages())
  const dialogState = $derived(getDialogState())
  const segments = $derived(getStreamSegments())
  const activeId = $derived(getActiveConversationId())

  // Thread lineage state
  let lineage = $state<ThreadLineage | null>(null)

  // Fetch lineage when active conversation changes
  $effect(() => {
    const id = activeId
    if (id) {
      getThreadLineage(id).then(l => { lineage = l })
    } else {
      lineage = null
    }
  })

  function navigateToThread(threadId: string) {
    selectConversation(threadId)
  }

  let messagesEl: HTMLDivElement | undefined = $state()

  function segmentKey(seg: StreamSegment, i: number): string {
    switch (seg.type) {
      case 'tool': return seg.toolUseId
      case 'ask_user': return seg.questionId
      case 'system': return `sys-${i}`
      case 'text': return `text-${i}`
    }
  }

  // Format a date separator label (e.g. "Feb 18" or "Today")
  function formatDateSeparator(dateStr: string): string {
    const d = new Date(dateStr)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()

    if (isToday) return 'Today'
    if (isYesterday) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Check if a date separator should be shown before this message
  function shouldShowDateSeparator(msg: ChatMessageType, index: number, allMessages: ChatMessageType[]): boolean {
    if (!msg.createdAt) return false
    if (index === 0) return true
    const prev = allMessages[index - 1]
    if (!prev.createdAt) return true
    const d1 = new Date(prev.createdAt).toDateString()
    const d2 = new Date(msg.createdAt).toDateString()
    return d1 !== d2
  }

  // Auto-scroll on new content
  $effect(() => {
    messages.length
    segments.length
    dialogState

    if (messagesEl) {
      requestAnimationFrame(() => {
        if (messagesEl) {
          messagesEl.scrollTop = messagesEl.scrollHeight
        }
      })
    }
  })

  // Highlight code blocks in streaming text segments
  $effect(() => {
    // Re-run whenever segments change
    segments.length

    if (messagesEl) {
      requestAnimationFrame(() => {
        if (messagesEl) highlightAll(messagesEl)
      })
    }
  })
</script>

<div class="messages-area" bind:this={messagesEl}>
  <!-- Fork lineage banner -->
  {#if lineage?.parent || (lineage?.children && lineage.children.length > 0)}
    <div class="lineage-banner">
      {#if lineage?.parent}
        <span class="lineage-item">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" class="lineage-icon">
            <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-1.72 1.97a2.25 2.25 0 1 0-1.06 0C2.08 6.45 2 7.69 2 8v.75c0 1.107.608 2.076 1.508 2.585a2.25 2.25 0 1 0 1.042-.044A1.75 1.75 0 0 1 3.5 9.75V8c0-.536.034-1.058.272-1.78h-.002ZM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm7.772-1.72a.75.75 0 1 0-1.042.044c.9.509 1.508 1.478 1.508 2.585v.341h-.002A2.25 2.25 0 1 0 14 12.75v-.75c0-.311-.08-1.55-.228-2.78ZM11.25 3a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm0 10.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z"/>
          </svg>
          Forked from
          <button class="lineage-link" onclick={() => navigateToThread(lineage!.parent!.id)}>
            {lineage.parent.topic || 'parent thread'}
          </button>
        </span>
      {/if}
      {#if lineage?.children && lineage.children.length > 0}
        <span class="lineage-item">
          {lineage.children.length} fork{lineage.children.length > 1 ? 's' : ''}:
          {#each lineage.children as child, i}
            <button class="lineage-link" onclick={() => navigateToThread(child.id)}>
              {child.topic || `Fork ${i + 1}`}
            </button>{#if i < lineage.children.length - 1}, {/if}
          {/each}
        </span>
      {/if}
    </div>
  {/if}

  {#if messages.length === 0 && segments.length === 0 && dialogState === 'idle'}
    <p class="empty-state">Send a message to get started</p>
  {:else}
    <!-- Historical messages with date separators -->
    {#each messages as msg, i (msg.id)}
      {#if shouldShowDateSeparator(msg, i, messages)}
        <div class="date-separator">
          <span class="date-separator-label">{formatDateSeparator(msg.createdAt)}</span>
        </div>
      {/if}
      <ChatMessageComponent message={msg} />
    {/each}

    <!-- Thinking indicator (before first segment arrives) -->
    {#if dialogState === 'thinking' && segments.length === 0}
      <div class="message assistant">
        <div class="meta">
          <span class="role">Gigi</span>
        </div>
        <div class="content">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Live streaming segments — chronological order -->
    {#each segments as seg, i (segmentKey(seg, i))}
      {#if seg.type === 'text'}
        <div class="message assistant">
          <div class="meta">
            <span class="role">Gigi</span>
          </div>
          <div class="content" use:interceptLinks>
            {@html renderMarkdown(seg.content)}
          </div>
        </div>
      {:else if seg.type === 'tool' && seg.name !== 'ask_user'}
        <div class="live-tool">
          <ToolBlock
            toolUseId={seg.toolUseId}
            name={seg.name}
            description={getToolDescription(seg.name)}
            input={seg.input}
            result={seg.result}
            status={seg.status}
            startedAt={seg.startedAt}
          />
        </div>
      {:else if seg.type === 'ask_user'}
        <AskUser block={seg} />
      {:else if seg.type === 'system'}
        <SystemMessage text={seg.text} />
      {/if}
    {/each}
  {/if}
</div>

<style>
  .messages-area {
    flex: 1;
    overflow-y: auto;
    padding: var(--gigi-space-md);
  }

  .empty-state {
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
    text-align: center;
    padding: var(--gigi-space-xl);
  }

  .message {
    margin-bottom: var(--gigi-space-lg);
    max-width: 80%;
  }

  /* Wider max-width in fullscreen chat mode */
  :global(.chat-full) .message {
    max-width: 95%;
  }

  .meta {
    display: flex;
    gap: var(--gigi-space-sm);
    font-size: 0.7rem;
    color: var(--gigi-text-muted);
    margin-bottom: var(--gigi-space-xs);
    align-items: center;
  }

  .role {
    font-weight: 500;
  }

  .content {
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-radius: var(--gigi-radius-lg) var(--gigi-radius-lg) var(--gigi-radius-lg) var(--gigi-radius-sm);
    font-size: var(--gigi-font-size-sm);
    line-height: 1.6;
    background: var(--gigi-bubble-assistant);
    border: 1px solid var(--gigi-border-muted);
  }

  /* Markdown styling for streaming content */
  .content :global(p) { margin: 0.5em 0; }
  .content :global(p:first-child) { margin-top: 0; }
  .content :global(p:last-child) { margin-bottom: 0; }
  .content :global(pre) {
    background: var(--gigi-bg-primary);
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    padding: var(--gigi-space-sm);
    margin: 0.5em 0;
    overflow-x: auto;
  }
  .content :global(code) {
    font-family: var(--gigi-font-mono, 'Monaco', 'Courier New', monospace);
    font-size: 0.85em;
  }
  .content :global(:not(pre) > code) {
    background: var(--gigi-bg-hover);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  .content :global(a) { color: var(--gigi-accent-blue); text-decoration: none; }
  .content :global(a:hover) { text-decoration: underline; }

  .live-tool {
    max-width: 80%;
    margin-bottom: var(--gigi-space-xs);
  }

  :global(.chat-full) .live-tool {
    max-width: 95%;
  }

  /* Lineage banner */
  .lineage-banner {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gigi-space-xs) var(--gigi-space-md);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    margin-bottom: var(--gigi-space-md);
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    align-items: center;
  }

  .lineage-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .lineage-icon {
    opacity: 0.6;
    flex-shrink: 0;
  }

  .lineage-link {
    background: none;
    border: none;
    color: var(--gigi-accent-purple, #a371f7);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
    font-family: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }

  .lineage-link:hover {
    color: var(--gigi-accent-blue);
    text-decoration-style: solid;
  }

  /* Date separator */
  .date-separator {
    display: flex;
    align-items: center;
    margin: var(--gigi-space-lg) 0;
    gap: var(--gigi-space-md);
  }

  .date-separator::before,
  .date-separator::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--gigi-border-muted);
  }

  .date-separator-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    white-space: nowrap;
    padding: 0 var(--gigi-space-sm);
  }

  /* Typing indicator */
  .typing-indicator {
    display: inline-flex;
    gap: 4px;
    padding: 0;
  }

  .typing-indicator span {
    width: 6px;
    height: 6px;
    background: var(--gigi-text-muted);
    border-radius: 50%;
    animation: typing 1.4s infinite;
  }

  .typing-indicator span:nth-child(2) {
    animation-delay: 0.2s;
  }

  .typing-indicator span:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes typing {
    0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
    30% { opacity: 1; transform: translateY(-6px); }
  }
</style>
