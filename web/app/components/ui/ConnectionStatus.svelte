<script lang="ts">
  /**
   * Connection status indicator dot
   *
   * Shows a colored dot reflecting WebSocket state:
   * green = connected, orange = connecting/reconnecting, red = disconnected
   */
  import type { ConnectionState } from '$lib/services/ws-client'

  interface Props {
    state: ConnectionState
  }

  const { state }: Props = $props()
</script>

<div class="connection-status" title="WebSocket: {state}">
  <span
    class="status-dot"
    class:connected={state === 'connected'}
    class:connecting={state === 'connecting' || state === 'reconnecting'}
    class:disconnected={state === 'disconnected'}
  ></span>
</div>

<style>
  .connection-status {
    display: flex;
    align-items: center;
    padding: 0 var(--gigi-space-md);
  }

  .status-dot {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
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
