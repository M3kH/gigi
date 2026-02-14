/**
 * Reactive mobile breakpoint detection — Svelte 5 runes
 *
 * Provides a reactive `isMobile` signal that tracks window width.
 * Centralizes responsive logic instead of duplicating in components.
 */

const MOBILE_BREAKPOINT = 768

let mobile = $state(
  typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
)

let listening = false

function startListening() {
  if (listening || typeof window === 'undefined') return
  listening = true

  window.addEventListener('resize', () => {
    mobile = window.innerWidth < MOBILE_BREAKPOINT
  })
}

/** Get reactive mobile state. Auto-starts resize listener on first call. */
export function getIsMobile(): boolean {
  startListening()
  return mobile
}
