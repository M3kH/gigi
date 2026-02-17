/**
 * Svelte action to intercept link clicks and route them in-app.
 *
 * - Gitea links (matching the current origin or /gitea paths) → navigate in Section D iframe
 * - External links → pass through normally
 * - Relative paths → navigate via Gitea iframe
 */

import { navigateToGitea } from '$lib/stores/navigation.svelte'

/**
 * Extract a Gitea-relative path from an absolute or relative URL.
 * Returns the path (e.g. "/idea/gigi/pulls/5") or null if not a Gitea link.
 */
function extractGiteaPath(href: string): string | null {
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

    // Same origin (e.g. https://prod.gigi.local)
    if (url.origin === origin) {
      let path = url.pathname
      if (path.startsWith('/gitea/')) path = path.replace(/^\/gitea/, '')
      return path
    }

    // Also match common Gitea URL patterns in the path
    // e.g. links like https://prod.gigi.local/gitea/idea/gigi/issues/5
    const giteaMatch = url.pathname.match(/^\/gitea(\/.+)/)
    if (giteaMatch && url.origin === origin) {
      return giteaMatch[1]
    }
  } catch {
    // Invalid URL — ignore
  }

  return null
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
