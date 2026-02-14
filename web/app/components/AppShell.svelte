<script lang="ts">
  /**
   * App Shell — Main layout orchestrator
   *
   * Implements the layout from issue #58:
   * +-----------------------------------------------------------+
   * | A: Kanban (full / compact / hidden)                       |
   * +----------+------------------------------------------------+
   * | B: Chats | C: Filters / Project Selector                  |
   * |          +------------------------------------------------+
   * |          | D: Main View                                    |
   * |          |                                                 |
   * |          |  +------------------------------------------+  |
   * |          |  | F: Chat Overlay (expand / compact / hide) |  |
   * +----------+--+------------------------------------------+--+
   */

  import GigiKanban from '$components/GigiKanban.svelte'
  import GigiSidebar from '$components/GigiSidebar.svelte'
  import GigiFilters from '$components/GigiFilters.svelte'
  import GigiMainView from '$components/GigiMainView.svelte'
  import GigiChatOverlay from '$components/GigiChatOverlay.svelte'
  import { getPanelState, togglePanel, setPanelState, type PanelState } from '$lib/stores/panels.svelte'
  import { initConnection, getConnectionState, type ConnectionState } from '$lib/stores/connection.svelte'
  import { connectSSE, disconnectSSE, handleServerEvent } from '$lib/stores/chat.svelte'
  import { onMount } from 'svelte'

  const kanbanState: PanelState = $derived(getPanelState('kanban'))
  const sidebarState: PanelState = $derived(getPanelState('sidebar'))
  const connectionState: ConnectionState = $derived(getConnectionState())

  let sidebarDragging = $state(false)
  let sidebarWidth = $state(260)
  let mobileOverlay = $state(false)
  let isMobile = $state(false)

  onMount(() => {
    // Initialize WebSocket connection
    const ws = initConnection()

    // Wire WS messages into chat store (for when WS server is live)
    const unsubMsg = ws.onMessage((msg) => {
      handleServerEvent(msg)
    })

    // Also connect SSE as fallback (SSE is live now, WS server not yet)
    connectSSE()

    // Check mobile on mount + resize
    const checkMobile = () => {
      isMobile = window.innerWidth < 768
      if (isMobile && sidebarState === 'full') {
        mobileOverlay = true
      }
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    // Keyboard shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + B: Toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        togglePanel('sidebar')
      }
      // Ctrl/Cmd + K: Toggle kanban
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        togglePanel('kanban')
      }
      // Ctrl/Cmd + J: Toggle chat overlay
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault()
        togglePanel('chatOverlay')
      }
      // Escape: close mobile overlay
      if (e.key === 'Escape' && mobileOverlay) {
        mobileOverlay = false
      }
    }

    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('resize', checkMobile)
      window.removeEventListener('keydown', handleKeydown)
      unsubMsg()
      disconnectSSE()
    }
  })

  // ─── Sidebar drag resize ──────────────────────────────────────
  function startSidebarDrag(e: MouseEvent) {
    e.preventDefault()
    sidebarDragging = true
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      sidebarWidth = Math.max(180, Math.min(400, startWidth + delta))
    }

    const onUp = () => {
      sidebarDragging = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function closeMobileOverlay() {
    mobileOverlay = false
  }

  function openMobileSidebar() {
    mobileOverlay = true
  }
</script>

<div class="app-shell" class:dragging={sidebarDragging}>
  <!-- Section A: Kanban -->
  {#if kanbanState !== 'hidden'}
    <div
      class="kanban-panel"
      class:compact={kanbanState === 'compact'}
    >
      <GigiKanban />
    </div>
  {/if}

  <!-- Main area: Sidebar + Content -->
  <div class="main-area">
    <!-- Section B: Sidebar (desktop) -->
    {#if !isMobile && sidebarState !== 'hidden'}
      <div
        class="sidebar-panel"
        class:compact={sidebarState === 'compact'}
        style:width={sidebarState === 'full' ? `${sidebarWidth}px` : undefined}
      >
        <GigiSidebar />
      </div>

      <!-- Drag handle -->
      {#if sidebarState === 'full'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="divider"
          onmousedown={startSidebarDrag}
        ></div>
      {/if}
    {/if}

    <!-- Content area: Filters + Main + Chat -->
    <div class="content-area">
      <!-- Section C: Filters -->
      <div class="filters-bar">
        {#if isMobile}
          <button class="mobile-menu-btn" onclick={openMobileSidebar} title="Open sidebar">
            ☰
          </button>
        {/if}
        <GigiFilters />
        <div class="connection-status" title="WebSocket: {connectionState}">
          <span
            class="status-dot"
            class:connected={connectionState === 'connected'}
            class:connecting={connectionState === 'connecting' || connectionState === 'reconnecting'}
            class:disconnected={connectionState === 'disconnected'}
          ></span>
        </div>
      </div>

      <!-- Section D: Main View -->
      <div class="main-content">
        <GigiMainView />

        <!-- Section F: Chat Overlay -->
        <GigiChatOverlay />
      </div>
    </div>
  </div>

  <!-- Mobile sidebar overlay -->
  {#if isMobile && mobileOverlay}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mobile-overlay" onclick={closeMobileOverlay}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="mobile-sidebar" onclick={(e) => e.stopPropagation()}>
        <GigiSidebar />
      </div>
    </div>
  {/if}
</div>

<style>
  .app-shell {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .app-shell.dragging {
    cursor: col-resize;
    user-select: none;
  }

  /* ── Kanban Panel ──────────────────────────────────────────── */

  .kanban-panel {
    height: 200px;
    min-height: 120px;
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    transition: height var(--gigi-transition-normal);
  }

  .kanban-panel.compact {
    height: var(--gigi-topbar-height);
    min-height: var(--gigi-topbar-height);
    overflow: hidden;
  }

  /* ── Main Area ─────────────────────────────────────────────── */

  .main-area {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* ── Sidebar ───────────────────────────────────────────────── */

  .sidebar-panel {
    flex-shrink: 0;
    overflow: hidden;
    border-right: var(--gigi-border-width) solid var(--gigi-border-default);
    transition: width var(--gigi-transition-normal);
  }

  .sidebar-panel.compact {
    width: var(--gigi-sidebar-compact) !important;
  }

  /* ── Divider (drag handle) ─────────────────────────────────── */

  .divider {
    width: var(--gigi-divider-width);
    cursor: col-resize;
    background: transparent;
    transition: background var(--gigi-transition-fast);
    flex-shrink: 0;
    position: relative;
  }

  .divider::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 24px;
    background: var(--gigi-border-default);
    border-radius: var(--gigi-radius-full);
    opacity: 0;
    transition: opacity var(--gigi-transition-fast);
  }

  .divider:hover {
    background: var(--gigi-accent-blue);
  }

  .divider:hover::after {
    opacity: 1;
    background: var(--gigi-accent-blue);
  }

  /* ── Content Area ──────────────────────────────────────────── */

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .filters-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Connection Status ─────────────────────────────────────── */

  .connection-status {
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

  /* ── Mobile ────────────────────────────────────────────────── */

  .mobile-menu-btn {
    background: none;
    border: none;
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-lg);
    cursor: pointer;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    flex-shrink: 0;
  }

  .mobile-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: var(--gigi-z-overlay);
    animation: fade-in 200ms ease;
  }

  .mobile-sidebar {
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

  /* ── Mobile responsive ─────────────────────────────────────── */

  @media (max-width: 768px) {
    .kanban-panel {
      height: var(--gigi-topbar-height);
      min-height: var(--gigi-topbar-height);
      overflow: hidden;
    }
  }
</style>
