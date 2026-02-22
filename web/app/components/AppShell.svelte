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
  import { getPanelState, togglePanel, setPanelState, getKanbanHeight, setKanbanHeight, getChatHeight, setChatHeight, getChatWidth, setChatWidth, type PanelState } from '$lib/stores/panels.svelte'
  import { initConnection, getConnectionState, type ConnectionState } from '$lib/stores/connection.svelte'
  import { handleServerEvent } from '$lib/stores/chat.svelte'
  import { initUrlSync } from '$lib/stores/navigation.svelte'
  import { onMount } from 'svelte'

  const kanbanState: PanelState = $derived(getPanelState('kanban'))
  const sidebarState: PanelState = $derived(getPanelState('sidebar'))
  const chatState: PanelState = $derived(getPanelState('chatOverlay'))
  const connectionState: ConnectionState = $derived(getConnectionState())

  let sidebarDragging = $state(false)
  let kanbanDragging = $state(false)
  let chatDragging = $state(false)
  let chatWidthDragging = $state(false)
  let sidebarWidth = $state(260)
  let kanbanHeight = $derived(getKanbanHeight())
  let chatHeight = $derived(getChatHeight())
  let chatWidth = $derived(getChatWidth())
  let mobileOverlay = $state(false)
  let isMobile = $state(false)

  // Compute chat overlay left offset based on sidebar
  const chatLeftOffset = $derived(
    !isMobile && sidebarState === 'full' ? sidebarWidth + 6 : 0 // 6 = divider width
  )

  onMount(() => {
    // Initialize URL-based routing
    const unsubUrl = initUrlSync()

    // Initialize WebSocket connection
    const ws = initConnection()

    // Wire WS messages into chat store (for when WS server is live)
    const unsubMsg = ws.onMessage((msg) => {
      handleServerEvent(msg)
    })

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
      unsubUrl()
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

  // ─── Kanban drag resize ──────────────────────────────────────
  function startKanbanDrag(e: MouseEvent) {
    e.preventDefault()
    kanbanDragging = true
    const startY = e.clientY
    const startHeight = getKanbanHeight()

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      setKanbanHeight(startHeight + delta)
    }

    const onUp = () => {
      kanbanDragging = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ─── Chat overlay drag resize ────────────────────────────────
  function startChatDrag(e: MouseEvent) {
    e.preventDefault()
    chatDragging = true
    const startY = e.clientY
    const startHeight = getChatHeight()

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY // inverted: dragging up = bigger
      setChatHeight(startHeight + delta)
    }

    const onUp = () => {
      chatDragging = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ─── Chat overlay width drag resize (left edge) ──────────────
  function startChatWidthDrag(e: MouseEvent) {
    e.preventDefault()
    chatWidthDragging = true
    const startX = e.clientX
    const startWidth = getChatWidth()

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX // inverted: dragging left = wider
      setChatWidth(startWidth + delta)
    }

    const onUp = () => {
      chatWidthDragging = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function closeMobileOverlay() {
    mobileOverlay = false
  }

</script>

<div class="app-shell" class:dragging={sidebarDragging || kanbanDragging || chatDragging || chatWidthDragging} class:dragging-y={kanbanDragging || chatDragging}>
  <!-- Section A: Kanban -->
  <div
    class="kanban-panel"
    class:kanban-full={kanbanState === 'full'}
    class:kanban-compact={kanbanState === 'compact'}
    class:kanban-hidden={kanbanState === 'hidden'}
    style:height={kanbanState === 'compact' ? `${kanbanHeight}px` : undefined}
  >
    <GigiKanban />
  </div>

  <!-- Kanban drag handle (compact mode only) -->
  {#if kanbanState === 'compact'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="kanban-divider" onmousedown={startKanbanDrag}></div>
  {/if}

  <!-- Main area: Sidebar + Content -->
  {#if kanbanState !== 'full'}
  <div class="main-area">
    <!-- Section B: Sidebar (desktop) -->
    {#if !isMobile && sidebarState === 'full'}
      <div
        class="sidebar-panel"
        style:width="{sidebarWidth}px"
      >
        <GigiSidebar />
      </div>

      <!-- Drag handle -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="divider"
        onmousedown={startSidebarDrag}
      ></div>
    {/if}

    <!-- Content area: Filters + Main + Chat -->
    <div class="content-area">
      <!-- Section C: Filters -->
      <div class="filters-bar">
        <GigiFilters {connectionState} />
      </div>

      <!-- Section D: Main View -->
      <div class="main-content">
        <GigiMainView />
      </div>
    </div>
  </div>
  {/if}

  <!-- Section F: Chat Overlay (fixed position) -->
  {#if kanbanState !== 'full'}
    <div
      class="chat-overlay-wrapper"
      class:chat-full={chatState === 'full'}
      class:chat-compact={chatState === 'compact'}
      class:chat-hidden={chatState === 'hidden'}
      style:left={chatState === 'full' ? '0' : undefined}
      style:width={chatState === 'compact' ? `${chatWidth}px` : chatState === 'full' ? '100%' : undefined}
      style:height={chatState === 'compact' ? `${chatHeight}px` : chatState === 'full' ? '100vh' : undefined}
    >
      {#if chatState === 'compact'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="chat-drag-handle" onmousedown={startChatDrag}></div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="chat-width-handle" onmousedown={startChatWidthDrag}></div>
      {/if}
      <GigiChatOverlay />
    </div>
  {/if}

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

  .app-shell.dragging-y {
    cursor: row-resize;
  }

  /* Prevent iframes from capturing pointer events during any drag resize.
     Without this, moving the cursor over an iframe (e.g. Browser/Gitea panel)
     causes the iframe to steal mouse events and break the drag operation. */
  .app-shell.dragging :global(iframe) {
    pointer-events: none;
  }

  /* ── Kanban Panel ──────────────────────────────────────────── */

  .kanban-panel {
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    transition: all var(--gigi-transition-normal);
    flex-shrink: 0;
  }

  .kanban-panel.kanban-full {
    flex: 1;
    overflow: hidden;
  }

  .kanban-panel.kanban-compact {
    min-height: 120px;
  }

  .kanban-panel.kanban-hidden {
    height: auto;
    min-height: 0;
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

  /* ── Kanban Divider (Y-axis) ─────────────────────────────────── */

  .kanban-divider {
    height: var(--gigi-divider-width);
    cursor: row-resize;
    background: transparent;
    transition: background var(--gigi-transition-fast);
    flex-shrink: 0;
    position: relative;
  }

  .kanban-divider::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 24px;
    height: 2px;
    background: var(--gigi-border-default);
    border-radius: var(--gigi-radius-full);
    opacity: 0;
    transition: opacity var(--gigi-transition-fast);
  }

  .kanban-divider:hover {
    background: var(--gigi-accent-blue);
  }

  .kanban-divider:hover::after {
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

  /* ── Chat Overlay (fixed) ──────────────────────────────────── */

  .chat-overlay-wrapper {
    position: fixed;
    bottom: 0;
    right: 16px;
    z-index: var(--gigi-z-overlay, 100);
    display: flex;
    flex-direction: column;
    border-top-left-radius: var(--gigi-radius-lg, 8px);
    border-top-right-radius: var(--gigi-radius-lg, 8px);
    overflow: hidden;
    box-shadow: var(--gigi-shadow-lg, 0 -2px 16px rgba(0,0,0,0.3));
  }

  .chat-overlay-wrapper.chat-full {
    top: 0;
    left: 0 !important;
    right: 0;
    border-radius: 0;
    height: 100vh;
  }

  .chat-overlay-wrapper.chat-compact {
    min-height: 180px;
  }

  .chat-overlay-wrapper.chat-hidden {
    height: auto;
  }

  .chat-drag-handle {
    height: 6px;
    cursor: row-resize;
    background: var(--gigi-bg-tertiary);
    flex-shrink: 0;
    position: relative;
    transition: background var(--gigi-transition-fast);
  }

  .chat-drag-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 32px;
    height: 2px;
    background: var(--gigi-border-default);
    border-radius: var(--gigi-radius-full);
  }

  .chat-drag-handle:hover {
    background: var(--gigi-accent-blue);
  }

  .chat-width-handle {
    position: absolute;
    top: 0;
    left: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
    transition: background var(--gigi-transition-fast);
  }

  .chat-width-handle:hover {
    background: var(--gigi-accent-blue);
  }

  /* ── Mobile ────────────────────────────────────────────────── */

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
