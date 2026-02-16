/**
 * Svelte action to intercept internal link clicks and route them in-app.
 *
 * External links (http://, //, mailto:) pass through normally.
 * Internal paths (e.g. /owner/repo) navigate via the Gitea iframe.
 */

import { navigateToGitea } from '$lib/stores/navigation.svelte'

export function interceptLinks(node: HTMLElement) {
  function handleClick(e: MouseEvent) {
    // Don't intercept modified clicks (new tab, etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href')
    if (!href) return

    // Let external links pass through
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//') || href.startsWith('mailto:')) return

    // Internal path — intercept and navigate in-app
    e.preventDefault()
    navigateToGitea(href)
  }

  node.addEventListener('click', handleClick)
  return {
    destroy() {
      node.removeEventListener('click', handleClick)
    },
  }
}
