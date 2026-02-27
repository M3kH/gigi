/**
 * Thread Tree Types — Phase 1 Schema Tests (Issue #298)
 *
 * Pure function tests for the new thread kind, display_name,
 * sort_order, and event_kind types. No database required.
 */

import assert from 'node:assert/strict'
import type {
  Thread,
  ThreadKind,
  ThreadEventKind,
  CreateThreadOpts,
  AddThreadEventOpts,
  ThreadListFilters,
  ThreadEventFilters,
} from '../lib/core/threads'

// ─── ThreadKind Type Tests ──────────────────────────────────────────

describe('ThreadKind type values', () => {
  const validKinds: ThreadKind[] = ['chat', 'system_log', 'task']

  it('accepts all valid kind values', () => {
    for (const kind of validKinds) {
      const opts: CreateThreadOpts = { kind }
      assert.equal(opts.kind, kind)
    }
  })

  it('kind defaults are correct in interface', () => {
    // CreateThreadOpts.kind is optional, defaulting to 'chat' at runtime
    const opts: CreateThreadOpts = {}
    assert.equal(opts.kind, undefined)
  })
})

// ─── ThreadEventKind Type Tests ─────────────────────────────────────

describe('ThreadEventKind type values', () => {
  const validEventKinds: ThreadEventKind[] = ['message', 'link', 'note', 'event']

  it('accepts all valid event_kind values', () => {
    for (const eventKind of validEventKinds) {
      const opts: AddThreadEventOpts = {
        channel: 'web',
        direction: 'inbound',
        actor: 'user',
        content: 'test',
        event_kind: eventKind,
      }
      assert.equal(opts.event_kind, eventKind)
    }
  })

  it('event_kind is optional (defaults to "message" at runtime)', () => {
    const opts: AddThreadEventOpts = {
      channel: 'web',
      direction: 'inbound',
      actor: 'user',
      content: 'test',
    }
    assert.equal(opts.event_kind, undefined)
  })
})

// ─── Thread Interface Shape ─────────────────────────────────────────

describe('Thread interface with new fields', () => {
  it('includes kind, display_name, and sort_order', () => {
    const thread: Thread = {
      id: 'test-uuid',
      topic: 'Test thread',
      status: 'active',
      kind: 'chat',
      display_name: 'My Thread',
      sort_order: 5,
      session_id: null,
      summary: null,
      parent_thread_id: null,
      fork_point_event_id: null,
      conversation_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      closed_at: null,
      archived_at: null,
    }

    assert.equal(thread.kind, 'chat')
    assert.equal(thread.display_name, 'My Thread')
    assert.equal(thread.sort_order, 5)
  })

  it('display_name can be null (falls back to topic)', () => {
    const thread: Thread = {
      id: 'test-uuid',
      topic: 'Fallback topic',
      status: 'paused',
      kind: 'task',
      display_name: null,
      sort_order: 0,
      session_id: null,
      summary: null,
      parent_thread_id: null,
      fork_point_event_id: null,
      conversation_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      closed_at: null,
      archived_at: null,
    }

    // UI should fall back to topic when display_name is null
    const displayLabel = thread.display_name ?? thread.topic ?? 'Untitled'
    assert.equal(displayLabel, 'Fallback topic')
  })
})

// ─── Display Name Fallback Logic ────────────────────────────────────

describe('Display name fallback logic', () => {
  function getDisplayLabel(thread: Pick<Thread, 'display_name' | 'topic'>): string {
    return thread.display_name ?? thread.topic ?? 'Untitled'
  }

  it('uses display_name when present', () => {
    assert.equal(getDisplayLabel({ display_name: 'JWT Auth', topic: 'jwt-auth-v2' }), 'JWT Auth')
  })

  it('falls back to topic when display_name is null', () => {
    assert.equal(getDisplayLabel({ display_name: null, topic: 'My topic' }), 'My topic')
  })

  it('falls back to "Untitled" when both are null', () => {
    assert.equal(getDisplayLabel({ display_name: null, topic: null }), 'Untitled')
  })
})

// ─── Sort Order Comparison ──────────────────────────────────────────

describe('Sort order comparison for siblings', () => {
  interface SortableThread {
    id: string
    topic: string | null
    sort_order: number
  }

  function sortSiblings(threads: SortableThread[]): SortableThread[] {
    return [...threads].sort((a, b) => a.sort_order - b.sort_order)
  }

  it('sorts by sort_order ascending', () => {
    const siblings: SortableThread[] = [
      { id: 'c', topic: 'Third', sort_order: 3 },
      { id: 'a', topic: 'First', sort_order: 1 },
      { id: 'b', topic: 'Second', sort_order: 2 },
    ]

    const sorted = sortSiblings(siblings)
    assert.deepEqual(sorted.map(s => s.id), ['a', 'b', 'c'])
  })

  it('preserves insertion order for equal sort_order', () => {
    const siblings: SortableThread[] = [
      { id: 'a', topic: 'First', sort_order: 0 },
      { id: 'b', topic: 'Second', sort_order: 0 },
      { id: 'c', topic: 'Third', sort_order: 0 },
    ]

    const sorted = sortSiblings(siblings)
    // All same sort_order, stable sort preserves original order
    assert.deepEqual(sorted.map(s => s.id), ['a', 'b', 'c'])
  })

  it('handles negative sort_order', () => {
    const siblings: SortableThread[] = [
      { id: 'b', topic: 'Normal', sort_order: 0 },
      { id: 'a', topic: 'Pinned first', sort_order: -10 },
      { id: 'c', topic: 'Last', sort_order: 100 },
    ]

    const sorted = sortSiblings(siblings)
    assert.deepEqual(sorted.map(s => s.id), ['a', 'b', 'c'])
  })
})

// ─── Filter Types ───────────────────────────────────────────────────

describe('Filter types include new fields', () => {
  it('ThreadListFilters accepts kind', () => {
    const filters: ThreadListFilters = {
      status: 'active',
      kind: 'task',
      limit: 10,
    }
    assert.equal(filters.kind, 'task')
  })

  it('ThreadEventFilters accepts event_kind', () => {
    const filters: ThreadEventFilters = {
      channel: 'web',
      event_kind: 'link',
    }
    assert.equal(filters.event_kind, 'link')
  })
})

// ─── Event Kind → UI Card Mapping ───────────────────────────────────

describe('Event kind to UI card color mapping', () => {
  /** Maps event_kind to UI card color (for Phase 5 but validates the model) */
  function eventKindColor(kind: ThreadEventKind): string {
    switch (kind) {
      case 'message': return 'default'
      case 'link': return 'blue'
      case 'note': return 'yellow'
      case 'event': return 'purple'
    }
  }

  it('maps all event kinds to colors', () => {
    assert.equal(eventKindColor('message'), 'default')
    assert.equal(eventKindColor('link'), 'blue')
    assert.equal(eventKindColor('note'), 'yellow')
    assert.equal(eventKindColor('event'), 'purple')
  })
})
