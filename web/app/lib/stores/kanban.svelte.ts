/**
 * Kanban store — Svelte 5 runes
 *
 * Manages kanban board state: columns, cards, drag state, and data fetching.
 * Fetches from /api/gitea/board (live Gigi backend proxy).
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface KanbanLabel {
  id: number
  name: string
  color: string
}

export interface KanbanCard {
  id: number
  number: number
  title: string
  repo: string
  labels: KanbanLabel[]
  assignee: { login: string; avatar_url: string } | null
  milestone: { title: string } | null
  comments: number
  linked_prs: number
  linked_chats: number
  created_at?: string
  updated_at?: string
  html_url: string
}

export interface KanbanColumn {
  id: string
  title: string
  status: string | null
  cards: KanbanCard[]
}

export interface BoardData {
  org: string
  columns: KanbanColumn[]
  totalIssues: number
}

export interface DragState {
  card: KanbanCard | null
  sourceColumnId: string | null
}

// ── State ─────────────────────────────────────────────────────────────

let columns = $state<KanbanColumn[]>([])
let orgName = $state('gigi')
let totalIssues = $state(0)
let loading = $state(false)
let error = $state<string | null>(null)
let dragState = $state<DragState>({ card: null, sourceColumnId: null })
let lastFetch = $state(0)

// ── Data Fetching ─────────────────────────────────────────────────────

export async function fetchBoard(): Promise<void> {
  loading = true
  error = null
  try {
    const res = await fetch('/api/gitea/board')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: BoardData = await res.json()
    // Filter out Done column — done issues are never visible on the board
    columns = data.columns.filter(col => col.id !== 'done')
    orgName = data.org
    totalIssues = data.totalIssues
    lastFetch = Date.now()
  } catch (err) {
    error = (err as Error).message
    console.error('[kanban] Failed to fetch board:', err)
  } finally {
    loading = false
  }
}

export async function moveCard(
  card: KanbanCard,
  sourceColumnId: string,
  targetColumnId: string,
): Promise<void> {
  if (sourceColumnId === targetColumnId) return

  // Optimistic update: move card in local state immediately
  const prevColumns = columns.map(col => ({ ...col, cards: [...col.cards] }))

  columns = columns.map((col) => {
    if (col.id === sourceColumnId) {
      return { ...col, cards: col.cards.filter((c) => c.id !== card.id) }
    }
    if (col.id === targetColumnId) {
      return { ...col, cards: [card, ...col.cards] }
    }
    return col
  })

  // Persist to server
  try {
    const res = await fetch('/api/gitea/board/move', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: orgName,
        repo: card.repo,
        issueNumber: card.number,
        targetColumn: targetColumnId,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    // Rollback on failure
    console.error('[kanban] Failed to move card:', err)
    columns = prevColumns
    error = `Failed to move card: ${(err as Error).message}`
  }
}

// ── Drag & Drop ───────────────────────────────────────────────────────

export function startDrag(card: KanbanCard, sourceColumnId: string): void {
  dragState = { card, sourceColumnId }
}

export function endDrag(): void {
  dragState = { card: null, sourceColumnId: null }
}

export function getDragState(): DragState {
  return dragState
}

// ── Getters ───────────────────────────────────────────────────────────

export function getColumns(): KanbanColumn[] {
  return columns
}

export function getOrgName(): string {
  return orgName
}

export function getTotalIssues(): number {
  return totalIssues
}

export function isLoading(): boolean {
  return loading
}

export function getError(): string | null {
  return error
}

export function getLastFetch(): number {
  return lastFetch
}

/** Check if data is stale (> 2 minutes old) */
export function isStale(): boolean {
  return Date.now() - lastFetch > 2 * 60 * 1000
}
