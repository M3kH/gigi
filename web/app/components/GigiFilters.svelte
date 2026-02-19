<script lang="ts">
  /**
   * Section C: Two-row filters bar
   *
   * Row 1 — Menu: sidebar toggle, Overview, Repositories, connection badge
   * Row 2 — Repo filter chips: fetched from /api/gitea/overview
   */
  import type { ConnectionState } from '$lib/services/ws-client'
  import type { Conversation } from '$lib/types/chat'
  import { getPanelState, setPanelState, togglePanel, type PanelState } from '$lib/stores/panels.svelte'
  import { getTheme, toggleTheme, type Theme } from '$lib/stores/theme.svelte'
  import { goHome, navigateToGitea, navigateToBrowser, getCurrentView, getViewContext } from '$lib/stores/navigation.svelte'
  import { selectConversation } from '$lib/stores/chat.svelte'
  import { onMount } from 'svelte'

  interface Props {
    connectionState?: ConnectionState
  }

  const { connectionState = 'disconnected' }: Props = $props()

  const sidebarState: PanelState = $derived(getPanelState('sidebar'))
  const currentView = $derived(getCurrentView())

  // Repo filter chips
  interface RepoSummary {
    name: string
    open_issues_count: number
    open_pr_count: number
  }

  let repos = $state<RepoSummary[]>([])
  let orgName = $state<string>('idea')
  let selectedRepo = $state<string | null>(null)
  let filtersExpanded = $state(true)
  let browserAvailable = $state(false)
  let mainExpanded = $state(false)
  let showSettings = $state(false)

  // Always Working Mode settings (persisted to localStorage)
  const AWM_KEY = 'gigi:always-working-mode'
  const AWM_INTERVAL_KEY = 'gigi:always-working-interval'

  function loadAwm(): boolean {
    try { return localStorage.getItem(AWM_KEY) === 'true' } catch { return false }
  }
  function loadAwmInterval(): number {
    try { return parseInt(localStorage.getItem(AWM_INTERVAL_KEY) || '15', 10) } catch { return 15 }
  }

  let alwaysWorkingEnabled = $state(loadAwm())
  let alwaysWorkingInterval = $state(loadAwmInterval())

  const currentTheme: Theme = $derived(getTheme())

  const kanbanState: PanelState = $derived(getPanelState('kanban'))
  const chatOverlayState: PanelState = $derived(getPanelState('chatOverlay'))

  onMount(async () => {
    try {
      const res = await fetch('/api/gitea/overview')
      if (res.ok) {
        const data = await res.json()
        repos = data.repos ?? []
        if (data.org?.name) orgName = data.org.name
      }
    } catch { /* ignore */ }

    try {
      const res = await fetch('/api/browser/status')
      if (res.ok) {
        const data = await res.json()
        browserAvailable = data.available
      }
    } catch { /* ignore */ }
  })

  function handleOverview() {
    goHome()
  }

  function handleRepositories() {
    navigateToGitea(`/${orgName}`)
  }

  function handleBrowser() {
    navigateToBrowser()
  }

  function handleToggleSidebar() {
    togglePanel('sidebar')
  }

  function selectRepo(name: string | null) {
    selectedRepo = name
  }

  // Saved panel states before expanding
  let savedKanban: PanelState | null = null
  let savedSidebar: PanelState | null = null
  let savedChat: PanelState | null = null

  function handleExpandMain() {
    if (mainExpanded) {
      // Restore previous states
      if (savedKanban) setPanelState('kanban', savedKanban)
      if (savedSidebar) setPanelState('sidebar', savedSidebar)
      if (savedChat) setPanelState('chatOverlay', savedChat)
      mainExpanded = false
    } else {
      // Save current states and collapse everything
      savedKanban = getPanelState('kanban')
      savedSidebar = getPanelState('sidebar')
      savedChat = getPanelState('chatOverlay')
      setPanelState('kanban', 'hidden')
      setPanelState('sidebar', 'hidden')
      setPanelState('chatOverlay', 'hidden')
      mainExpanded = true
    }
  }

  function handleToggleSettings() {
    showSettings = !showSettings
  }

  function handleAlwaysWorkingToggle() {
    try { localStorage.setItem(AWM_KEY, String(alwaysWorkingEnabled)) } catch { /* ignore */ }
    // Notify server about the setting change
    fetch('/api/config/always-working', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: alwaysWorkingEnabled, intervalMinutes: alwaysWorkingInterval }),
    }).catch(() => { /* ignore — server may not support this yet */ })
  }

  function handleIntervalChange() {
    try { localStorage.setItem(AWM_INTERVAL_KEY, String(alwaysWorkingInterval)) } catch { /* ignore */ }
    if (alwaysWorkingEnabled) {
      fetch('/api/config/always-working', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: alwaysWorkingEnabled, intervalMinutes: alwaysWorkingInterval }),
      }).catch(() => { /* ignore */ })
    }
  }

  // ── Linked conversations for current issue/PR ──────────────────────
  const viewCtx = $derived(getViewContext())
  const isIssuePrView = $derived(viewCtx.type === 'issue' || viewCtx.type === 'pull')

  // Build a tag like "reponame#42" to query linked conversations
  const contextTag = $derived(
    isIssuePrView && viewCtx.repo && viewCtx.number
      ? `${viewCtx.repo}#${viewCtx.number}`
      : null
  )

  let linkedChats = $state<Conversation[]>([])
  let linkedChatsLoading = $state(false)
  let lastFetchedTag = $state<string | null>(null)

  // Fetch linked conversations when the context tag changes
  $effect(() => {
    const tag = contextTag
    if (tag && tag !== lastFetchedTag) {
      lastFetchedTag = tag
      linkedChatsLoading = true
      fetch(`/api/conversations/by-tag/${encodeURIComponent(tag)}`)
        .then(r => r.ok ? r.json() : [])
        .then((convs: Conversation[]) => { linkedChats = convs })
        .catch(() => { linkedChats = [] })
        .finally(() => { linkedChatsLoading = false })
    } else if (!tag) {
      linkedChats = []
      lastFetchedTag = null
    }
  })

  function handleOpenChat(convId: string) {
    // Open chat panel if hidden, then select the conversation
    const chatState = getPanelState('chatOverlay')
    if (chatState === 'hidden') {
      setPanelState('chatOverlay', 'compact')
    }
    selectConversation(convId)
  }

  export function getSelectedRepo(): string | null {
    return selectedRepo
  }

  export function isSettingsOpen(): boolean {
    return showSettings
  }
</script>

<div class="gigi-filters">
  <!-- Row 1: Menu -->
  <div class="filter-row menu-row">
    {#if sidebarState === 'hidden'}
      <button class="menu-btn" onclick={handleToggleSidebar} title="Show sidebar">
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" fill="currentColor"/>
        </svg>
      </button>
    {/if}

    <button
      class="nav-btn"
      class:active={currentView.view === 'overview'}
      onclick={handleOverview}
    >Overview</button>

    <button
      class="nav-btn"
      class:active={currentView.view === 'gitea'}
      onclick={handleRepositories}
    >Repositories</button>

    {#if browserAvailable}
      <button
        class="nav-btn"
        class:active={currentView.view === 'browser'}
        onclick={handleBrowser}
      >Browser</button>
    {/if}

    <div class="filter-spacer"></div>

    <div class="connection-badge" title="WebSocket: {connectionState}">
      <span
        class="status-dot"
        class:connected={connectionState === 'connected'}
        class:connecting={connectionState === 'connecting' || connectionState === 'reconnecting'}
        class:disconnected={connectionState === 'disconnected'}
      ></span>
    </div>

    <!-- Expand/Collapse Section D -->
    <button
      class="menu-btn"
      class:active={mainExpanded}
      onclick={handleExpandMain}
      title={mainExpanded ? 'Restore panels' : 'Expand main view (hide board & chat)'}
    >
      {#if mainExpanded}
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path d="M4 14h6v6H4v-6zm10-10h6v6h-6V4zM4 4h6v6H4V4zm10 10h6v6h-6v-6z" fill="currentColor" opacity="0.6"/>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path d="M3 3h18v18H3V3zm2 2v14h14V5H5z" fill="currentColor"/>
        </svg>
      {/if}
    </button>

    <!-- Settings gear -->
    <button
      class="menu-btn"
      class:active={showSettings}
      onclick={handleToggleSettings}
      title="Settings"
    >
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.65-.07-.97l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.4 7.4 0 0 0-1.67-.97l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.67.97l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.97s.03.65.07.97l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.5.38 1.06.72 1.67.97l.38 2.65c.05.24.26.42.49.42h4c.24 0 .44-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.67-.97l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.49.49 0 0 0-.12-.64l-2.11-1.65z" fill="currentColor"/>
      </svg>
    </button>
  </div>

  <!-- Row 2: Repo filter chips (hidden on Overview where they don't apply) -->
  {#if repos.length > 0 && currentView.view !== 'overview'}
    <div class="filter-row chips-row" class:collapsed={!filtersExpanded}>
      <span class="filter-label" title="Filter issues and activity by repository">Repos:</span>
      <button
        class="chip"
        class:active={selectedRepo === null}
        onclick={() => selectRepo(null)}
      >All</button>
      {#each repos as repo}
        <button
          class="chip"
          class:active={selectedRepo === repo.name}
          onclick={() => selectRepo(repo.name)}
        >
          {repo.name}
          {#if repo.open_issues_count > 0}
            <span class="chip-count">{repo.open_issues_count}</span>
          {/if}
        </button>
      {/each}

      <button
        class="collapse-toggle"
        onclick={() => filtersExpanded = !filtersExpanded}
        title={filtersExpanded ? 'Collapse filters' : 'Expand filters'}
      >{filtersExpanded ? '▲' : '▼'}</button>
    </div>
  {/if}

  <!-- Row 3: Context bar — linked chats for current issue/PR -->
  {#if isIssuePrView}
    <div class="filter-row context-row">
      <span class="context-label">
        {viewCtx.type === 'issue' ? '📋' : '🔀'}
        {viewCtx.repo}#{viewCtx.number}
      </span>
      <div class="context-spacer"></div>
      {#if linkedChatsLoading}
        <span class="context-hint">Loading...</span>
      {:else if linkedChats.length > 0}
        {#each linkedChats as chat}
          <button
            class="context-chat-btn"
            onclick={() => handleOpenChat(chat.id)}
            title="Open conversation: {chat.topic}"
          >
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/>
            </svg>
            {chat.topic || 'Chat'}
            <span class="chat-status-dot" class:open={chat.status === 'open' || chat.status === 'active'} class:closed={chat.status === 'closed'}></span>
          </button>
        {/each}
      {:else}
        <span class="context-hint">No linked chats</span>
      {/if}
    </div>
  {/if}

  <!-- Settings Panel (F1) -->
  {#if showSettings}
    <div class="settings-panel">
      <div class="settings-header">
        <span class="settings-title">Settings</span>
        <button class="settings-close" onclick={() => showSettings = false}>×</button>
      </div>

      <div class="settings-section">
        <label class="settings-toggle">
          <span class="toggle-label">Dark Mode</span>
          <input type="checkbox" checked={currentTheme === 'dark'} onchange={toggleTheme} />
          <span class="toggle-slider"></span>
        </label>
        <p class="settings-hint">Toggle between dark and light theme. Also applies to Gitea.</p>
      </div>

      <div class="settings-section">
        <label class="settings-toggle">
          <span class="toggle-label">Always Working Mode</span>
          <input type="checkbox" bind:checked={alwaysWorkingEnabled} onchange={handleAlwaysWorkingToggle} />
          <span class="toggle-slider"></span>
        </label>
        <p class="settings-hint">When enabled, Gigi checks for work periodically and picks up issues autonomously.</p>

        {#if alwaysWorkingEnabled}
          <div class="settings-field">
            <label class="field-label" for="awm-interval">Check interval (minutes)</label>
            <input
              id="awm-interval"
              type="number"
              min="1"
              max="120"
              bind:value={alwaysWorkingInterval}
              onchange={handleIntervalChange}
              class="field-input"
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .gigi-filters {
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-secondary);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    width: 100%;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    min-height: 32px;
  }

  .menu-row {
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
  }

  /* ── Menu buttons ────────────────────────────────────────────── */

  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--gigi-text-secondary);
    cursor: pointer;
    padding: var(--gigi-space-xs);
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
  }

  .menu-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .nav-btn {
    background: none;
    border: none;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
    white-space: nowrap;
  }

  .nav-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .nav-btn.active {
    color: var(--gigi-text-primary);
    font-weight: 600;
    background: var(--gigi-bg-tertiary);
  }

  .filter-spacer {
    flex: 1;
  }

  /* ── Connection badge ────────────────────────────────────────── */

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

  /* ── Repo filter chips ───────────────────────────────────────── */

  .filter-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .chips-row {
    overflow-x: auto;
    scrollbar-width: none;
    gap: var(--gigi-space-xs);
  }

  .chips-row::-webkit-scrollbar {
    display: none;
  }

  .chips-row.collapsed {
    display: none;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--gigi-bg-tertiary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-full);
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--gigi-transition-fast);
    flex-shrink: 0;
  }

  .chip:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-primary);
  }

  .chip.active {
    background: var(--gigi-accent-blue);
    color: #fff;
    border-color: var(--gigi-accent-blue);
  }

  .chip-count {
    font-size: 9px;
    background: rgba(255, 255, 255, 0.2);
    padding: 0 4px;
    border-radius: var(--gigi-radius-full);
    font-weight: 600;
  }

  .chip.active .chip-count {
    background: rgba(255, 255, 255, 0.3);
  }

  .chip:not(.active) .chip-count {
    background: var(--gigi-bg-secondary);
    color: var(--gigi-text-muted);
  }

  .collapse-toggle {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    font-size: 8px;
    cursor: pointer;
    padding: var(--gigi-space-xs);
    margin-left: auto;
    flex-shrink: 0;
    transition: color var(--gigi-transition-fast);
  }

  .collapse-toggle:hover {
    color: var(--gigi-text-primary);
  }

  .menu-btn.active {
    color: var(--gigi-accent-blue);
    background: var(--gigi-bg-tertiary);
  }

  /* ── Settings Panel ──────────────────────────────────────────── */

  .settings-panel {
    padding: var(--gigi-space-md);
    border-top: var(--gigi-border-width) solid var(--gigi-border-default);
    background: var(--gigi-bg-tertiary);
    animation: slide-down 150ms ease;
  }

  @keyframes slide-down {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--gigi-space-sm);
  }

  .settings-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .settings-close {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
  }

  .settings-close:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-sm);
  }

  .settings-toggle {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    cursor: pointer;
    user-select: none;
  }

  .toggle-label {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-primary);
    flex: 1;
  }

  .settings-toggle input[type="checkbox"] {
    display: none;
  }

  .toggle-slider {
    width: 36px;
    height: 20px;
    background: var(--gigi-border-default);
    border-radius: 10px;
    position: relative;
    transition: background var(--gigi-transition-fast);
    flex-shrink: 0;
  }

  .toggle-slider::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    transition: transform var(--gigi-transition-fast);
  }

  .settings-toggle input:checked + .toggle-slider {
    background: var(--gigi-accent-green);
  }

  .settings-toggle input:checked + .toggle-slider::after {
    transform: translateX(16px);
  }

  .settings-hint {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    margin: 0;
    line-height: 1.4;
  }

  .settings-field {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .field-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-secondary);
    white-space: nowrap;
  }

  .field-input {
    width: 60px;
    padding: 4px 8px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-mono, monospace);
  }

  .field-input:focus {
    outline: none;
    border-color: var(--gigi-accent-green);
  }

  /* ── Context bar (issue/PR linked chats) ──────────────────────── */

  .context-row {
    background: var(--gigi-bg-tertiary);
    border-top: var(--gigi-border-width) solid var(--gigi-border-muted);
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    min-height: 28px;
  }

  .context-label {
    font-size: var(--gigi-font-size-xs);
    font-weight: 600;
    color: var(--gigi-text-primary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .context-spacer {
    flex: 1;
  }

  .context-hint {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    font-style: italic;
  }

  .context-chat-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--gigi-accent-blue);
    border: none;
    border-radius: var(--gigi-radius-full);
    color: #fff;
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--gigi-transition-fast);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .context-chat-btn:hover {
    filter: brightness(1.1);
  }

  .context-chat-btn svg {
    flex-shrink: 0;
  }

  .chat-status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .chat-status-dot.open {
    background: var(--gigi-accent-green);
  }

  .chat-status-dot.closed {
    background: var(--gigi-text-muted);
  }
</style>
