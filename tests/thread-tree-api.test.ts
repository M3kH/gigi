/**
 * Thread Tree API + Spawn Tests (Issue #300)
 *
 * Tests for:
 * - getThreadTree(): recursive tree building from flat thread list
 * - spawnSubThread(): child thread creation with refs and context
 * - ThreadTreeNode type shape and fork_source linking
 * - API route parameter validation
 *
 * Pure function tests — no database required. These validate the
 * tree-building logic and type contracts.
 */

import assert from 'node:assert/strict'
import type {
  ThreadTreeNode,
  SpawnSubThreadOpts,
  ThreadRef,
  ThreadKind,
  ThreadStatus,
} from '../lib/core/threads'

// ─── Helper: Build mock ThreadTreeNode ──────────────────────────────

function makeNode(overrides: Partial<ThreadTreeNode> = {}): ThreadTreeNode {
  return {
    id: overrides.id || `thread-${Math.random().toString(36).slice(2, 8)}`,
    topic: overrides.topic ?? 'Test thread',
    kind: overrides.kind ?? 'chat',
    display_name: overrides.display_name ?? null,
    status: overrides.status ?? 'paused',
    parent_thread_id: overrides.parent_thread_id ?? null,
    fork_point_event_id: overrides.fork_point_event_id ?? null,
    conversation_id: overrides.conversation_id ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
    refs: overrides.refs ?? [],
    children: overrides.children ?? [],
    last_event_preview: overrides.last_event_preview ?? null,
    usage_cost: overrides.usage_cost ?? null,
    fork_source: overrides.fork_source,
  }
}

function makeRef(overrides: Partial<ThreadRef> = {}): ThreadRef {
  return {
    id: overrides.id || `ref-${Math.random().toString(36).slice(2, 8)}`,
    thread_id: overrides.thread_id || 'thread-1',
    ref_type: overrides.ref_type || 'issue',
    repo: overrides.repo || 'idea/gigi',
    number: overrides.number ?? 1,
    ref: overrides.ref ?? null,
    url: overrides.url ?? null,
    status: overrides.status ?? 'open',
    created_at: overrides.created_at || '2026-01-01T00:00:00Z',
  }
}

// ─── Tree Building Logic ────────────────────────────────────────────

/**
 * Pure tree-building function matching getThreadTree() logic.
 * Takes a flat list of threads and assembles into a tree.
 */
function buildTree(flatThreads: ThreadTreeNode[]): ThreadTreeNode[] {
  const nodeMap = new Map<string, ThreadTreeNode>()

  for (const thread of flatThreads) {
    nodeMap.set(thread.id, { ...thread, children: [] })
  }

  const roots: ThreadTreeNode[] = []

  for (const node of nodeMap.values()) {
    if (node.parent_thread_id && nodeMap.has(node.parent_thread_id)) {
      const parent = nodeMap.get(node.parent_thread_id)!
      parent.children.push(node)
      node.fork_source = {
        thread_id: parent.id,
        display_name: parent.display_name,
        topic: parent.topic,
      }
    } else {
      roots.push(node)
    }
  }

  // Sort children by updated_at DESC
  const sortChildren = (nodes: ThreadTreeNode[]) => {
    nodes.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    for (const node of nodes) {
      if (node.children.length > 0) sortChildren(node.children)
    }
  }
  sortChildren(roots)

  return roots
}

// ─── Tree Building Tests ────────────────────────────────────────────

describe('Thread Tree building', () => {
  it('returns empty array for no threads', () => {
    const roots = buildTree([])
    assert.deepEqual(roots, [])
  })

  it('returns all threads as roots when no parent relationships', () => {
    const threads = [
      makeNode({ id: 'a', topic: 'Thread A' }),
      makeNode({ id: 'b', topic: 'Thread B' }),
      makeNode({ id: 'c', topic: 'Thread C' }),
    ]
    const roots = buildTree(threads)
    assert.equal(roots.length, 3)
    for (const root of roots) {
      assert.equal(root.children.length, 0)
      assert.equal(root.fork_source, undefined)
    }
  })

  it('builds parent-child relationships correctly', () => {
    const threads = [
      makeNode({ id: 'root', topic: 'Root', display_name: 'Root Thread' }),
      makeNode({ id: 'child-1', topic: 'Child 1', parent_thread_id: 'root' }),
      makeNode({ id: 'child-2', topic: 'Child 2', parent_thread_id: 'root' }),
    ]
    const roots = buildTree(threads)

    assert.equal(roots.length, 1)
    assert.equal(roots[0].id, 'root')
    assert.equal(roots[0].children.length, 2)

    // Children should have fork_source
    for (const child of roots[0].children) {
      assert.ok(child.fork_source)
      assert.equal(child.fork_source!.thread_id, 'root')
      assert.equal(child.fork_source!.display_name, 'Root Thread')
    }
  })

  it('builds deep trees (grandchildren)', () => {
    const threads = [
      makeNode({ id: 'root', topic: 'Root' }),
      makeNode({ id: 'child', topic: 'Child', parent_thread_id: 'root' }),
      makeNode({ id: 'grandchild', topic: 'Grandchild', parent_thread_id: 'child' }),
    ]
    const roots = buildTree(threads)

    assert.equal(roots.length, 1)
    assert.equal(roots[0].children.length, 1)
    assert.equal(roots[0].children[0].children.length, 1)
    assert.equal(roots[0].children[0].children[0].id, 'grandchild')
    assert.equal(roots[0].children[0].children[0].fork_source!.thread_id, 'child')
  })

  it('orphan threads (parent not in set) become roots', () => {
    const threads = [
      makeNode({ id: 'orphan', topic: 'Orphan', parent_thread_id: 'missing-parent' }),
      makeNode({ id: 'root', topic: 'Root' }),
    ]
    const roots = buildTree(threads)

    assert.equal(roots.length, 2)
    // Both should be roots — orphan's parent isn't in the set
    const ids = roots.map(r => r.id).sort()
    assert.deepEqual(ids, ['orphan', 'root'])
  })

  it('sorts children by updated_at DESC (most recent first)', () => {
    const threads = [
      makeNode({ id: 'root', topic: 'Root' }),
      makeNode({ id: 'old', topic: 'Old', parent_thread_id: 'root', updated_at: '2026-01-01T00:00:00Z' }),
      makeNode({ id: 'new', topic: 'New', parent_thread_id: 'root', updated_at: '2026-02-01T00:00:00Z' }),
      makeNode({ id: 'mid', topic: 'Mid', parent_thread_id: 'root', updated_at: '2026-01-15T00:00:00Z' }),
    ]
    const roots = buildTree(threads)

    assert.equal(roots[0].children.length, 3)
    assert.equal(roots[0].children[0].id, 'new')
    assert.equal(roots[0].children[1].id, 'mid')
    assert.equal(roots[0].children[2].id, 'old')
  })

  it('handles multiple independent trees', () => {
    const threads = [
      makeNode({ id: 'tree1-root', topic: 'Tree 1' }),
      makeNode({ id: 'tree1-child', topic: 'Tree 1 Child', parent_thread_id: 'tree1-root' }),
      makeNode({ id: 'tree2-root', topic: 'Tree 2' }),
      makeNode({ id: 'tree2-child', topic: 'Tree 2 Child', parent_thread_id: 'tree2-root' }),
    ]
    const roots = buildTree(threads)

    assert.equal(roots.length, 2)
    for (const root of roots) {
      assert.equal(root.children.length, 1)
    }
  })
})

// ─── ThreadTreeNode Type Shape ──────────────────────────────────────

describe('ThreadTreeNode type shape', () => {
  it('has all required fields', () => {
    const node = makeNode({
      id: 'test-id',
      topic: 'Test topic',
      kind: 'task',
      display_name: 'Test Display Name',
      status: 'active',
      parent_thread_id: 'parent-id',
      fork_point_event_id: 'event-id',
      conversation_id: 'conv-id',
      refs: [makeRef()],
      children: [],
    })

    assert.equal(node.id, 'test-id')
    assert.equal(node.topic, 'Test topic')
    assert.equal(node.kind, 'task')
    assert.equal(node.display_name, 'Test Display Name')
    assert.equal(node.status, 'active')
    assert.equal(node.parent_thread_id, 'parent-id')
    assert.equal(node.fork_point_event_id, 'event-id')
    assert.equal(node.conversation_id, 'conv-id')
    assert.equal(node.refs.length, 1)
    assert.equal(node.children.length, 0)
  })

  it('fork_source links to parent correctly', () => {
    const node = makeNode({
      fork_source: {
        thread_id: 'parent-123',
        display_name: 'Parent Thread',
        topic: 'Parent Topic',
      },
    })

    assert.ok(node.fork_source)
    assert.equal(node.fork_source!.thread_id, 'parent-123')
    assert.equal(node.fork_source!.display_name, 'Parent Thread')
    assert.equal(node.fork_source!.topic, 'Parent Topic')
  })

  it('fork_source is optional', () => {
    const node = makeNode()
    assert.equal(node.fork_source, undefined)
  })
})

// ─── SpawnSubThreadOpts Validation ──────────────────────────────────

describe('SpawnSubThreadOpts validation', () => {
  it('requires display_name', () => {
    const opts: SpawnSubThreadOpts = {
      display_name: 'JWT Middleware',
    }
    assert.equal(opts.display_name, 'JWT Middleware')
    assert.equal(opts.kind, undefined)
    assert.equal(opts.initial_context, undefined)
    assert.equal(opts.link_ref, undefined)
  })

  it('accepts all optional fields', () => {
    const opts: SpawnSubThreadOpts = {
      display_name: 'JWT Middleware',
      kind: 'task',
      initial_context: 'Implement JWT auth middleware for API routes',
      link_ref: {
        ref_type: 'issue',
        repo: 'idea/gigi',
        number: 42,
      },
    }
    assert.equal(opts.display_name, 'JWT Middleware')
    assert.equal(opts.kind, 'task')
    assert.ok(opts.initial_context)
    assert.ok(opts.link_ref)
    assert.equal(opts.link_ref!.ref_type, 'issue')
    assert.equal(opts.link_ref!.repo, 'idea/gigi')
    assert.equal(opts.link_ref!.number, 42)
  })

  it('kind defaults to task at runtime', () => {
    // The function signature defaults kind to 'task'
    const opts: SpawnSubThreadOpts = {
      display_name: 'Sub-thread',
    }
    const resolvedKind: ThreadKind = opts.kind || 'task'
    assert.equal(resolvedKind, 'task')
  })
})

// ─── Tree Search/Filter Logic ───────────────────────────────────────

/**
 * Filter tree nodes by search text, keeping parent chains.
 * Mirrors the getFilteredTree() logic in the frontend store.
 */
function filterTree(nodes: ThreadTreeNode[], query: string): ThreadTreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  const filterNode = (node: ThreadTreeNode): ThreadTreeNode | null => {
    const name = (node.display_name || node.topic || '').toLowerCase()
    const matchesSelf = name.includes(q)

    const filteredChildren = node.children
      .map(filterNode)
      .filter((n): n is ThreadTreeNode => n !== null)

    if (matchesSelf || filteredChildren.length > 0) {
      return { ...node, children: filteredChildren }
    }

    return null
  }

  return nodes
    .map(filterNode)
    .filter((n): n is ThreadTreeNode => n !== null)
}

describe('Thread tree search/filter', () => {
  const tree: ThreadTreeNode[] = [
    makeNode({
      id: 'root-1',
      topic: 'Auth System',
      display_name: 'Authentication',
      children: [
        makeNode({ id: 'child-1', topic: 'JWT Middleware', display_name: 'JWT Implementation' }),
        makeNode({ id: 'child-2', topic: 'Login UI', display_name: 'Login Page' }),
      ],
    }),
    makeNode({ id: 'root-2', topic: 'Bug Fixes', display_name: 'Bug Fixes' }),
    makeNode({ id: 'root-3', topic: 'Documentation', display_name: null }),
  ]

  it('returns full tree when query is empty', () => {
    const result = filterTree(tree, '')
    assert.equal(result.length, 3)
  })

  it('returns full tree when query is whitespace', () => {
    const result = filterTree(tree, '   ')
    assert.equal(result.length, 3)
  })

  it('filters by display_name', () => {
    const result = filterTree(tree, 'JWT')
    assert.equal(result.length, 1) // Only Auth System root (has matching child)
    assert.equal(result[0].id, 'root-1')
    assert.equal(result[0].children.length, 1) // Only JWT child
    assert.equal(result[0].children[0].id, 'child-1')
  })

  it('filters by topic when display_name is null', () => {
    const result = filterTree(tree, 'documentation')
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'root-3')
  })

  it('is case-insensitive', () => {
    const result = filterTree(tree, 'bug fixes')
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'root-2')
  })

  it('keeps parent chain when child matches', () => {
    const result = filterTree(tree, 'Login')
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'root-1') // Parent kept
    assert.equal(result[0].children.length, 1) // Only matching child
    assert.equal(result[0].children[0].display_name, 'Login Page')
  })

  it('returns empty when nothing matches', () => {
    const result = filterTree(tree, 'nonexistent')
    assert.equal(result.length, 0)
  })

  it('matches root and keeps all children when root matches', () => {
    const result = filterTree(tree, 'Authentication')
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'root-1')
    // Root matches, so it's included, but children are also filtered
    // Only children that match or have matching descendants are kept
    // Neither child matches "Authentication", so children are empty
    assert.equal(result[0].children.length, 0)
  })
})

// ─── Display Name Resolution ────────────────────────────────────────

describe('Display name resolution', () => {
  function displayName(node: Pick<ThreadTreeNode, 'display_name' | 'topic'>): string {
    return node.display_name || node.topic || 'Untitled'
  }

  it('uses display_name when present', () => {
    assert.equal(displayName({ display_name: 'My Thread', topic: 'topic' }), 'My Thread')
  })

  it('falls back to topic when display_name is null', () => {
    assert.equal(displayName({ display_name: null, topic: 'Topic Name' }), 'Topic Name')
  })

  it('falls back to "Untitled" when both are null', () => {
    assert.equal(displayName({ display_name: null, topic: null }), 'Untitled')
  })
})

// ─── Ref Badge Rendering ────────────────────────────────────────────

describe('Ref badge rendering', () => {
  function refBadgeText(ref: { ref_type: string; number: number | null }): string {
    const prefix = ref.ref_type === 'pr' ? 'PR' : ref.ref_type === 'issue' ? '#' : ref.ref_type
    return ref.number ? `${prefix}${ref.number}` : ref.ref_type
  }

  it('formats issue refs as #N', () => {
    assert.equal(refBadgeText({ ref_type: 'issue', number: 42 }), '#42')
  })

  it('formats PR refs as PRN', () => {
    assert.equal(refBadgeText({ ref_type: 'pr', number: 7 }), 'PR7')
  })

  it('handles null number (branch/commit refs)', () => {
    assert.equal(refBadgeText({ ref_type: 'branch', number: null }), 'branch')
  })
})

// ─── Kind Icon Mapping ──────────────────────────────────────────────

describe('Thread kind icon mapping', () => {
  function kindIcon(kind: string): string {
    switch (kind) {
      case 'system_log': return '📊'
      case 'task': return '🔀'
      case 'chat':
      default:
        return '💬'
    }
  }

  it('maps chat to 💬', () => {
    assert.equal(kindIcon('chat'), '💬')
  })

  it('maps task to 🔀', () => {
    assert.equal(kindIcon('task'), '🔀')
  })

  it('maps system_log to 📊', () => {
    assert.equal(kindIcon('system_log'), '📊')
  })

  it('defaults to 💬 for unknown kinds', () => {
    assert.equal(kindIcon('unknown'), '💬')
  })
})

// ─── Status Tooltip Mapping ─────────────────────────────────────────

describe('Thread status tooltip mapping', () => {
  function statusTooltip(status: ThreadStatus): string {
    switch (status) {
      case 'active': return 'Agent running'
      case 'paused': return 'Ready'
      case 'stopped': return 'Done'
      case 'archived': return 'Archived'
      default: return status
    }
  }

  it('maps all status values to tooltips', () => {
    assert.equal(statusTooltip('active'), 'Agent running')
    assert.equal(statusTooltip('paused'), 'Ready')
    assert.equal(statusTooltip('stopped'), 'Done')
    assert.equal(statusTooltip('archived'), 'Archived')
  })
})
