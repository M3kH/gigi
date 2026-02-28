/**
 * Thread Tree Enriched Data Tests (Chat List Redesign)
 *
 * Tests for the new preview, cost, and ref link functionality
 * added to ThreadTreeNode for the enriched sidebar display.
 *
 * Pure function tests — no database required.
 */

import assert from 'node:assert/strict'
import type {
  ThreadTreeNode,
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

// ─── ThreadTreeNode Enriched Fields ──────────────────────────────────

describe('ThreadTreeNode enriched fields', () => {
  it('includes last_event_preview', () => {
    const node = makeNode({
      last_event_preview: 'Let me help you fix that bug...',
    })
    assert.equal(node.last_event_preview, 'Let me help you fix that bug...')
  })

  it('includes usage_cost', () => {
    const node = makeNode({
      usage_cost: 0.42,
    })
    assert.equal(node.usage_cost, 0.42)
  })

  it('last_event_preview defaults to null', () => {
    const node = makeNode()
    assert.equal(node.last_event_preview, null)
  })

  it('usage_cost defaults to null', () => {
    const node = makeNode()
    assert.equal(node.usage_cost, null)
  })

  it('preserves enriched fields through tree building', () => {
    const flat: ThreadTreeNode[] = [
      makeNode({
        id: 'root',
        topic: 'Root',
        last_event_preview: 'Root preview text',
        usage_cost: 1.23,
      }),
      makeNode({
        id: 'child',
        topic: 'Child',
        parent_thread_id: 'root',
        last_event_preview: 'Child preview text',
        usage_cost: 0.45,
      }),
    ]

    // Build tree (same logic as getThreadTree)
    const nodeMap = new Map<string, ThreadTreeNode>()
    for (const t of flat) {
      nodeMap.set(t.id, { ...t, children: [] })
    }
    const roots: ThreadTreeNode[] = []
    for (const node of nodeMap.values()) {
      if (node.parent_thread_id && nodeMap.has(node.parent_thread_id)) {
        nodeMap.get(node.parent_thread_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    assert.equal(roots.length, 1)
    assert.equal(roots[0].last_event_preview, 'Root preview text')
    assert.equal(roots[0].usage_cost, 1.23)
    assert.equal(roots[0].children[0].last_event_preview, 'Child preview text')
    assert.equal(roots[0].children[0].usage_cost, 0.45)
  })
})

// ─── Display Name with Preview Fallback ──────────────────────────────

describe('Display name with preview fallback', () => {
  /**
   * Matches the displayName() logic in the new ThreadTree.svelte:
   * If name is generic/empty, fall back to preview text.
   */
  function displayName(node: Pick<ThreadTreeNode, 'display_name' | 'topic' | 'last_event_preview'>): string {
    const name = node.display_name || node.topic || ''
    if (!name || name === 'web' || name === 'telegram' || name === 'Untitled') {
      if (node.last_event_preview) {
        const stripped = node.last_event_preview.replace(/^\[Viewing [^\]]+\]\n?/, '').trim()
        const trimmed = stripped.slice(0, 50)
        return trimmed + (stripped.length > 50 ? '...' : '') || 'Untitled'
      }
      return 'Untitled'
    }
    return name
  }

  it('uses display_name when present', () => {
    assert.equal(
      displayName({ display_name: 'Auth System', topic: 'auth', last_event_preview: 'preview' }),
      'Auth System'
    )
  })

  it('falls back to topic when display_name is null', () => {
    assert.equal(
      displayName({ display_name: null, topic: 'My Topic', last_event_preview: null }),
      'My Topic'
    )
  })

  it('falls back to preview when both are generic', () => {
    assert.equal(
      displayName({ display_name: null, topic: 'web', last_event_preview: 'Help me implement auth' }),
      'Help me implement auth'
    )
  })

  it('truncates long previews at 50 chars', () => {
    const longPreview = 'A'.repeat(60)
    const result = displayName({ display_name: null, topic: null, last_event_preview: longPreview })
    assert.equal(result.length, 53) // 50 + '...'
    assert.ok(result.endsWith('...'))
  })

  it('strips [Viewing ...] prefix from preview', () => {
    const result = displayName({
      display_name: null,
      topic: 'Untitled',
      last_event_preview: '[Viewing issue idea/gigi#42: "Fix bug"]\nHelp me fix this',
    })
    assert.equal(result, 'Help me fix this')
  })

  it('returns "Untitled" when everything is null', () => {
    assert.equal(
      displayName({ display_name: null, topic: null, last_event_preview: null }),
      'Untitled'
    )
  })
})

// ─── Ref Label Rendering ─────────────────────────────────────────────

describe('Ref label rendering (clickable links)', () => {
  /**
   * Matches the refLabel() logic in the new ThreadTree.svelte
   */
  function refLabel(ref: ThreadRef): string {
    if (ref.ref_type === 'pr') return `PR#${ref.number}`
    if (ref.ref_type === 'issue') return `#${ref.number}`
    if (ref.ref_type === 'branch') return ref.ref || 'branch'
    return ref.ref_type
  }

  it('formats issue refs as #N', () => {
    const ref = makeRef({ ref_type: 'issue', number: 42 })
    assert.equal(refLabel(ref), '#42')
  })

  it('formats PR refs as PR#N', () => {
    const ref = makeRef({ ref_type: 'pr', number: 123 })
    assert.equal(refLabel(ref), 'PR#123')
  })

  it('formats branch refs with branch name', () => {
    const ref = makeRef({ ref_type: 'branch', number: null, ref: 'feat/my-feature' })
    assert.equal(refLabel(ref), 'feat/my-feature')
  })

  it('falls back to "branch" when ref name is null', () => {
    const ref = makeRef({ ref_type: 'branch', number: null, ref: null })
    assert.equal(refLabel(ref), 'branch')
  })

  it('uses ref_type for unknown types', () => {
    const ref = makeRef({ ref_type: 'commit' as any, number: null })
    assert.equal(refLabel(ref), 'commit')
  })
})

// ─── Cost Display Logic ──────────────────────────────────────────────

describe('Cost display logic', () => {
  /**
   * Matches the formatCost() utility function
   */
  function formatCost(usd: number | null | undefined): string | null {
    if (!usd) return null
    if (usd < 0.01) return '<$0.01'
    return '$' + usd.toFixed(2)
  }

  it('returns null for zero cost', () => {
    assert.equal(formatCost(0), null)
  })

  it('returns null for null cost', () => {
    assert.equal(formatCost(null), null)
  })

  it('returns <$0.01 for very small costs', () => {
    assert.equal(formatCost(0.005), '<$0.01')
  })

  it('formats normal costs with $ prefix', () => {
    assert.equal(formatCost(0.42), '$0.42')
  })

  it('formats larger costs correctly', () => {
    assert.equal(formatCost(12.50), '$12.50')
  })
})

// ─── Children Count & Expand/Collapse ────────────────────────────────

describe('Children count display', () => {
  it('shows correct child count for nodes with children', () => {
    const root = makeNode({
      id: 'root',
      children: [
        makeNode({ id: 'child-1' }),
        makeNode({ id: 'child-2' }),
        makeNode({ id: 'child-3' }),
      ],
    })
    assert.equal(root.children.length, 3)
  })

  it('expand/collapse state management', () => {
    const expanded = new Set<string>()

    // Initial: collapsed
    assert.equal(expanded.has('node-1'), false)

    // Expand
    expanded.add('node-1')
    assert.equal(expanded.has('node-1'), true)

    // Collapse
    expanded.delete('node-1')
    assert.equal(expanded.has('node-1'), false)
  })

  it('auto-expand nodes with children', () => {
    const tree = [
      makeNode({
        id: 'root',
        children: [
          makeNode({
            id: 'child-with-grandchildren',
            children: [makeNode({ id: 'grandchild' })],
          }),
          makeNode({ id: 'leaf-child' }),
        ],
      }),
    ]

    const expanded = new Set<string>()
    const autoExpand = (nodes: ThreadTreeNode[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          expanded.add(node.id)
          autoExpand(node.children)
        }
      }
    }
    autoExpand(tree)

    assert.ok(expanded.has('root'))
    assert.ok(expanded.has('child-with-grandchildren'))
    assert.equal(expanded.has('leaf-child'), false)
    assert.equal(expanded.has('grandchild'), false)
  })
})

// ─── Full Enriched Node Shape ────────────────────────────────────────

describe('Full enriched node with all new fields', () => {
  it('constructs a complete enriched node', () => {
    const node = makeNode({
      id: 'enriched-thread',
      topic: 'Implement auth system',
      kind: 'task',
      display_name: 'Auth System',
      status: 'active',
      updated_at: '2026-02-28T10:30:00Z',
      last_event_preview: 'Working on JWT middleware implementation...',
      usage_cost: 1.23,
      refs: [
        makeRef({ ref_type: 'issue', number: 42, url: 'https://gitea.local/idea/gigi/issues/42' }),
        makeRef({ ref_type: 'pr', number: 99, url: 'https://gitea.local/idea/gigi/pulls/99' }),
      ],
      children: [
        makeNode({
          id: 'subtask-1',
          display_name: 'JWT Middleware',
          status: 'stopped',
          last_event_preview: 'JWT middleware is now complete',
          usage_cost: 0.45,
        }),
      ],
    })

    // Verify all enriched fields
    assert.equal(node.display_name, 'Auth System')
    assert.equal(node.last_event_preview, 'Working on JWT middleware implementation...')
    assert.equal(node.usage_cost, 1.23)
    assert.equal(node.refs.length, 2)
    assert.equal(node.refs[0].ref_type, 'issue')
    assert.equal(node.refs[0].url, 'https://gitea.local/idea/gigi/issues/42')
    assert.equal(node.refs[1].ref_type, 'pr')
    assert.equal(node.children.length, 1)
    assert.equal(node.children[0].display_name, 'JWT Middleware')
    assert.equal(node.children[0].last_event_preview, 'JWT middleware is now complete')
    assert.equal(node.children[0].usage_cost, 0.45)
  })
})
