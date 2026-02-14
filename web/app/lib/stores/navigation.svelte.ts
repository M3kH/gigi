/**
 * Navigation store — Svelte 5 runes for Section D view routing
 *
 * Manages which view is displayed in the main content area:
 * - overview: Dashboard with repo summaries, stats, activity
 * - issue: Single issue detail view
 * - pull: Single PR detail view
 * - repo: Repository file explorer
 */

// ── Types ─────────────────────────────────────────────────────────────

export type ViewType = 'overview' | 'issue' | 'pull' | 'repo'

export interface NavigationTarget {
  view: ViewType
  owner?: string
  repo?: string
  number?: number
}

// ── State ─────────────────────────────────────────────────────────────

let current = $state<NavigationTarget>({ view: 'overview' })
let history = $state<NavigationTarget[]>([])

// ── Public API ────────────────────────────────────────────────────────

export function navigate(target: NavigationTarget): void {
  history = [...history, current]
  current = target
}

export function goBack(): void {
  const prev = history[history.length - 1]
  if (prev) {
    history = history.slice(0, -1)
    current = prev
  }
}

export function goHome(): void {
  history = []
  current = { view: 'overview' }
}

export function navigateToIssue(owner: string, repo: string, number: number): void {
  navigate({ view: 'issue', owner, repo, number })
}

export function navigateToPull(owner: string, repo: string, number: number): void {
  navigate({ view: 'pull', owner, repo, number })
}

export function navigateToRepo(owner: string, repo: string): void {
  navigate({ view: 'repo', owner, repo })
}

// ── Getters ───────────────────────────────────────────────────────────

export function getCurrentView(): NavigationTarget {
  return current
}

export function canGoBack(): boolean {
  return history.length > 0
}
