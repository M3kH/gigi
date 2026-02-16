/**
 * Navigation store — Svelte 5 runes for Section D view routing
 *
 * Manages which view is displayed in the main content area:
 * - overview: Dashboard with repo summaries, stats, activity
 * - gitea: Gitea page rendered in iframe (issues, PRs, code explorer)
 *
 * Also tracks ViewContext — parsed page context from the iframe so the
 * chat agent knows what the user is currently looking at.
 */

// ── Types ─────────────────────────────────────────────────────────────

export type ViewType = 'overview' | 'gitea' | 'browser'

export interface NavigationTarget {
  view: ViewType
  owner?: string
  repo?: string
  number?: number
  giteaPath?: string
}

export interface ViewContext {
  type: 'overview' | 'repo' | 'issue' | 'pull' | 'file' | 'commit' | 'unknown'
  owner?: string
  repo?: string
  number?: number
  filepath?: string
  branch?: string
  commitSha?: string
  rawPath?: string
}

// ── View Context Parser ──────────────────────────────────────────────

export function parseGiteaPath(path: string): ViewContext {
  // Strip /gitea prefix if present
  const clean = path.replace(/^\/gitea/, '')

  // /owner/repo/issues/N
  const issueMatch = clean.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)/)
  if (issueMatch) {
    return { type: 'issue', owner: issueMatch[1], repo: issueMatch[2], number: parseInt(issueMatch[3], 10), rawPath: path }
  }

  // /owner/repo/pulls/N
  const pullMatch = clean.match(/^\/([^/]+)\/([^/]+)\/pulls\/(\d+)/)
  if (pullMatch) {
    return { type: 'pull', owner: pullMatch[1], repo: pullMatch[2], number: parseInt(pullMatch[3], 10), rawPath: path }
  }

  // /owner/repo/src/branch/branchName/filepath...
  const fileMatch = clean.match(/^\/([^/]+)\/([^/]+)\/src\/branch\/([^/]+)\/(.+)/)
  if (fileMatch) {
    return { type: 'file', owner: fileMatch[1], repo: fileMatch[2], branch: fileMatch[3], filepath: fileMatch[4], rawPath: path }
  }

  // /owner/repo/commit/sha
  const commitMatch = clean.match(/^\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]+)/)
  if (commitMatch) {
    return { type: 'commit', owner: commitMatch[1], repo: commitMatch[2], commitSha: commitMatch[3], rawPath: path }
  }

  // /owner/repo (bare repo page — no further path segments that indicate sub-pages)
  const repoMatch = clean.match(/^\/([^/]+)\/([^/]+)\/?$/)
  if (repoMatch) {
    return { type: 'repo', owner: repoMatch[1], repo: repoMatch[2], rawPath: path }
  }

  // Fallback: if we have /owner/repo/... it's still a repo context
  const repoFallback = clean.match(/^\/([^/]+)\/([^/]+)/)
  if (repoFallback) {
    return { type: 'unknown', owner: repoFallback[1], repo: repoFallback[2], rawPath: path }
  }

  return { type: 'overview', rawPath: path }
}

// ── State ─────────────────────────────────────────────────────────────

let current = $state<NavigationTarget>({ view: 'overview' })
let history = $state<NavigationTarget[]>([])
let viewContext = $state<ViewContext>({ type: 'overview' })

// ── Public API ────────────────────────────────────────────────────────

export function navigate(target: NavigationTarget): void {
  history = [...history, current]
  current = target
  // Auto-set view context from navigation target
  if (target.giteaPath) {
    viewContext = parseGiteaPath(target.giteaPath)
  } else if (target.view === 'overview') {
    viewContext = { type: 'overview' }
  } else if (target.view === 'browser') {
    viewContext = { type: 'overview' }
  }
  // Push URL state for deep-linking
  if (typeof window !== 'undefined') {
    window.history.pushState(target, '', targetToUrl(target))
  }
}

export function goBack(): void {
  const prev = history[history.length - 1]
  if (prev) {
    history = history.slice(0, -1)
    current = prev
    if (prev.giteaPath) {
      viewContext = parseGiteaPath(prev.giteaPath)
    } else {
      viewContext = { type: 'overview' }
    }
  }
}

export function goHome(): void {
  history = []
  current = { view: 'overview' }
  viewContext = { type: 'overview' }
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

export function navigateToBrowser(): void {
  navigate({ view: 'browser' })
}

// ── View Context ─────────────────────────────────────────────────────

export function setViewContext(ctx: ViewContext): void {
  viewContext = ctx
}

export function getViewContext(): ViewContext {
  return viewContext
}

// ── Getters ───────────────────────────────────────────────────────────

export function getCurrentView(): NavigationTarget {
  return current
}

export function canGoBack(): boolean {
  return history.length > 0
}

// ── URL sync ──────────────────────────────────────────────────────────

function targetToUrl(t: NavigationTarget): string {
  if (t.giteaPath) return t.giteaPath.replace(/^\/gitea/, '')
  if (t.view === 'browser') return '/browser'
  return '/'
}

function urlToTarget(pathname: string): NavigationTarget {
  if (pathname === '/' || pathname === '') return { view: 'overview' }
  if (pathname === '/browser') return { view: 'browser' }
  // Treat any other path as a Gitea path
  return { view: 'gitea', giteaPath: `/gitea${pathname}` }
}

/**
 * Initialize URL-based routing: parse initial URL + listen for popstate.
 * Call once from AppShell onMount.
 */
export function initUrlSync(): () => void {
  // Parse initial URL
  const initial = urlToTarget(window.location.pathname)
  if (initial.view !== 'overview') {
    current = initial
    if (initial.giteaPath) {
      viewContext = parseGiteaPath(initial.giteaPath)
    }
  }

  // Listen for back/forward
  function onPopState(e: PopStateEvent) {
    const target = (e.state as NavigationTarget) ?? urlToTarget(window.location.pathname)
    current = target
    if (target.giteaPath) {
      viewContext = parseGiteaPath(target.giteaPath)
    } else if (target.view === 'overview') {
      viewContext = { type: 'overview' }
    } else {
      viewContext = { type: 'overview' }
    }
  }

  window.addEventListener('popstate', onPopState)
  return () => window.removeEventListener('popstate', onPopState)
}
