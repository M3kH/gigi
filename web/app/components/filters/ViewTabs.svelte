<script lang="ts">
  /**
   * View tab switcher
   *
   * Toggle between Chat, Board, and Issues views.
   */
  interface Props {
    tabs?: string[]
    active?: string
    onchange?: (tab: string) => void
  }

  const {
    tabs = ['Chat', 'Board', 'Issues'],
    active = 'Chat',
    onchange,
  }: Props = $props()
</script>

<div class="view-tabs-group">
  <label class="filter-label">View</label>
  <div class="view-tabs">
    {#each tabs as tab}
      <button
        class="view-tab"
        class:active={tab === active}
        onclick={() => onchange?.(tab)}
      >
        {tab}
      </button>
    {/each}
  </div>
</div>

<style>
  .view-tabs-group {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .filter-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .view-tabs {
    display: flex;
    gap: 1px;
    background: var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    overflow: hidden;
  }

  .view-tab {
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    background: var(--gigi-bg-tertiary);
    border: none;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
  }

  .view-tab:hover {
    background: var(--gigi-bg-hover);
  }

  .view-tab.active {
    background: var(--gigi-accent-green);
    color: var(--gigi-bg-primary);
    font-weight: 600;
  }
</style>
