<script lang="ts">
  /** Section C: Project selector / filters bar */
  import type { ConnectionState } from '$lib/services/ws-client'

  interface Props {
    connectionState?: ConnectionState
  }

  const { connectionState = 'disconnected' }: Props = $props()
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

  <div class="connection-badge" title="WebSocket: {connectionState}">
    <span
      class="status-dot"
      class:connected={connectionState === 'connected'}
      class:connecting={connectionState === 'connecting' || connectionState === 'reconnecting'}
      class:disconnected={connectionState === 'disconnected'}
    ></span>
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
    width: 100%;
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
    flex-shrink: 0;
  }

  .status-dot {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gigi-border-default);
    transition: background var(--gigi-transition-fast);
  }

  .status-dot.connected {
    background: var(--gigi-accent-green);
  }

  .status-dot.connecting {
    background: var(--gigi-accent-orange);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-dot.disconnected {
    background: var(--gigi-accent-red);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
