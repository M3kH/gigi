<script lang="ts">
  /** Section C: Project selector / filters bar */
</script>

<div class="gigi-filters">
  <div class="filter-group">
    <label class="filter-label">Project</label>
    <select class="filter-select">
      <option value="">All projects</option>
      <option value="gigi">gigi</option>
      <option value="org-press">org-press</option>
      <option value="website">website</option>
      <option value="biancifiore">biancifiore</option>
    </select>
  </div>

  <div class="filter-group">
    <label class="filter-label">View</label>
    <div class="view-tabs">
      <button class="view-tab active">Chat</button>
      <button class="view-tab">Board</button>
      <button class="view-tab">Issues</button>
    </div>
  </div>

  <div class="filter-spacer"></div>

  <div class="connection-badge" title="WebSocket status">
    <span class="status-dot"></span>
  </div>
</div>

<style>
  .gigi-filters {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-md);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    background: var(--gigi-bg-secondary);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    min-height: var(--gigi-topbar-height);
  }

  .filter-group {
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

  .filter-select {
    background: var(--gigi-bg-tertiary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-primary);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
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

  .filter-spacer {
    flex: 1;
  }

  .connection-badge {
    display: flex;
    align-items: center;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gigi-accent-green);
  }
</style>
