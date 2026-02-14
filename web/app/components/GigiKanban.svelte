<script lang="ts">
  /** Section A: Kanban board placeholder */
</script>

<section class="gigi-kanban">
  <header class="section-header">
    <span class="section-icon">📋</span>
    <h2>Board</h2>
  </header>
  <div class="section-body">
    <p class="placeholder-text">Kanban board coming soon</p>
  </div>
</section>

<style>
  .gigi-kanban {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-secondary);
  }

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

  .section-body {
    flex: 1;
    padding: var(--gigi-space-lg);
    overflow-y: auto;
  }

  .placeholder-text {
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }
</style>
