/**
 * Svelte action to intercept link clicks and route them in-app.
 *
 * - Gitea links (matching the current origin, /gitea paths, or known Gitea URL patterns) → navigate in Section D iframe
 * - External links → pass through normally
 * - Relative paths → navigate via Gitea iframe
 */

import { navigateToGitea } from '$lib/stores/navigation.svelte'

/**
 * Gitea URL patterns that identify a Gitea page.
 *
 * Rather than enumerating every sub-page (issues, actions, releases, etc.),
 * we match broadly: any /owner/repo path, org pages, and admin pages.
 * Non-page prefixes (API, assets, etc.) are filtered out separately.
 */
const GITEA_NON_PAGE_PREFIXES = ['/api/', '/assets/', '/swagger', '/-/health']

const GITEA_PAGE_PATTERNS = [
  /^\/[^/]+\/[^/]+/,   // /owner/repo (and any sub-path: issues, actions, releases, etc.)
  /^\/[^/]+\/?$/,       // /owner (org page)
  /^\/-\/admin/,         // /-/admin/... (admin pages)
]

/**
 * Extract a Gitea-relative path from an absolute or relative URL.
 * Returns the path (e.g. "/gigi/gigi/pulls/5") or null if not a Gitea link.
 *
 * Exported for testing.
 */
export function extractGiteaPath(href: string): string | null {
  // Relative internal paths
  if (href.startsWith('/') && !href.startsWith('//')) {
    // Strip /gitea prefix if present
    if (href.startsWith('/gitea/')) return href.replace(/^\/gitea/, '')
    return href
  }

  // Absolute URLs — check if they point to our Gitea instance
  try {
    const url = new URL(href)
    const origin = window.location.origin

    // Same origin
    if (url.origin === origin) {
      let path = url.pathname
      if (path.startsWith('/gitea/')) path = path.replace(/^\/gitea/, '')
      return path
    }

    // Cross-origin but has /gitea/ path prefix → likely our Gitea proxy on another host
    // This handles cross-origin links between dev/prod instances of the same Gitea
    if (url.pathname.startsWith('/gitea/')) {
      return url.pathname.replace(/^\/gitea/, '')
    }

    // Cross-origin Gitea instance (e.g., webhook URLs from a different host)
    // Match URLs that look like Gitea pages (issues, PRs, commits, etc.)
    // Only match hostnames in the same domain family
    const currentHost = window.location.hostname
    const linkHost = url.hostname
    const isSameDomainFamily =
      currentHost === linkHost ||
      getSuffix(currentHost) === getSuffix(linkHost)

    if (isSameDomainFamily) {
      const path = url.pathname
      // Strip /gitea prefix if present in the URL
      const cleanPath = path.startsWith('/gitea/') ? path.replace(/^\/gitea/, '') : path
      // Check if the path looks like a Gitea page (not an API/asset endpoint)
      if (
        !GITEA_NON_PAGE_PREFIXES.some(prefix => cleanPath.startsWith(prefix)) &&
        GITEA_PAGE_PATTERNS.some(p => p.test(cleanPath))
      ) {
        return cleanPath
      }
    }
  } catch {
    // Invalid URL — ignore
  }

  return null
}

/**
 * Get the domain suffix (last two segments) for comparison.
 * e.g., "dev.example.com" → "example.com", "prod.example.com" → "example.com"
 */
function getSuffix(hostname: string): string {
  const parts = hostname.split('.')
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname
}

export function interceptLinks(node: HTMLElement) {
  function handleClick(e: MouseEvent) {
    // Don't intercept modified clicks (new tab, etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href')
    if (!href) return

    // Skip mailto: and other protocol links
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return

    // Try to extract a Gitea path from the link
    const giteaPath = extractGiteaPath(href)
    if (giteaPath) {
      e.preventDefault()
      navigateToGitea(giteaPath)
      return
    }

    // For external links, let browser handle normally (opens in new tab if target="_blank")
  }

  node.addEventListener('click', handleClick)
  return {
    destroy() {
      node.removeEventListener('click', handleClick)
    },
  }
}
