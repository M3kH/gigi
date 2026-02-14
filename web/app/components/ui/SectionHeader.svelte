<script lang="ts">
  /**
   * Reusable section header with icon and optional title
   *
   * Used by Kanban, Sidebar, and other panels for consistent header styling.
   */
  import type { Snippet } from 'svelte'

  interface Props {
    icon: string
    title?: string
    actions?: Snippet
  }

  const { icon, title, actions }: Props = $props()
</script>

<header class="section-header">
  <span class="section-icon">{icon}</span>
  {#if title}
    <h2>{title}</h2>
  {/if}
  {#if actions}
    <div class="section-actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .section-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    min-height: var(--gigi-topbar-height);
  }

  .section-header h2 {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .section-icon {
    font-size: var(--gigi-font-size-base);
  }

  .section-actions {
    margin-left: auto;
  }
</style>
