<script lang="ts">
  /**
   * Window-style panel controls: minimize / restore / maximize
   *
   * Uses pixelarticons for a pixel-art aesthetic.
   */
  import { setPanelState, type PanelId, type PanelState } from '$lib/stores/panels.svelte'

  interface Props {
    panel: PanelId
    state: PanelState
  }

  const { panel, state }: Props = $props()
</script>

<div class="panel-controls">
  <button
    class="ctrl-btn"
    class:active={state === 'hidden'}
    onclick={() => setPanelState(panel, 'hidden')}
    title="Minimize"
  >
    <!-- pixelarticons: minus -->
    <svg viewBox="0 0 24 24" fill="none">
      <path fill="currentColor" d="M4 11h16v2H4z"/>
    </svg>
  </button>
  <button
    class="ctrl-btn"
    class:active={state === 'compact'}
    onclick={() => setPanelState(panel, 'compact')}
    title="Restore"
  >
    <!-- pixelarticons: checkbox-on (empty square) -->
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 3h18v18H3V3zm16 16V5H5v14h14z" fill="currentColor"/>
    </svg>
  </button>
  <button
    class="ctrl-btn"
    class:active={state === 'full'}
    onclick={() => setPanelState(panel, 'full')}
    title="Maximize"
  >
    <!-- pixelarticons: expand -->
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M11 5h2v2h2v2h2V7h-2V5h-2V3h-2v2zM9 7V5h2v2H9zm0 0v2H7V7h2zm-5 6h16v-2H4v2zm9 6h-2v-2H9v-2H7v2h2v2h2v2h2v-2zm2-2h-2v2h2v-2zm0 0h2v-2h-2v2z" fill="currentColor"/>
    </svg>
  </button>
</div>

<style>
  .panel-controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 2px;
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--gigi-text-muted);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
  }

  .ctrl-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
    border-color: var(--gigi-border-default);
  }

  .ctrl-btn.active {
    color: var(--gigi-accent-blue);
    background: var(--gigi-bg-tertiary);
    border-color: var(--gigi-border-default);
  }

  .ctrl-btn svg {
    display: block;
    width: 14px;
    height: 14px;
  }
</style>
