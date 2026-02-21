<script lang="ts">
  /**
   * Cost monitoring widget for the dashboard
   *
   * Shows total spend, budget usage, and daily trend.
   * Budget is configurable inline via edit mode or from Settings.
   * Uses shared budget store for cross-component sync.
   * Part of issue #21: Token optimization - Strategy 4 (Cost Monitoring).
   */
  import { onMount } from 'svelte'
  import { formatCost } from '$lib/utils/format'
  import { getBudget, refreshBudget, saveBudget as saveBudgetToStore, isBudgetLoaded } from '$lib/stores/budget.svelte'

  interface UsageStats {
    total_cost: number
    total_conversations: number
    total_messages: number
    total_input_tokens: number
    total_output_tokens: number
    total_cache_read_tokens: number
    avg_cost_per_conversation: number
    daily_costs: Array<{
      date: string
      cost: number
      conversations: number
      messages: number
    }>
    top_conversations: Array<{
      id: string
      topic: string | null
      cost: number
      message_count: number
    }>
  }

  let stats = $state<UsageStats | null>(null)
  let statsLoading = $state(true)
  let expanded = $state(false)

  // Budget editing state (local to this component)
  let editing = $state(false)
  let editBudgetUSD = $state(100)
  let editPeriodDays = $state(7)
  let saving = $state(false)

  // Derive from shared budget store
  const budget = $derived(getBudget())
  const budgetLoaded = $derived(isBudgetLoaded())
  const periodCost = $derived(budget.periodSpend)
  const budgetLimit = $derived(budget.budgetUSD)
  const percentUsed = $derived(budget.percentUsed)
  const avgCost = $derived(stats?.avg_cost_per_conversation ?? 0)
  const totalCost = $derived(stats?.total_cost ?? 0)
  const loading = $derived(!budgetLoaded || statsLoading)

  const periodLabel = $derived(
    budget.periodDays === 7 ? 'week' : budget.periodDays === 30 ? 'month' : budget.periodDays === 1 ? 'day' : `${budget.periodDays}d`
  )

  onMount(async () => {
    // Load budget from shared store + stats independently
    await Promise.all([
      refreshBudget(),
      loadStats(),
    ])
  })

  async function loadStats() {
    try {
      const res = await fetch('/api/usage/stats?days=7')
      if (res.ok) stats = await res.json()
    } catch (err) {
      console.error('[cost-widget] Failed to load stats:', err)
    } finally {
      statsLoading = false
    }
  }

  function startEditing(e: MouseEvent) {
    e.stopPropagation()
    editBudgetUSD = budgetLimit
    editPeriodDays = budget.periodDays
    editing = true
  }

  function cancelEditing(e: MouseEvent) {
    e.stopPropagation()
    editing = false
  }

  async function handleSaveBudget(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation()
    saving = true
    try {
      const ok = await saveBudgetToStore(editBudgetUSD, editPeriodDays)
      if (ok) editing = false
    } finally {
      saving = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSaveBudget(e)
    } else if (e.key === 'Escape') {
      editing = false
    }
  }
</script>

<div class="cost-widget" class:over-budget={budget.overBudget}>
  <button class="cost-header" onclick={() => (expanded = !expanded)}>
    <div class="cost-icon" class:warning={budget.overBudget}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 16A8 8 0 108 0a8 8 0 000 16zm.25-11.25v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 011.5 0zM8 13a1 1 0 110-2 1 1 0 010 2z"/>
      </svg>
    </div>
    <div class="cost-summary">
      <span class="cost-value" class:warning={budget.overBudget}>
        {loading ? '...' : formatCost(periodCost) || '$0.00'}
      </span>
      <span class="cost-label">
        / {formatCost(budgetLimit) || '$100'} this {periodLabel}
      </span>
    </div>
    {#if !loading && budgetLoaded}
      <div class="cost-bar">
        <div
          class="cost-bar-fill"
          class:warning={percentUsed > 80}
          class:danger={budget.overBudget}
          style="width: {Math.min(percentUsed, 100)}%"
        ></div>
      </div>
    {/if}
    <span class="expand-icon">{expanded ? '−' : '+'}</span>
  </button>

  {#if expanded}
    {#if editing}
      <!-- Budget edit form (inline) -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="budget-edit" onclick={(e: MouseEvent) => e.stopPropagation()}>
        <div class="edit-row">
          <label class="edit-label" for="budget-amount">Budget ($)</label>
          <input
            id="budget-amount"
            type="number"
            min="1"
            max="10000"
            step="10"
            bind:value={editBudgetUSD}
            onkeydown={handleKeydown}
            class="edit-input"
          />
        </div>
        <div class="edit-row">
          <label class="edit-label" for="budget-period">Period</label>
          <select
            id="budget-period"
            bind:value={editPeriodDays}
            class="edit-select"
          >
            <option value={1}>Daily</option>
            <option value={7}>Weekly</option>
            <option value={14}>Bi-weekly</option>
            <option value={30}>Monthly</option>
          </select>
        </div>
        <div class="edit-actions">
          <button class="edit-btn save" onclick={handleSaveBudget} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button class="edit-btn cancel" onclick={cancelEditing}>Cancel</button>
        </div>
      </div>
    {:else if stats}
      <div class="cost-details">
        <div class="cost-row">
          <span class="detail-label">Total (30d)</span>
          <span class="detail-value">{formatCost(totalCost) || '$0.00'}</span>
        </div>
        <div class="cost-row">
          <span class="detail-label">Avg per conv</span>
          <span class="detail-value">{formatCost(avgCost) || '$0.00'}</span>
        </div>
        <div class="cost-row">
          <span class="detail-label">Conversations</span>
          <span class="detail-value">{stats.total_conversations}</span>
        </div>
        <div class="cost-row">
          <span class="detail-label">Cache reads</span>
          <span class="detail-value">{stats.total_cache_read_tokens > 1_000_000 ? (stats.total_cache_read_tokens / 1_000_000).toFixed(1) + 'M' : (stats.total_cache_read_tokens / 1_000).toFixed(0) + 'K'}</span>
        </div>
        {#if stats.top_conversations.length > 0}
          <div class="cost-divider"></div>
          <div class="top-convs-header">Top spenders</div>
          {#each stats.top_conversations.slice(0, 3) as conv}
            <div class="cost-row top-conv">
              <span class="detail-label" title={conv.topic || 'Untitled'}>{(conv.topic || 'Untitled').slice(0, 30)}</span>
              <span class="detail-value">{formatCost(conv.cost) || '<$0.01'}</span>
            </div>
          {/each}
        {/if}
        <div class="cost-divider"></div>
        <button class="configure-btn" onclick={startEditing}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.65-.07-.97l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.4 7.4 0 0 0-1.67-.97l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.67.97l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.97s.03.65.07.97l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.5.38 1.06.72 1.67.97l.38 2.65c.05.24.26.42.49.42h4c.24 0 .44-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.67-.97l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.49.49 0 0 0-.12-.64l-2.11-1.65z"/>
          </svg>
          Configure budget
        </button>
      </div>
    {:else}
      <div class="cost-details">
        <button class="configure-btn" onclick={startEditing}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.65-.07-.97l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.4 7.4 0 0 0-1.67-.97l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.67.97l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.97s.03.65.07.97l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.5.38 1.06.72 1.67.97l.38 2.65c.05.24.26.42.49.42h4c.24 0 .44-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.67-.97l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.49.49 0 0 0-.12-.64l-2.11-1.65z"/>
          </svg>
          Configure budget
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .cost-widget {
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    border-top: 3px solid var(--gigi-accent-green);
    transition: all var(--gigi-transition-fast);
  }

  .cost-widget.over-budget {
    border-top-color: var(--gigi-accent-red);
    background: rgba(248, 81, 73, 0.04);
  }

  .cost-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-md) var(--gigi-space-lg);
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    color: var(--gigi-text-primary);
  }

  .cost-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--gigi-radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(63, 185, 80, 0.12);
    color: var(--gigi-accent-green);
    flex-shrink: 0;
  }

  .cost-icon.warning {
    background: rgba(248, 81, 73, 0.12);
    color: var(--gigi-accent-red);
  }

  .cost-summary {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .cost-value {
    font-size: var(--gigi-font-size-base);
    font-weight: 700;
    color: var(--gigi-accent-green);
    font-variant-numeric: tabular-nums;
  }

  .cost-value.warning {
    color: var(--gigi-accent-red);
  }

  .cost-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .cost-bar {
    flex: 1;
    height: 4px;
    background: var(--gigi-bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    min-width: 40px;
  }

  .cost-bar-fill {
    height: 100%;
    background: var(--gigi-accent-green);
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .cost-bar-fill.warning {
    background: var(--gigi-accent-orange);
  }

  .cost-bar-fill.danger {
    background: var(--gigi-accent-red);
  }

  .expand-icon {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-muted);
    flex-shrink: 0;
  }

  .cost-details {
    padding: 0 var(--gigi-space-lg) var(--gigi-space-md);
    font-size: var(--gigi-font-size-xs);
  }

  .cost-row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    color: var(--gigi-text-secondary);
  }

  .detail-label {
    color: var(--gigi-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-value {
    font-family: var(--gigi-font-mono, monospace);
    font-variant-numeric: tabular-nums;
    color: var(--gigi-text-secondary);
    flex-shrink: 0;
    margin-left: var(--gigi-space-sm);
  }

  .cost-divider {
    border-top: 1px solid var(--gigi-border-muted);
    margin: var(--gigi-space-xs) 0;
  }

  .top-convs-header {
    font-size: 10px;
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 2px;
  }

  .top-conv .detail-label {
    font-size: 10px;
  }

  /* ── Configure button ─────────────────────────────────────────── */

  .configure-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 0;
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    transition: color var(--gigi-transition-fast);
  }

  .configure-btn:hover {
    color: var(--gigi-accent-blue);
  }

  /* ── Budget edit form ─────────────────────────────────────────── */

  .budget-edit {
    padding: var(--gigi-space-sm) var(--gigi-space-lg) var(--gigi-space-md);
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-sm);
  }

  .edit-row {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .edit-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-secondary);
    white-space: nowrap;
    min-width: 72px;
  }

  .edit-input,
  .edit-select {
    flex: 1;
    padding: 4px 8px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-mono, monospace);
  }

  .edit-select {
    font-family: var(--gigi-font-sans);
    cursor: pointer;
  }

  .edit-input:focus,
  .edit-select:focus {
    outline: none;
    border-color: var(--gigi-accent-blue);
  }

  .edit-actions {
    display: flex;
    gap: var(--gigi-space-xs);
    justify-content: flex-end;
    margin-top: var(--gigi-space-xs);
  }

  .edit-btn {
    padding: 4px 12px;
    border-radius: var(--gigi-radius-sm);
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    transition: all var(--gigi-transition-fast);
  }

  .edit-btn.save {
    background: var(--gigi-accent-blue);
    color: #fff;
    border-color: var(--gigi-accent-blue);
  }

  .edit-btn.save:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .edit-btn.save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .edit-btn.cancel {
    background: var(--gigi-bg-tertiary);
    color: var(--gigi-text-secondary);
  }

  .edit-btn.cancel:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-primary);
  }
</style>
