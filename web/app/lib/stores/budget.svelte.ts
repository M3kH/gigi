/**
 * Budget store — Svelte 5 runes
 *
 * Shared reactive state for budget configuration.
 * Both the CostWidget (inline edit) and Settings panel read/write
 * through this store so changes are reflected everywhere instantly.
 */

export interface BudgetConfig {
  budgetUSD: number
  periodDays: number
  periodSpend: number
  overBudget: boolean
  percentUsed: number
}

// ─── Reactive state ──────────────────────────────────────────────────

let config = $state<BudgetConfig>({
  budgetUSD: 100,
  periodDays: 7,
  periodSpend: 0,
  overBudget: false,
  percentUsed: 0,
})

let loaded = $state(false)

// ─── Getters ─────────────────────────────────────────────────────────

export function getBudget(): BudgetConfig {
  return config
}

export function isBudgetLoaded(): boolean {
  return loaded
}

// ─── Actions ─────────────────────────────────────────────────────────

/** Fetch budget config + spend from the server */
export async function refreshBudget(): Promise<void> {
  try {
    const res = await fetch('/api/usage/budget')
    if (res.ok) {
      const data = await res.json()
      config = {
        budgetUSD: data.budgetUSD ?? 100,
        periodDays: data.periodDays ?? 7,
        periodSpend: data.periodSpend ?? 0,
        overBudget: data.overBudget ?? false,
        percentUsed: data.percentUsed ?? 0,
      }
      loaded = true
    }
  } catch (err) {
    console.error('[budget-store] Failed to load:', err)
  }
}

/** Save new budget config to the server and refresh state */
export async function saveBudget(budgetUSD: number, periodDays: number): Promise<boolean> {
  try {
    const res = await fetch('/api/usage/budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budgetUSD, periodDays }),
    })
    if (res.ok) {
      // Re-fetch to get updated percentUsed, periodSpend, etc.
      await refreshBudget()
      return true
    }
  } catch (err) {
    console.error('[budget-store] Failed to save:', err)
  }
  return false
}
