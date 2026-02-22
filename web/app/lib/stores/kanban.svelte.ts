/**
 * Kanban store — Svelte 5 runes
 *
 * Manages kanban board state: columns, cards, drag state, sorting, and data fetching.
 * Fetches from /api/gitea/board (live Gigi backend proxy).
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface KanbanLabel {
  id: number
  name: string
  color: string
}

export interface LinkedPR {
  repo: string
  number: number
  title: string
}

export interface LinkedChat {
  id: string
  topic: string
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
  linked_pr_details: LinkedPR[]
  linked_chats: number
  linked_chat_details: LinkedChat[]
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
  repos: string[]
}

export interface DragState {
  card: KanbanCard | null
  sourceColumnId: string | null
}

export type SortMode = 'default' | 'priority'

// ── State ─────────────────────────────────────────────────────────────

let columns = $state<KanbanColumn[]>([])
let orgName = $state('gigi')
let totalIssues = $state(0)
let repos = $state<string[]>([])
let loading = $state(false)
let error = $state<string | null>(null)
let dragState = $state<DragState>({ card: null, sourceColumnId: null })
let lastFetch = $state(0)
let sortMode = $state<SortMode>('default')

// ── Priority sorting ──────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = {
  'priority/critical': 0,
  'priority/high': 1,
  'priority/medium': 2,
  'priority/low': 3,
}

function getPriorityScore(card: KanbanCard): number {
  for (const label of card.labels) {
    if (label.name in PRIORITY_ORDER) return PRIORITY_ORDER[label.name]
  }
  return 99 // no priority = lowest
}

function sortCards(cards: KanbanCard[]): KanbanCard[] {
  if (sortMode !== 'priority') return cards
  return [...cards].sort((a, b) => getPriorityScore(a) - getPriorityScore(b))
}

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
    repos = data.repos ?? []
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

// ── Quick-create issue ────────────────────────────────────────────────

export async function createIssue(
  repo: string,
  title: string,
  body?: string,
  targetColumn?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/gitea/board/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, title, body, targetColumn }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    // Refresh board after creation
    await fetchBoard()
    return { ok: true }
  } catch (err) {
    const msg = (err as Error).message
    console.error('[kanban] Failed to create issue:', msg)
    error = `Failed to create issue: ${msg}`
    return { ok: false, error: msg }
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

// ── Sorting ───────────────────────────────────────────────────────────

export function getSortMode(): SortMode {
  return sortMode
}

export function setSortMode(mode: SortMode): void {
  sortMode = mode
}

export function toggleSortMode(): void {
  sortMode = sortMode === 'default' ? 'priority' : 'default'
}

// ── Getters ───────────────────────────────────────────────────────────

export function getColumns(): KanbanColumn[] {
  // Apply sorting to cards within each column
  return columns.map(col => ({
    ...col,
    cards: sortCards(col.cards),
  }))
}

export function getOrgName(): string {
  return orgName
}

export function getTotalIssues(): number {
  return totalIssues
}

export function getRepos(): string[] {
  return repos
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
