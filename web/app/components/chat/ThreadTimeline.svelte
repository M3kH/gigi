<script lang="ts">
  /**
   * Thread timeline — unified view showing events from all channels.
   *
   * Replaces the simple ChatMessages view with a cross-channel timeline
   * that includes channel badges, compacted sections, fork indicators,
   * refs bar, and thread actions.
   *
   * Falls back to legacy ChatMessages rendering when no thread events
   * are available (backward compat).
   */
  import type {
    StreamSegment,
    ChatMessage as ChatMessageType,
    ThreadLineage,
    ThreadEvent as ThreadEventType,
    ThreadRef,
    CompactStatus,
  } from '$lib/types/chat'
  import {
    getMessages,
    getDialogState,
    getStreamSegments,
    getActiveConversationId,
    getThreadLineage,
    getThreadEvents,
    getThreadRefs,
    getCompactStatus,
    selectConversation,
    forkConversation,
    compactThread,
  } from '$lib/stores/chat.svelte'
  import { renderMarkdown, highlightAll } from '$lib/utils/markdown'
  import { getToolDescription } from '$lib/utils/tool-descriptions'
  import { interceptLinks } from '$lib/utils/intercept-links'
  import ChatMessageComponent from './ChatMessage.svelte'
  import ThreadEventComponent from './ThreadEvent.svelte'
  import CompactedSection from './CompactedSection.svelte'
  import ForkIndicator from './ForkIndicator.svelte'
  import ThreadRefsBar from './ThreadRefsBar.svelte'
  import ThreadActions from './ThreadActions.svelte'
  import ToolBlock from './ToolBlock.svelte'
  import AskUser from './AskUser.svelte'
  import SystemMessage from './SystemMessage.svelte'
  import ChannelBadge from './ChannelBadge.svelte'
  import AddRefDialog from './AddRefDialog.svelte'

  const messages = $derived(getMessages())
  const dialogState = $derived(getDialogState())
  const segments = $derived(getStreamSegments())
  const activeId = $derived(getActiveConversationId())

  // Thread-specific state
  let lineage = $state<ThreadLineage | null>(null)
  let threadEvents = $state<ThreadEventType[]>([])
  let threadRefs = $state<ThreadRef[]>([])
  let compactStatus = $state<CompactStatus | null>(null)
  let hasThreadEvents = $state(false)
  let showAddRefDialog = $state(false)

  // Track previous dialog state to detect agent completion
  let prevDialogState = $state<string>('idle')

  // Fetch thread data when active conversation changes
  $effect(() => {
    const id = activeId
    if (id) {
      // Fetch in parallel
      getThreadLineage(id).then(l => { lineage = l })
      getThreadEvents(id).then(evts => {
        threadEvents = evts
        hasThreadEvents = evts.length > 0
      })
      getThreadRefs(id).then(refs => { threadRefs = refs })
      getCompactStatus(id).then(status => { compactStatus = status })
    } else {
      lineage = null
      threadEvents = []
      threadRefs = []
      compactStatus = null
      hasThreadEvents = false
    }
  })

  // Refresh thread events when agent finishes (dialogState goes back to idle)
  $effect(() => {
    const ds = dialogState
    if (prevDialogState !== 'idle' && ds === 'idle' && activeId) {
      // Agent just finished — reload thread events + refs
      getThreadEvents(activeId).then(evts => {
        threadEvents = evts
        hasThreadEvents = evts.length > 0
      })
      getThreadRefs(activeId).then(refs => { threadRefs = refs })
      getCompactStatus(activeId).then(status => { compactStatus = status })
    }
    prevDialogState = ds
  })

  // Separate compacted events from visible ones
  const summaryEvent = $derived(
    threadEvents.find(e => e.message_type === 'summary')
  )

  const compactedCount = $derived(
    threadEvents.filter(e => e.is_compacted).length
  )

  const visibleEvents = $derived(
    threadEvents.filter(e => !e.is_compacted && e.message_type !== 'summary')
  )

  let messagesEl: HTMLDivElement | undefined = $state()

  function segmentKey(seg: StreamSegment, i: number): string {
    switch (seg.type) {
      case 'tool': return seg.toolUseId
      case 'ask_user': return seg.questionId
      case 'system': return `sys-${i}`
      case 'text': return `text-${i}`
    }
  }

  // Format date separator
  function formatDateSeparator(dateStr: string): string {
    const d = new Date(dateStr)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function shouldShowDateSeparator(dateStr: string, index: number, allDates: string[]): boolean {
    if (!dateStr) return false
    if (index === 0) return true
    const prev = allDates[index - 1]
    if (!prev) return true
    return new Date(prev).toDateString() !== new Date(dateStr).toDateString()
  }

  // For legacy messages
  function shouldShowDateSeparatorMsg(msg: ChatMessageType, index: number, allMessages: ChatMessageType[]): boolean {
    if (!msg.createdAt) return false
    if (index === 0) return true
    const prev = allMessages[index - 1]
    if (!prev.createdAt) return true
    return new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString()
  }

  // Auto-scroll on new content
  $effect(() => {
    messages.length
    segments.length
    threadEvents.length
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
    segments.length

    if (messagesEl) {
      requestAnimationFrame(() => {
        if (messagesEl) highlightAll(messagesEl)
      })
    }
  })

  // Thread action handlers
  function handleFork() {
    if (activeId) forkConversation(activeId)
  }

  function handleCompact() {
    if (activeId) compactThread(activeId)
  }

  function handleAddRef() {
    showAddRefDialog = true
  }

  async function handleRefAdded() {
    if (activeId) {
      threadRefs = await getThreadRefs(activeId)
    }
  }

  async function handleLoadOriginalEvents() {
    if (!activeId) return
    const allEvts = await getThreadEvents(activeId, true)
    threadEvents = allEvts
  }
</script>

<div class="messages-area" bind:this={messagesEl}>
  <!-- Fork indicator -->
  {#if lineage?.parent}
    <ForkIndicator parent={lineage.parent} forkPoint={lineage.fork_point} />
  {/if}

  <!-- Sticky toolbar: refs + actions -->
  {#if activeId}
    <div class="sticky-toolbar">
      {#if threadRefs.length > 0}
        <ThreadRefsBar refs={threadRefs} onAddRef={handleAddRef} />
      {/if}
      <ThreadActions
        threadId={activeId}
        {compactStatus}
        onFork={handleFork}
        onCompact={handleCompact}
        onAddRef={handleAddRef}
      />
    </div>
  {/if}

  <!-- Children forks banner -->
  {#if lineage?.children && lineage.children.length > 0}
    <div class="lineage-children">
      <span class="lineage-children-label">
        {lineage.children.length} fork{lineage.children.length > 1 ? 's' : ''}:
      </span>
      {#each lineage.children as child, i}
        <button class="lineage-link" onclick={() => selectConversation(child.id)}>
          {child.topic || `Fork ${i + 1}`}
        </button>{#if i < lineage.children.length - 1}<span class="lineage-sep">,</span>{/if}
      {/each}
    </div>
  {/if}

  {#if hasThreadEvents}
    <!-- ═══ Thread Events Timeline ═══ -->

    <!-- Compacted section (if summary exists) -->
    {#if summaryEvent && compactedCount > 0}
      <CompactedSection
        {summaryEvent}
        {compactedCount}
        onLoadOriginal={handleLoadOriginalEvents}
      />
    {/if}

    <!-- Visible events -->
    {#each visibleEvents as evt, i (evt.id)}
      {#if shouldShowDateSeparator(evt.created_at, i, visibleEvents.map(e => e.created_at))}
        <div class="date-separator">
          <span class="date-separator-label">{formatDateSeparator(evt.created_at)}</span>
        </div>
      {/if}
      <ThreadEventComponent event={evt} />
    {/each}

  {:else}
    <!-- ═══ Legacy Messages Fallback ═══ -->

    {#if messages.length === 0 && segments.length === 0 && dialogState === 'idle'}
      <p class="empty-state">Send a message to get started</p>
    {:else}
      {#each messages as msg, i (msg.id)}
        {#if shouldShowDateSeparatorMsg(msg, i, messages)}
          <div class="date-separator">
            <span class="date-separator-label">{formatDateSeparator(msg.createdAt)}</span>
          </div>
        {/if}
        <ChatMessageComponent message={msg} />
      {/each}
    {/if}
  {/if}

  <!-- Thinking indicator -->
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

  <!-- Live streaming segments -->
  {#each segments as seg, i (segmentKey(seg, i))}
    {#if seg.type === 'text'}
      <div class="message assistant">
        <div class="meta">
          <span class="role">Gigi</span>
          <ChannelBadge channel="web" direction="outbound" />
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

  <!-- Add ref dialog -->
  {#if showAddRefDialog && activeId}
    <AddRefDialog
      threadId={activeId}
      onClose={() => showAddRefDialog = false}
      onAdded={handleRefAdded}
    />
  {/if}
</div>

<style>
  .messages-area {
    flex: 1;
    overflow-y: auto;
    padding: var(--gigi-space-md);
  }

  /* ── Sticky toolbar ─────────────────────────────────────────────── */

  .sticky-toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--gigi-bg-secondary);
    margin: 0 calc(-1 * var(--gigi-space-md));
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
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

  /* Lineage children */
  .lineage-children {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gigi-space-xs);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    margin-bottom: var(--gigi-space-sm);
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    align-items: center;
  }

  .lineage-children-label {
    font-weight: 500;
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

  .lineage-sep {
    color: var(--gigi-text-muted);
    opacity: 0.5;
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

  /* ── Responsive: narrow panels / mobile ───────────────────────────── */
  @media (max-width: 480px) {
    .messages-area {
      padding: var(--gigi-space-sm);
    }

    .message, .live-tool {
      max-width: 95%;
    }

    .lineage-children {
      font-size: 0.65rem;
    }
  }
</style>
