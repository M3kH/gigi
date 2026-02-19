/**
 * Theme store — Svelte 5 runes
 *
 * Manages dark/light mode with:
 * - localStorage persistence (key: 'gigi:theme')
 * - System preference detection as initial default
 * - Applies data-theme + Shoelace class on <html>
 * - Exposes reactive getter for components
 */

const STORAGE_KEY = 'gigi:theme'

export type Theme = 'dark' | 'light'

/** Read stored preference, fall back to system preference */
function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    if (stored === 'dark' || stored === 'light') return stored
  } catch { /* storage unavailable */ }

  // System preference
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

/** Apply theme to the <html> element (data-theme + Shoelace class) */
function applyToDOM(theme: Theme) {
  const html = document.documentElement
  html.setAttribute('data-theme', theme)
  html.classList.remove('sl-theme-dark', 'sl-theme-light')
  html.classList.add(theme === 'dark' ? 'sl-theme-dark' : 'sl-theme-light')
}

// ─── Reactive state ──────────────────────────────────────────────────

let current = $state<Theme>(resolveInitialTheme())

// Apply on module load (before first paint if possible)
if (typeof document !== 'undefined') {
  applyToDOM(current)
}

export function getTheme(): Theme {
  return current
}

export function setTheme(theme: Theme) {
  current = theme
  applyToDOM(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch { /* storage unavailable */ }
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

/** Listen for OS-level preference changes */
export function watchSystemPreference() {
  if (typeof window === 'undefined') return

  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => {
    // Only auto-switch if user hasn't explicitly chosen
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      setTheme(e.matches ? 'dark' : 'light')
    }
  }
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}
