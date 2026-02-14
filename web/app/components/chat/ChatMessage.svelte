<script lang="ts">
  /**
   * Single chat message with markdown rendering, tool blocks, and token badge.
   */
  import type { ChatMessage as ChatMessageType } from '$lib/types/chat'
  import { renderMarkdown, highlightAll } from '$lib/utils/markdown'
  import { formatTime } from '$lib/utils/format'
  import ToolBlock from './ToolBlock.svelte'
  import TokenBadge from './TokenBadge.svelte'

  interface Props {
    message: ChatMessageType
  }

  const { message }: Props = $props()

  let contentEl: HTMLDivElement | undefined = $state()

  const isUser = $derived(message.role === 'user')
  const renderedHtml = $derived(isUser ? '' : renderMarkdown(message.content))

  // Highlight code blocks after content renders
  $effect(() => {
    if (contentEl && renderedHtml) {
      // Wait for DOM update
      requestAnimationFrame(() => {
        if (contentEl) highlightAll(contentEl)
      })
    }
  })
</script>

<div class="message" class:user={isUser} class:assistant={!isUser}>
  <div class="meta">
    <span class="role">{isUser ? 'You' : 'Gigi'}</span>
    {#if message.createdAt}
      <span class="timestamp">{formatTime(message.createdAt)}</span>
    {/if}
    {#if !isUser && message.usage}
      <TokenBadge usage={message.usage} />
    {/if}
  </div>

  {#if isUser}
    <div class="content user-content">{message.content}</div>
  {:else}
    <div class="content" bind:this={contentEl}>
      {@html renderedHtml}
    </div>
  {/if}

  <!-- Tool blocks from history -->
  {#if message.toolCalls && message.toolCalls.length > 0}
    <div class="tool-blocks">
      {#each message.toolCalls as tc}
        <ToolBlock
          toolUseId={tc.toolUseId}
          name={tc.name}
          input={tc.input}
          result={message.toolOutputs?.[tc.toolUseId]}
          status="done"
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .message {
    margin-bottom: var(--gigi-space-lg);
    max-width: 720px;
  }

  .message.user {
    margin-left: auto;
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
    border-radius: var(--gigi-radius-md);
    font-size: var(--gigi-font-size-sm);
    line-height: 1.6;
  }

  .user-content {
    background: #1a3a2a;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.assistant .content {
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
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
</style>
