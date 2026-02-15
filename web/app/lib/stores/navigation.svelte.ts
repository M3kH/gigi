/**
 * Navigation store — Svelte 5 runes for Section D view routing
 *
 * Manages which view is displayed in the main content area:
 * - overview: Dashboard with repo summaries, stats, activity
 * - gitea: Gitea page rendered in iframe (issues, PRs, code explorer)
 */

// ── Types ─────────────────────────────────────────────────────────────

export type ViewType = 'overview' | 'gitea'

export interface NavigationTarget {
  view: ViewType
  owner?: string
  repo?: string
  number?: number
  giteaPath?: string
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

export function navigateToGitea(path: string): void {
  navigate({ view: 'gitea', giteaPath: `/gitea${path}` })
}

export function navigateToIssue(owner: string, repo: string, number: number): void {
  navigate({ view: 'gitea', owner, repo, number, giteaPath: `/gitea/${owner}/${repo}/issues/${number}` })
}

export function navigateToPull(owner: string, repo: string, number: number): void {
  navigate({ view: 'gitea', owner, repo, number, giteaPath: `/gitea/${owner}/${repo}/pulls/${number}` })
}

export function navigateToRepo(owner: string, repo: string): void {
  navigate({ view: 'gitea', owner, repo, giteaPath: `/gitea/${owner}/${repo}` })
}

// ── Getters ───────────────────────────────────────────────────────────

export function getCurrentView(): NavigationTarget {
  return current
}

export function canGoBack(): boolean {
  return history.length > 0
}
