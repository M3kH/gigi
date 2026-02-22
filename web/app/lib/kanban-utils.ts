/**
 * Kanban utilities — pure functions for sorting, filtering, and scoring.
 *
 * Extracted from the Svelte store so they can be tested in Node.js
 * without requiring Svelte compilation.
 */

import type { KanbanCard, KanbanColumn } from './stores/kanban.svelte'

// ── Priority ──────────────────────────────────────────────────────────

export const PRIORITY_ORDER: Record<string, number> = {
  'priority/critical': 0,
  'priority/high': 1,
  'priority/medium': 2,
  'priority/low': 3,
}

/** Returns a numeric score for a card's priority (lower = higher priority). */
export function getPriorityScore(card: KanbanCard): number {
  for (const label of card.labels) {
    if (label.name in PRIORITY_ORDER) return PRIORITY_ORDER[label.name]
  }
  return 99 // no priority label = lowest
}

/** Sort cards by priority label. Returns a new array (does not mutate). */
export function sortCardsByPriority(cards: KanbanCard[]): KanbanCard[] {
  return [...cards].sort((a, b) => getPriorityScore(a) - getPriorityScore(b))
}

/** Apply priority sort to all columns (returns new column objects). */
export function sortColumnCards(
  columns: KanbanColumn[],
  mode: 'default' | 'priority',
): KanbanColumn[] {
  if (mode !== 'priority') return columns
  return columns.map(col => ({
    ...col,
    cards: sortCardsByPriority(col.cards),
  }))
}
