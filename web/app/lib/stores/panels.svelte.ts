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
  kanban: 'compact',
  sidebar: 'full',
  filters: 'compact',
  chatOverlay: 'compact',
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

/** Default cycle: full → compact → hidden → full */
const CYCLE: PanelState[] = ['full', 'compact', 'hidden']

/** Sidebar only has two states: full <-> hidden */
const SIDEBAR_CYCLE: PanelState[] = ['full', 'hidden']

export function getPanelState(id: PanelId): PanelState {
  return panels[id]
}

export function setPanelState(id: PanelId, state: PanelState) {
  panels = { ...panels, [id]: state }
  saveToStorage(panels)
}

export function togglePanel(id: PanelId) {
  const cycle = id === 'sidebar' ? SIDEBAR_CYCLE : CYCLE
  const current = panels[id]
  const idx = cycle.indexOf(current)
  const next = cycle[(idx + 1) % cycle.length]
  setPanelState(id, next)
}

export function isMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768
}

export function getAllPanels(): PanelStates {
  return panels
}

// ─── Persisted panel sizes ────────────────────────────────────────────

const SIZES_KEY = 'gigi:panel-sizes'

interface PanelSizes {
  kanbanHeight: number
  chatHeight: number
  chatWidth: number
}

const DEFAULT_SIZES: PanelSizes = {
  kanbanHeight: 200,
  chatHeight: 300,
  chatWidth: 420,
}

function loadSizes(): PanelSizes {
  try {
    const stored = localStorage.getItem(SIZES_KEY)
    if (stored) return { ...DEFAULT_SIZES, ...JSON.parse(stored) }
  } catch { /* ignore */ }
  return { ...DEFAULT_SIZES }
}

function saveSizes(sizes: PanelSizes) {
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
  } catch { /* ignore */ }
}

let sizes = $state<PanelSizes>(loadSizes())

export function getKanbanHeight(): number {
  return sizes.kanbanHeight
}

export function setKanbanHeight(h: number) {
  sizes = { ...sizes, kanbanHeight: Math.max(120, Math.min(h, window.innerHeight * 0.6)) }
  saveSizes(sizes)
}

export function getChatHeight(): number {
  return sizes.chatHeight
}

export function setChatHeight(h: number) {
  sizes = { ...sizes, chatHeight: Math.max(180, Math.min(h, window.innerHeight * 0.8)) }
  saveSizes(sizes)
}

export function getChatWidth(): number {
  return sizes.chatWidth
}

export function setChatWidth(w: number) {
  sizes = { ...sizes, chatWidth: Math.max(280, Math.min(w, window.innerWidth * 0.6)) }
  saveSizes(sizes)
}
