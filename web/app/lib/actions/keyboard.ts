/**
 * Keyboard shortcut registry
 *
 * Centralized keyboard shortcut handling. Register shortcuts with
 * modifier keys and callbacks, attach/detach via Svelte lifecycle.
 */

export interface Shortcut {
  /** Key value (e.g. 'b', 'k', 'j', 'Escape') */
  key: string
  /** Require Ctrl/Cmd modifier */
  ctrl?: boolean
  /** Callback when shortcut fires */
  handler: (e: KeyboardEvent) => void
}

/**
 * Create a keyboard shortcut listener
 *
 * Returns attach/detach functions for use in onMount/onDestroy.
 */
export function createKeyboardShortcuts(shortcuts: Shortcut[]) {
  function handleKeydown(e: KeyboardEvent) {
    for (const shortcut of shortcuts) {
      const ctrlMatch = shortcut.ctrl
        ? (e.ctrlKey || e.metaKey)
        : true

      if (ctrlMatch && e.key === shortcut.key) {
        e.preventDefault()
        shortcut.handler(e)
        return
      }
    }
  }

  return {
    attach() {
      window.addEventListener('keydown', handleKeydown)
    },
    detach() {
      window.removeEventListener('keydown', handleKeydown)
    },
  }
}
