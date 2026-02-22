<script lang="ts">
  /**
   * Collapsible summary block for compacted thread events.
   * Shows the summary text with a toggle to expand and view original events.
   */
  import type { ThreadEvent } from '$lib/types/chat'
  import { renderMarkdown, highlightAll } from '$lib/utils/markdown'
  import { interceptLinks } from '$lib/utils/intercept-links'

  interface Props {
    summaryEvent: ThreadEvent
    compactedCount: number
    onLoadOriginal?: () => void
  }

  const { summaryEvent, compactedCount, onLoadOriginal }: Props = $props()

  let expanded = $state(false)
  let contentEl: HTMLDivElement | undefined = $state()

  const summaryText = $derived.by(() => {
    const c = summaryEvent.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n\n')
    }
    if (c && typeof c === 'object' && 'text' in c) return (c as { text: string }).text
    return ''
  })

  const renderedHtml = $derived(renderMarkdown(summaryText))

  $effect(() => {
    if (contentEl && renderedHtml) {
      requestAnimationFrame(() => {
        if (contentEl) highlightAll(contentEl)
      })
    }
  })
</script>

<div class="compacted-section">
  <button class="compacted-header" onclick={() => expanded = !expanded}>
    <svg class="compacted-chevron" class:open={expanded} viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
      <path d="M8 5v2h2V5H8zm4 4V7h-2v2h2zm2 2V9h-2v2h2zm0 2h2v-2h-2v2zm-2 2v-2h2v2h-2zm0 0h-2v2h2v-2zm-4 4v-2h2v2H8z"/>
    </svg>
    <span class="compacted-icon">📋</span>
    <span class="compacted-label">
      {compactedCount} earlier event{compactedCount !== 1 ? 's' : ''} (summary)
    </span>
  </button>

  {#if expanded}
    <div class="compacted-body" bind:this={contentEl} use:interceptLinks>
      {@html renderedHtml}

      {#if onLoadOriginal}
        <button class="show-original-btn" onclick={onLoadOriginal}>
          Show original events
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .compacted-section {
    margin: var(--gigi-space-sm) 0;
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-md);
    background: var(--gigi-bg-tertiary);
    overflow: hidden;
  }

  .compacted-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    width: 100%;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border: none;
    background: transparent;
    color: var(--gigi-text-secondary);
    cursor: pointer;
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    text-align: left;
    transition: background var(--gigi-transition-fast);
  }

  .compacted-header:hover {
    background: var(--gigi-bg-hover);
  }

  .compacted-chevron {
    flex-shrink: 0;
    transition: transform var(--gigi-transition-fast);
    opacity: 0.6;
  }

  .compacted-chevron.open {
    transform: rotate(90deg);
  }

  .compacted-icon {
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .compacted-label {
    font-weight: 500;
  }

  .compacted-body {
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-top: 1px solid var(--gigi-border-muted);
    font-size: var(--gigi-font-size-sm);
    line-height: 1.6;
    color: var(--gigi-text-secondary);
  }

  .compacted-body :global(p) { margin: 0.5em 0; }
  .compacted-body :global(p:first-child) { margin-top: 0; }
  .compacted-body :global(p:last-child) { margin-bottom: 0; }

  .show-original-btn {
    display: block;
    margin-top: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: var(--gigi-bg-secondary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-accent-blue);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
  }

  .show-original-btn:hover {
    background: var(--gigi-bg-hover);
  }
</style>
