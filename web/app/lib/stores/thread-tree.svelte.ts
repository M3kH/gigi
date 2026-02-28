/**
 * Thread Tree store — Svelte 5 runes for hierarchical thread navigation
 *
 * Manages the recursive thread tree that replaces the flat conversation sidebar.
 * Fetches tree from GET /api/threads/tree and maintains expand/collapse state.
 */

import type { ThreadTreeNode, ThreadKind } from '$lib/types/chat'

// ── State ─────────────────────────────────────────────────────────────

let tree = $state<ThreadTreeNode[]>([])
let selectedThreadId = $state<string | null>(null)
let expandedNodes = $state<Set<string>>(new Set())
let loading = $state(false)
let error = $state<string | null>(null)
let searchFilter = $state('')

// ── REST helpers ──────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts)
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json()
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Load the full thread tree from the API.
 */
export async function loadTree(): Promise<void> {
  loading = true
  error = null
  try {
    const data = await apiFetch<{ roots: ThreadTreeNode[] }>('/api/threads/tree')
    tree = data.roots

    // Auto-expand nodes that have children
    const newExpanded = new Set(expandedNodes)
    const autoExpand = (nodes: ThreadTreeNode[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          newExpanded.add(node.id)
          autoExpand(node.children)
        }
      }
    }
    autoExpand(tree)
    expandedNodes = newExpanded
  } catch (err) {
    console.error('[thread-tree] Failed to load tree:', err)
    error = (err as Error).message
  } finally {
    loading = false
  }
}

/**
 * Select a thread by ID (loads it in the chat view).
 */
export function selectThread(id: string | null): void {
  selectedThreadId = id
}

/**
 * Toggle expand/collapse of a tree node.
 */
export function toggleExpand(id: string): void {
  const next = new Set(expandedNodes)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expandedNodes = next
}

/**
 * Expand a specific node (used for auto-expansion).
 */
export function expandNode(id: string): void {
  const next = new Set(expandedNodes)
  next.add(id)
  expandedNodes = next
}

/**
 * Collapse all nodes.
 */
export function collapseAll(): void {
  expandedNodes = new Set()
}

/**
 * Set the search/filter text.
 */
export function setTreeFilter(query: string): void {
  searchFilter = query
}

/**
 * Spawn a sub-thread under a parent.
 */
export async function spawnSubThread(
  parentId: string,
  opts: {
    display_name: string
    kind?: ThreadKind
    initial_context?: string
    link_ref?: { ref_type: string; repo: string; number?: number }
  }
): Promise<{ thread: ThreadTreeNode; conversation_id: string | null } | null> {
  try {
    const result = await apiFetch<{ thread: ThreadTreeNode; conversation_id: string | null }>(
      `/api/threads/${parentId}/spawn`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      }
    )
    // Reload tree to reflect the new sub-thread
    await loadTree()
    return result
  } catch (err) {
    console.error('[thread-tree] Spawn failed:', err)
    return null
  }
}

// ── Getters (reactive) ────────────────────────────────────────────────

export function getTree(): ThreadTreeNode[] {
  return tree
}

export function getSelectedThreadId(): string | null {
  return selectedThreadId
}

export function isExpanded(id: string): boolean {
  return expandedNodes.has(id)
}

export function isLoading(): boolean {
  return loading
}

export function getError(): string | null {
  return error
}

export function getTreeFilter(): string {
  return searchFilter
}

/**
 * Get the filtered tree — filters nodes by search text, keeping parent chains.
 * Returns the full tree when no filter is active.
 */
export function getFilteredTree(): ThreadTreeNode[] {
  const query = searchFilter.trim().toLowerCase()
  if (!query) return tree

  const filterNode = (node: ThreadTreeNode): ThreadTreeNode | null => {
    const name = (node.display_name || node.topic || '').toLowerCase()
    const matchesSelf = name.includes(query)

    // Recursively filter children
    const filteredChildren = node.children
      .map(filterNode)
      .filter((n): n is ThreadTreeNode => n !== null)

    // Include this node if it matches or has matching descendants
    if (matchesSelf || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren }
    }

    return null
  }

  return tree
    .map(filterNode)
    .filter((n): n is ThreadTreeNode => n !== null)
}

/**
 * Find a node by its ID anywhere in the tree.
 */
export function findNode(id: string): ThreadTreeNode | null {
  const search = (nodes: ThreadTreeNode[]): ThreadTreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node
      const found = search(node.children)
      if (found) return found
    }
    return null
  }
  return search(tree)
}

/**
 * Find a node by its conversation_id (for backward compat with chat store).
 */
export function findNodeByConversationId(convId: string): ThreadTreeNode | null {
  const search = (nodes: ThreadTreeNode[]): ThreadTreeNode | null => {
    for (const node of nodes) {
      if (node.conversation_id === convId) return node
      const found = search(node.children)
      if (found) return found
    }
    return null
  }
  return search(tree)
}
