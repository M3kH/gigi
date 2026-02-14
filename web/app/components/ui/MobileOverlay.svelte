<script lang="ts">
  /**
   * Mobile slide-in overlay
   *
   * Renders a backdrop + sliding panel. Closes on backdrop click or Escape.
   */
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    onclose: () => void
    children: Snippet
  }

  const { open, onclose, children }: Props = $props()

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="mobile-overlay" onclick={onclose}>
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="mobile-panel" onclick={(e) => e.stopPropagation()}>
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .mobile-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: var(--gigi-z-overlay);
    animation: fade-in 200ms ease;
  }

  .mobile-panel {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    max-width: 85vw;
    background: var(--gigi-bg-secondary);
    z-index: calc(var(--gigi-z-overlay) + 1);
    box-shadow: var(--gigi-shadow-lg);
    animation: slide-in 250ms ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slide-in {
    from { transform: translateX(-100%); }
    to { transform: translateX(0); }
  }
</style>
