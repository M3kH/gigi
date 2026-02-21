<script lang="ts">
  /**
   * Single thread event — renders differently based on channel and message_type.
   *
   * - Regular messages: bubble with channel badge
   * - Webhook/system events: compact inline card
   * - Summary events: collapsible compacted section
   */
  import type { ThreadEvent as ThreadEventType } from '$lib/types/chat'
  import { renderMarkdown, highlightAll } from '$lib/utils/markdown'
  import { interceptLinks } from '$lib/utils/intercept-links'
  import { formatTime } from '$lib/utils/format'
  import ChannelBadge from './ChannelBadge.svelte'

  interface Props {
    event: ThreadEventType
  }

  const { event }: Props = $props()

  let contentEl: HTMLDivElement | undefined = $state()

  const isOutbound = $derived(event.direction === 'outbound')
  const isGigi = $derived(event.actor === 'gigi')
  const isUser = $derived(event.direction === 'inbound' && !isGigi)
  const isSystemEvent = $derived(
    event.channel === 'webhook' ||
    event.channel === 'system' ||
    event.message_type === 'status_change'
  )
  const isSummary = $derived(event.message_type === 'summary')

  // Extract text content from the event
  const textContent = $derived.by(() => {
    const c = event.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n\n')
    }
    if (c && typeof c === 'object' && 'text' in c) return (c as { text: string }).text
    return JSON.stringify(c)
  })

  const renderedHtml = $derived(renderMarkdown(textContent))

  // Actor display name
  const actorName = $derived.by(() => {
    if (event.actor === 'gigi') return 'Gigi'
    if (event.actor === 'user') return 'You'
    if (event.actor.startsWith('gitea:')) return event.actor.replace('gitea:', '@')
    return event.actor
  })

  // Highlight code blocks after content renders
  $effect(() => {
    if (contentEl && renderedHtml) {
      requestAnimationFrame(() => {
        if (contentEl) highlightAll(contentEl)
      })
    }
  })
</script>

{#if isSummary}
  <!-- Summary events are handled by CompactedSection, skip here -->
{:else if isSystemEvent}
  <!-- Compact system/webhook event card -->
  <div class="system-event">
    <ChannelBadge channel={event.channel} direction={event.direction} />
    <span class="system-text">{textContent}</span>
    {#if event.created_at}
      <span class="system-time">{formatTime(event.created_at)}</span>
    {/if}
  </div>
{:else}
  <!-- Regular message bubble -->
  <div class="event-message" class:user={isUser} class:assistant={isGigi}>
    <div class="event-meta">
      <span class="event-role">{actorName}</span>
      <ChannelBadge channel={event.channel} direction={event.direction} />
      {#if event.created_at}
        <span class="event-time">{formatTime(event.created_at)}</span>
      {/if}
    </div>

    {#if isUser}
      <div class="event-content user-content" bind:this={contentEl} use:interceptLinks>
        {@html renderedHtml}
      </div>
    {:else}
      <div class="event-content" bind:this={contentEl} use:interceptLinks>
        {@html renderedHtml}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ── System event (webhook, system) ─────────────────────────────── */
  .system-event {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    margin: var(--gigi-space-xs) 0;
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    max-width: 90%;
  }

  .system-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .system-time {
    font-size: 0.6rem;
    opacity: 0.7;
    flex-shrink: 0;
  }

  /* ── Regular message bubble ─────────────────────────────────────── */
  .event-message {
    margin-bottom: var(--gigi-space-lg);
    max-width: 80%;
  }

  :global(.chat-full) .event-message {
    max-width: 95%;
  }

  .event-message.user {
    margin-left: auto;
  }

  .event-message.user .event-meta {
    justify-content: flex-end;
  }

  .event-meta {
    display: flex;
    gap: var(--gigi-space-sm);
    font-size: 0.7rem;
    color: var(--gigi-text-muted);
    margin-bottom: var(--gigi-space-xs);
    align-items: center;
  }

  .event-role {
    font-weight: 500;
  }

  .event-time {
    font-size: 0.65rem;
  }

  .event-content {
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

  .event-message.assistant .event-content {
    background: var(--gigi-bubble-assistant);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-lg) var(--gigi-radius-lg) var(--gigi-radius-lg) var(--gigi-radius-sm);
  }

  /* Markdown styling */
  .event-content :global(p) { margin: 0.5em 0; }
  .event-content :global(p:first-child) { margin-top: 0; }
  .event-content :global(p:last-child) { margin-bottom: 0; }
  .event-content :global(ul), .event-content :global(ol) { margin: 0.5em 0; padding-left: 1.5em; }
  .event-content :global(li) { margin: 0.25em 0; }
  .event-content :global(pre) {
    background: var(--gigi-bg-primary);
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    padding: var(--gigi-space-sm);
    margin: 0.5em 0;
    overflow-x: auto;
  }
  .event-content :global(code) {
    font-family: var(--gigi-font-mono, 'Monaco', 'Courier New', monospace);
    font-size: 0.85em;
  }
  .event-content :global(pre code) { font-size: 0.8em; }
  .event-content :global(:not(pre) > code) {
    background: var(--gigi-bg-hover);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  .event-content :global(blockquote) {
    border-left: 3px solid var(--gigi-border-default);
    padding-left: 1em;
    margin: 0.5em 0;
    color: var(--gigi-text-muted);
  }
  .event-content :global(a) { color: var(--gigi-accent-blue); text-decoration: none; }
  .event-content :global(a:hover) { text-decoration: underline; }
</style>
