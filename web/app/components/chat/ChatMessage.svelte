<script lang="ts">
  /**
   * Single chat message with markdown rendering, tool blocks, and token badge.
   *
   * Supports interleaved rendering: when interleavedContent is available,
   * text and tool blocks render in their original order (matching live streaming).
   */
  import type { ChatMessage as ChatMessageType, InterleavedBlock } from '$lib/types/chat'
  import { renderMarkdown, highlightAll } from '$lib/utils/markdown'
  import { interceptLinks } from '$lib/utils/intercept-links'
  import { formatTime } from '$lib/utils/format'
  import ToolBlock from './ToolBlock.svelte'
  import TokenBadge from './TokenBadge.svelte'

  interface Props {
    message: ChatMessageType
  }

  const { message }: Props = $props()

  let contentEl: HTMLDivElement | undefined = $state()

  const isUser = $derived(message.role === 'user')
  const isSystem = $derived(isUser && (
    message.content.startsWith('[ENFORCER]') ||
    message.content.startsWith('[SYSTEM') ||
    message.content.startsWith('[CONVERSATION SUMMARY')
  ))

  // Strip [Viewing ...] context prefix from user messages for display
  const displayContent = $derived.by(() => {
    if (isUser) {
      return message.content.replace(/^\[Viewing [^\]]+\]\n/, '')
    }
    return message.content
  })

  const renderedHtml = $derived(renderMarkdown(displayContent))

  // Use interleaved content when available (new format with text/tool ordering)
  const hasInterleaved = $derived(!isUser && !!message.interleavedContent && message.interleavedContent.length > 0)

  // Collapsed tool blocks: show all if <= 10, otherwise show last 3 with expand option
  const TOOL_COLLAPSE_THRESHOLD = 10
  let toolsExpanded = $state(false)

  const toolCallsFiltered = $derived(
    message.toolCalls?.filter(tc => tc.name !== 'ask_user') ?? []
  )
  const shouldCollapse = $derived(toolCallsFiltered.length > TOOL_COLLAPSE_THRESHOLD)
  const visibleToolCalls = $derived(
    shouldCollapse && !toolsExpanded
      ? toolCallsFiltered.slice(-3)
      : toolCallsFiltered
  )

  // Highlight code blocks after content renders
  $effect(() => {
    if (contentEl && renderedHtml) {
      requestAnimationFrame(() => {
        if (contentEl) highlightAll(contentEl)
      })
    }
  })
</script>

<div class="message" class:user={isUser} class:assistant={!isUser} class:system-msg={isSystem}>
  <div class="meta">
    <span class="role">{isSystem ? 'System' : isUser ? 'You' : 'Gigi'}</span>
    {#if message.createdAt}
      <span class="timestamp">{formatTime(message.createdAt)}</span>
    {/if}
    {#if !isUser && message.usage}
      <TokenBadge usage={message.usage} />
    {/if}
  </div>

  {#if hasInterleaved}
    <!-- Interleaved rendering: text and tool blocks in original order -->
    {#each message.interleavedContent as block, i}
      {#if block.type === 'text' && block.text.trim()}
        <div class="content" bind:this={contentEl} use:interceptLinks>
          {@html renderMarkdown(block.text)}
        </div>
      {:else if block.type === 'tool_use' && block.name !== 'ask_user'}
        <div class="tool-blocks">
          <ToolBlock
            toolUseId={block.toolUseId}
            name={block.name}
            input={block.input}
            result={message.toolOutputs?.[block.toolUseId]}
            status="done"
          />
        </div>
      {/if}
    {/each}
  {:else}
    <!-- Legacy rendering: single text block + tool blocks below -->
    {#if isUser}
      <div class="content user-content" bind:this={contentEl} use:interceptLinks>
        {@html renderedHtml}
      </div>
    {:else}
      <div class="content" bind:this={contentEl} use:interceptLinks>
        {@html renderedHtml}
      </div>
    {/if}

    {#if toolCallsFiltered.length > 0}
      <div class="tool-blocks">
        {#if shouldCollapse && !toolsExpanded}
          <button class="tool-collapse-btn" onclick={() => toolsExpanded = true}>
            Show all {toolCallsFiltered.length} tool calls ({toolCallsFiltered.length - 3} hidden)
          </button>
        {/if}
        {#each visibleToolCalls as tc}
          <ToolBlock
            toolUseId={tc.toolUseId}
            name={tc.name}
            input={tc.input}
            result={message.toolOutputs?.[tc.toolUseId]}
            status="done"
          />
        {/each}
        {#if shouldCollapse && toolsExpanded}
          <button class="tool-collapse-btn" onclick={() => toolsExpanded = false}>
            Collapse tool calls
          </button>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .message {
    margin-bottom: var(--gigi-space-lg);
    max-width: 80%;
  }

  /* Wider max-width in fullscreen chat mode */
  :global(.chat-full) .message {
    max-width: 95%;
  }

  .message.user {
    margin-left: auto;
  }

  .message.user .meta {
    justify-content: flex-end;
  }

  /* System/enforcer message styling */
  .message.system-msg {
    max-width: 90%;
    opacity: 0.7;
  }

  .message.system-msg .content {
    background: var(--gigi-bg-tertiary);
    border: 1px dashed var(--gigi-border-muted);
    font-size: var(--gigi-font-size-xs);
    font-style: italic;
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

  .timestamp {
    font-size: 0.65rem;
  }

  .content {
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-radius: var(--gigi-radius-lg);
    font-size: var(--gigi-font-size-sm);
    line-height: 1.6;
  }

  .user-content {
    background: var(--gigi-bubble-user);
    border-radius: var(--gigi-radius-lg) var(--gigi-radius-lg) var(--gigi-radius-sm) var(--gigi-radius-lg);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.assistant .content {
    background: var(--gigi-bubble-assistant);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-lg) var(--gigi-radius-lg) var(--gigi-radius-lg) var(--gigi-radius-sm);
  }

  /* Markdown styling */
  .content :global(p) { margin: 0.5em 0; }
  .content :global(p:first-child) { margin-top: 0; }
  .content :global(p:last-child) { margin-bottom: 0; }
  .content :global(ul), .content :global(ol) { margin: 0.5em 0; padding-left: 1.5em; }
  .content :global(li) { margin: 0.25em 0; }
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
  .content :global(pre code) { font-size: 0.8em; }
  .content :global(:not(pre) > code) {
    background: var(--gigi-bg-hover);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  .content :global(blockquote) {
    border-left: 3px solid var(--gigi-border-default);
    padding-left: 1em;
    margin: 0.5em 0;
    color: var(--gigi-text-muted);
  }
  .content :global(h1), .content :global(h2), .content :global(h3) { margin: 1em 0 0.5em 0; }
  .content :global(h1) { font-size: 1.3em; }
  .content :global(h2) { font-size: 1.2em; }
  .content :global(h3) { font-size: 1.1em; }
  .content :global(a) { color: var(--gigi-accent-blue); text-decoration: none; }
  .content :global(a:hover) { text-decoration: underline; }
  .content :global(table) { border-collapse: collapse; margin: 0.5em 0; width: 100%; }
  .content :global(th), .content :global(td) {
    border: 1px solid var(--gigi-border-muted);
    padding: 0.3em 0.6em;
    font-size: 0.85em;
  }
  .content :global(th) { background: var(--gigi-bg-hover); }

  .tool-blocks {
    margin-top: var(--gigi-space-xs);
  }

  .tool-collapse-btn {
    display: block;
    width: 100%;
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-accent-blue);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    text-align: center;
    margin: var(--gigi-space-xs) 0;
    font-family: var(--gigi-font-sans);
  }

  .tool-collapse-btn:hover {
    background: var(--gigi-bg-hover);
  }
</style>
