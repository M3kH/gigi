/**
 * Panel state store — Svelte 5 runes
 *
 * Manages which panels are visible and their display states.
 * Persists to localStorage for cross-session consistency.
 */

const STORAGE_KEY = 'gigi:panel-state'

export type PanelState = 'full' | 'compact' | 'hidden'

export type PanelId = 'kanban' | 'sidebar' | 'filters' | 'chatOverlay'

type PanelStates = Record<PanelId, PanelState>

const DEFAULT_STATES: PanelStates = {
  kanban: 'hidden',
  sidebar: 'full',
  filters: 'compact',
  chatOverlay: 'full',
}

function loadFromStorage(): PanelStates {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PanelStates>
      return { ...DEFAULT_STATES, ...parsed }
    }
  } catch {
    // Corrupted storage — use defaults
  }
  return { ...DEFAULT_STATES }
}

function saveToStorage(states: PanelStates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states))
  } catch {
    // Storage full or unavailable
  }
}

// ─── Reactive state ──────────────────────────────────────────────────

let panels = $state<PanelStates>(loadFromStorage())

/** Cycle: full → compact → hidden → full */
const CYCLE: PanelState[] = ['full', 'compact', 'hidden']

export function getPanelState(id: PanelId): PanelState {
  return panels[id]
}

export function setPanelState(id: PanelId, state: PanelState) {
  panels = { ...panels, [id]: state }
  saveToStorage(panels)
}

export function togglePanel(id: PanelId) {
  const current = panels[id]
  const idx = CYCLE.indexOf(current)
  const next = CYCLE[(idx + 1) % CYCLE.length]
  setPanelState(id, next)
}

export function isMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768
}

export function getAllPanels(): PanelStates {
  return panels
}
