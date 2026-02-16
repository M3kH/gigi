<script lang="ts">
  /**
   * Collapsible tool execution block
   *
   * Shows tool name, summary, elapsed time, and expandable input/output.
   */
  import { toolSummary, formatElapsed } from '$lib/utils/format'

  interface Props {
    toolUseId: string
    name: string
    description?: string
    input: unknown
    result?: string
    status: 'running' | 'done'
    startedAt?: number
  }

  const { toolUseId, name, description, input, result, status, startedAt }: Props = $props()

  let expanded = $state(false)
  let elapsed = $state('')

  // Update elapsed timer for running tools
  $effect(() => {
    if (status !== 'running' || !startedAt) return

    elapsed = formatElapsed(startedAt)
    const timer = setInterval(() => {
      elapsed = formatElapsed(startedAt)
    }, 1000)

    return () => clearInterval(timer)
  })

  const summary = $derived(toolSummary(name, input))
  const inputStr = $derived(input ? JSON.stringify(input, null, 2) : '')
</script>

<div class="tool-block">
  <button class="tool-header" onclick={() => (expanded = !expanded)}>
    <span class="tool-arrow" class:open={expanded}>▶</span>
    <span class="tool-name">{name}</span>
    {#if description}
      <span class="tool-desc">{description}</span>
    {/if}
    <span class="tool-summary">{summary}</span>
    {#if elapsed || (status === 'done' && startedAt)}
      <span class="tool-elapsed">{elapsed}</span>
    {/if}
    <span class="tool-status" class:running={status === 'running'} class:done={status === 'done'}>
      {status}
    </span>
  </button>

  {#if expanded}
    <div class="tool-body">
      <div class="tool-label">Input</div>
      <pre class="tool-pre">{inputStr}</pre>
      {#if result !== undefined}
        <div class="tool-label">Output</div>
        <pre class="tool-pre">{result || '(no output)'}</pre>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-block {
    margin: var(--gigi-space-xs) 0;
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-md);
    font-size: var(--gigi-font-size-xs);
    overflow: hidden;
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: var(--gigi-bg-tertiary);
    cursor: pointer;
    user-select: none;
    color: var(--gigi-text-secondary);
    border: none;
    width: 100%;
    text-align: left;
    font-family: var(--gigi-font-sans);
    font-size: var(--gigi-font-size-xs);
  }

  .tool-header:hover {
    background: var(--gigi-bg-hover);
  }

  .tool-arrow {
    font-size: 0.6rem;
    transition: transform 0.15s;
    color: var(--gigi-text-muted);
  }

  .tool-arrow.open {
    transform: rotate(90deg);
  }

  .tool-name {
    font-weight: 600;
    color: var(--gigi-accent-green);
    flex-shrink: 0;
  }

  .tool-desc {
    color: var(--gigi-text-muted);
    font-size: 0.65rem;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .tool-summary {
    flex: 1;
    color: var(--gigi-text-muted);
    font-family: var(--gigi-font-mono, 'Monaco', 'Courier New', monospace);
    font-size: 0.7rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-elapsed {
    color: var(--gigi-text-muted);
    font-size: 0.65rem;
    flex-shrink: 0;
  }

  .tool-status {
    font-size: 0.65rem;
    flex-shrink: 0;
  }

  .tool-status.running {
    color: var(--gigi-accent-orange);
  }

  .tool-status.done {
    color: var(--gigi-accent-green);
  }

  .tool-body {
    border-top: 1px solid var(--gigi-border-muted);
  }

  .tool-label {
    font-size: 0.6rem;
    color: var(--gigi-text-muted);
    padding: var(--gigi-space-xs) var(--gigi-space-sm) 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tool-pre {
    margin: 0;
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: var(--gigi-bg-primary);
    font-size: 0.7rem;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
    color: var(--gigi-text-secondary);
    font-family: var(--gigi-font-mono, 'Monaco', 'Courier New', monospace);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
