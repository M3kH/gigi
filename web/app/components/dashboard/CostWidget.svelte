<script lang="ts">
  /**
   * Cost monitoring widget for the dashboard
   *
   * Shows total spend, budget usage, and daily trend.
   * Part of issue #21: Token optimization - Strategy 4 (Cost Monitoring).
   */
  import { onMount } from 'svelte'
  import { formatCost } from '$lib/utils/format'

  interface BudgetCheck {
    periodSpend: number
    budgetUSD: number
    overBudget: boolean
    percentUsed: number
  }

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

  let budget = $state<BudgetCheck | null>(null)
  let stats = $state<UsageStats | null>(null)
  let loading = $state(true)
  let expanded = $state(false)

  const periodCost = $derived(budget?.periodSpend ?? 0)
  const budgetLimit = $derived(budget?.budgetUSD ?? 100)
  const percentUsed = $derived(budget?.percentUsed ?? 0)
  const avgCost = $derived(stats?.avg_cost_per_conversation ?? 0)
  const totalCost = $derived(stats?.total_cost ?? 0)

  onMount(async () => {
    try {
      const [budgetRes, statsRes] = await Promise.all([
        fetch('/api/usage/budget'),
        fetch('/api/usage/stats?days=7'),
      ])
      if (budgetRes.ok) budget = await budgetRes.json()
      if (statsRes.ok) stats = await statsRes.json()
    } catch (err) {
      console.error('[cost-widget] Failed to load:', err)
    } finally {
      loading = false
    }
  })
</script>

<div class="cost-widget" class:over-budget={budget?.overBudget}>
  <button class="cost-header" onclick={() => (expanded = !expanded)}>
    <div class="cost-icon" class:warning={budget?.overBudget}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 16A8 8 0 108 0a8 8 0 000 16zm.25-11.25v4.5a.75.75 0 01-1.5 0v-4.5a.75.75 0 011.5 0zM8 13a1 1 0 110-2 1 1 0 010 2z"/>
      </svg>
    </div>
    <div class="cost-summary">
      <span class="cost-value" class:warning={budget?.overBudget}>
        {loading ? '...' : formatCost(periodCost) || '$0.00'}
      </span>
      <span class="cost-label">
        / {formatCost(budgetLimit) || '$100'} this week
      </span>
    </div>
    {#if !loading && budget}
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

  {#if expanded && stats}
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
    </div>
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
</style>
