<script lang="ts">
  /**
   * Collapsible token usage badge
   *
   * Shows compact token count, expands to detailed breakdown.
   */
  import type { TokenUsage } from '$lib/types/chat'
  import { formatTokens, formatCost } from '$lib/utils/format'

  interface Props {
    usage: TokenUsage
  }

  const { usage }: Props = $props()

  let expanded = $state(false)

  const total = $derived((usage.inputTokens || 0) + (usage.outputTokens || 0))
  const costStr = $derived(formatCost(usage.costUSD))
</script>

{#if total > 0}
  <button class="token-badge" onclick={() => (expanded = !expanded)}>
    <span class="token-icon">◆</span>
    {formatTokens(total)} tk{costStr ? ` · ${costStr}` : ''}
  </button>

  {#if expanded}
    <div class="token-details">
      <div class="token-row">
        <span class="token-label">Input</span>
        <span class="token-value">{formatTokens(usage.inputTokens)}</span>
      </div>
      <div class="token-row">
        <span class="token-label">Output</span>
        <span class="token-value">{formatTokens(usage.outputTokens)}</span>
      </div>
      {#if usage.cacheReadInputTokens}
        <div class="token-row">
          <span class="token-label">Cache read</span>
          <span class="token-value">{formatTokens(usage.cacheReadInputTokens)}</span>
        </div>
      {/if}
      {#if usage.cacheCreationInputTokens}
        <div class="token-row">
          <span class="token-label">Cache write</span>
          <span class="token-value">{formatTokens(usage.cacheCreationInputTokens)}</span>
        </div>
      {/if}
      <div class="token-divider"></div>
      <div class="token-row">
        <span class="token-label">Total</span>
        <span class="token-value">{formatTokens(total)}</span>
      </div>
      {#if usage.costUSD}
        <div class="token-row">
          <span class="token-label">Cost</span>
          <span class="token-value cost">{formatCost(usage.costUSD)}</span>
        </div>
      {/if}
      {#if usage.durationMs}
        <div class="token-row">
          <span class="token-label">Duration</span>
          <span class="token-value">{(usage.durationMs / 1000).toFixed(1)}s</span>
        </div>
      {/if}
      {#if usage.numTurns}
        <div class="token-row">
          <span class="token-label">Turns</span>
          <span class="token-value">{usage.numTurns}</span>
        </div>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .token-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.65rem;
    color: var(--gigi-text-muted);
    cursor: pointer;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    background: transparent;
    border: none;
    font-family: var(--gigi-font-sans);
    transition: background 0.15s;
    user-select: none;
  }

  .token-badge:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-secondary);
  }

  .token-icon {
    font-size: 0.55rem;
  }

  .token-details {
    margin-top: var(--gigi-space-xs);
    padding: var(--gigi-space-sm);
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-md);
    font-size: 0.7rem;
    color: var(--gigi-text-secondary);
    line-height: 1.6;
  }

  .token-row {
    display: flex;
    justify-content: space-between;
    gap: var(--gigi-space-md);
  }

  .token-label {
    color: var(--gigi-text-muted);
  }

  .token-value {
    font-family: var(--gigi-font-mono, 'Monaco', 'Courier New', monospace);
  }

  .token-value.cost {
    color: var(--gigi-accent-orange);
  }

  .token-divider {
    border-top: 1px solid var(--gigi-border-muted);
    margin: 0.2rem 0;
  }
</style>
