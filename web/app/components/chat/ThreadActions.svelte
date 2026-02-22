<script lang="ts">
  /**
   * Thread action bar — compact/fork/link buttons shown at top of thread.
   */
  import type { CompactStatus } from '$lib/types/chat'

  interface Props {
    threadId: string
    compactStatus?: CompactStatus | null
    onFork: () => void
    onCompact: () => void
    onAddRef: () => void
  }

  const { threadId, compactStatus, onFork, onCompact, onAddRef }: Props = $props()

  const showCompactBadge = $derived(compactStatus?.should_compact === true)
</script>

<div class="thread-actions">
  <button class="action-pill" title="Fork this thread" onclick={onFork}>
    🍴 Fork
  </button>

  <button
    class="action-pill"
    class:compact-recommended={showCompactBadge}
    title={showCompactBadge
      ? `Thread has ${compactStatus?.event_count} events (recommend compacting)`
      : 'Compact this thread'}
    onclick={onCompact}
  >
    📦 Compact
    {#if showCompactBadge}
      <span class="compact-badge">{compactStatus?.event_count}</span>
    {/if}
  </button>

  <button class="action-pill" title="Link an issue or PR" onclick={onAddRef}>
    🔗 Link
  </button>
</div>

<style>
  .thread-actions {
    display: flex;
    gap: var(--gigi-space-xs);
    flex-wrap: wrap;
  }

  .action-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: var(--gigi-radius-full);
    border: 1px solid var(--gigi-border-muted);
    background: var(--gigi-bg-secondary);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    transition: all var(--gigi-transition-fast);
  }

  .action-pill:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-secondary);
    border-color: var(--gigi-accent-blue);
  }

  .compact-recommended {
    border-color: var(--gigi-accent-orange, #d29922);
  }

  .compact-badge {
    background: var(--gigi-accent-orange, #d29922);
    color: #fff;
    font-size: 0.55rem;
    padding: 0 4px;
    border-radius: var(--gigi-radius-full);
    font-weight: 600;
    line-height: 1.4;
  }
</style>
