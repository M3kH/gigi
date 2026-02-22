<script lang="ts">
  /**
   * Section C: Two-row filters bar
   *
   * Row 1 — Menu: sidebar toggle, Overview, Repositories, connection badge
   * Row 2 — Repo filter chips: fetched from /api/gitea/overview
   */
  import type { ConnectionState } from '$lib/services/ws-client'
  import { getPanelState, setPanelState, togglePanel, type PanelState } from '$lib/stores/panels.svelte'
  import { getTheme, toggleTheme, type Theme } from '$lib/stores/theme.svelte'
  import { goHome, navigateToGitea, navigateToBrowser, getCurrentView } from '$lib/stores/navigation.svelte'
  import { getBudget, refreshBudget, saveBudget as saveBudgetToStore } from '$lib/stores/budget.svelte'
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

  // Always Working Mode settings — server is source of truth, localStorage is fallback
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
  let awmAgentBusy = $state(false)
  let awmLastCheck = $state<string | null>(null)

  // Budget settings — shared store is source of truth, local state for edit fields
  const budgetConfig = $derived(getBudget())
  let editBudgetUSD = $state(100)
  let editBudgetPeriod = $state(7)
  let budgetSaving = $state(false)
  let budgetSaved = $state(false)
  let budgetInitialized = $state(false)

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

    // Sync AWM state from server (source of truth)
    try {
      const res = await fetch('/api/config/always-working')
      if (res.ok) {
        const data = await res.json()
        alwaysWorkingEnabled = data.enabled
        alwaysWorkingInterval = data.intervalMinutes
        awmAgentBusy = data.agentBusy
        awmLastCheck = data.lastCheck
        // Keep localStorage in sync
        try { localStorage.setItem(AWM_KEY, String(data.enabled)) } catch { /* ignore */ }
        try { localStorage.setItem(AWM_INTERVAL_KEY, String(data.intervalMinutes)) } catch { /* ignore */ }
      }
    } catch { /* ignore — server may not support this yet */ }

    // Sync budget config from shared store
    await refreshBudget()
    editBudgetUSD = budgetConfig.budgetUSD
    editBudgetPeriod = budgetConfig.periodDays
    budgetInitialized = true
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

  // Sync edit fields when shared store updates (e.g. from CostWidget inline edit)
  $effect(() => {
    if (budgetInitialized) {
      editBudgetUSD = budgetConfig.budgetUSD
      editBudgetPeriod = budgetConfig.periodDays
    }
  })

  async function handleBudgetSave() {
    budgetSaving = true
    budgetSaved = false
    try {
      const ok = await saveBudgetToStore(editBudgetUSD, editBudgetPeriod)
      if (ok) {
        budgetSaved = true
        setTimeout(() => { budgetSaved = false }, 2000)
      }
    } finally {
      budgetSaving = false
    }
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
        <!-- pixelarticons: menu -->
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm16 5H4v2h16v-2z" fill="currentColor"/>
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
        <!-- pixelarticons: collapse -->
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path d="M17 3h-2v2h-2v2h-2V5H9V3H7v2h2v2h2v2h2V7h2V5h2V3zM4 13h16v-2H4v2zm9 4h-2v-2h2v2zm2 2h-2v-2h2v2zm0 0h2v2h-2v-2zm-6 0h2v-2H9v2zm0 0H7v2h2v-2z" fill="currentColor"/>
        </svg>
      {:else}
        <!-- pixelarticons: expand -->
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path d="M11 5h2v2h2v2h2V7h-2V5h-2V3h-2v2zM9 7V5h2v2H9zm0 0v2H7V7h2zm-5 6h16v-2H4v2zm9 6h-2v-2H9v-2H7v2h2v2h2v2h2v-2zm2-2h-2v2h2v-2zm0 0h2v-2h-2v2z" fill="currentColor"/>
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
      <!-- pixelarticons: sliders -->
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M17 4h2v10h-2V4zm0 12h-2v2h2v2h2v-2h2v-2h-4zm-4-6h-2v10h2V10zm-8 2H3v2h2v6h2v-6h2v-2H5zm8-8h-2v2H9v2h6V6h-2V4zM5 4h2v6H5V4z" fill="currentColor"/>
      </svg>
    </button>
  </div>

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
          <p class="settings-hint awm-status">
            Agent: <span class={awmAgentBusy ? 'status-busy' : 'status-idle'}>{awmAgentBusy ? 'busy' : 'idle'}</span>
            {#if awmLastCheck}
              · Last check: {new Date(awmLastCheck).toLocaleTimeString()}
            {/if}
          </p>
        {/if}
      </div>

      <div class="settings-divider"></div>

      <div class="settings-section">
        <span class="section-label">Budget</span>
        <p class="settings-hint">Set a spending limit. The cost widget on the overview will show progress against this budget.</p>
        <div class="settings-field">
          <label class="field-label" for="settings-budget-amount">Amount ($)</label>
          <input
            id="settings-budget-amount"
            type="number"
            min="1"
            max="10000"
            step="10"
            bind:value={editBudgetUSD}
            class="field-input"
          />
        </div>
        <div class="settings-field">
          <label class="field-label" for="settings-budget-period">Period</label>
          <select
            id="settings-budget-period"
            bind:value={editBudgetPeriod}
            class="field-select"
          >
            <option value={1}>Daily</option>
            <option value={7}>Weekly</option>
            <option value={14}>Bi-weekly</option>
            <option value={30}>Monthly</option>
          </select>
        </div>
        <div class="settings-field">
          <button
            class="settings-save-btn"
            onclick={handleBudgetSave}
            disabled={budgetSaving}
          >
            {budgetSaving ? 'Saving...' : budgetSaved ? 'Saved!' : 'Save budget'}
          </button>
        </div>
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

  .field-input:focus,
  .field-select:focus {
    outline: none;
    border-color: var(--gigi-accent-green);
  }

  .field-select {
    padding: 4px 8px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
  }

  .settings-divider {
    border-top: 1px solid var(--gigi-border-muted);
    margin: var(--gigi-space-sm) 0;
  }

  .section-label {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-primary);
  }

  .settings-save-btn {
    padding: 4px 12px;
    background: var(--gigi-accent-blue);
    color: #fff;
    border: none;
    border-radius: var(--gigi-radius-sm);
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    transition: all var(--gigi-transition-fast);
  }

  .settings-save-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .settings-save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* ── AWM status ────────────────────────────────────────────────── */

  .awm-status {
    font-family: var(--gigi-font-mono, monospace);
  }

  .status-busy {
    color: var(--gigi-accent-orange);
    font-weight: 600;
  }

  .status-idle {
    color: var(--gigi-accent-green);
    font-weight: 600;
  }
</style>
