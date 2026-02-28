/**
 * Unit tests for lib/core/threads.ts — DB operations with mock pool
 *
 * Tests thread CRUD, events, refs, and analytics using a mocked pg.Pool.
 * threads.ts calls getPool() from store.ts at the top of every function,
 * so we mock store.ts to return our mock pool.
 */

import assert from 'node:assert/strict'
import { vi, beforeEach, afterEach } from 'vitest'
import { createMockPool } from './helpers/mock-pool'

const mock = createMockPool()

// Mock store.ts — threads.ts imports { getPool } from './store.js'
vi.mock('../lib/core/store.js', () => ({
  getPool: () => mock.pool,
}))

// Now import threads — it will use our mocked getPool
import * as threads from '../lib/core/threads'

describe('threads (DB mock)', () => {
  beforeEach(() => mock.reset())
  afterEach(() => mock.reset())

  // ─── createThread ──────────────────────────────────────────────────

  describe('createThread', () => {
    it('creates a thread with default options', async () => {
      const fakeThread = {
        id: 't1',
        topic: null,
        status: 'paused',
        kind: 'chat',
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
      mock.mockQuery(/INSERT INTO threads/, { rows: [fakeThread] })

      const result = await threads.createThread()
      assert.equal(result.id, 't1')
      assert.equal(result.status, 'paused')
      assert.equal(result.kind, 'chat')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('INSERT INTO threads'))!
      assert.ok(q)
      // Default params: topic=null, status=paused, kind=chat, etc.
      assert.equal(q.params?.[0], null) // topic
      assert.equal(q.params?.[1], 'paused') // status
      assert.equal(q.params?.[2], 'chat') // kind
    })

    it('creates a thread with custom options', async () => {
      mock.mockQuery(/INSERT INTO threads/, {
        rows: [{ id: 't2', topic: 'Issue #42', status: 'active', kind: 'task' }],
      })

      const result = await threads.createThread({
        topic: 'Issue #42',
        status: 'active',
        kind: 'task',
        conversation_id: 'conv-1',
      })
      assert.equal(result.topic, 'Issue #42')
      assert.equal(result.kind, 'task')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('INSERT INTO threads'))!
      assert.equal(q.params?.[0], 'Issue #42')
      assert.equal(q.params?.[1], 'active')
      assert.equal(q.params?.[2], 'task')
      assert.equal(q.params?.[8], 'conv-1') // conversation_id
    })
  })

  // ─── resolveThreadId ───────────────────────────────────────────────

  describe('resolveThreadId', () => {
    it('resolves direct thread ID', async () => {
      mock.mockQuery(/SELECT id FROM threads WHERE id = \$1/, {
        rows: [{ id: 't1' }],
      })

      const result = await threads.resolveThreadId('t1')
      assert.equal(result, 't1')
    })

    it('falls back to conversation_id lookup', async () => {
      // Direct lookup returns nothing
      mock.mockQuery(/SELECT id FROM threads WHERE id = \$1/, { rows: [] })
      // Conversation_id lookup returns match
      mock.mockQuery(/SELECT id FROM threads WHERE conversation_id/, {
        rows: [{ id: 't2' }],
      })

      const result = await threads.resolveThreadId('conv-1')
      assert.equal(result, 't2')
    })

    it('returns null when not found by either method', async () => {
      mock.mockQuery(/SELECT id FROM threads/, { rows: [] })

      const result = await threads.resolveThreadId('nonexistent')
      assert.equal(result, null)
    })
  })

  // ─── getThread ─────────────────────────────────────────────────────

  describe('getThread', () => {
    it('returns thread with refs when found', async () => {
      // resolveThreadId
      mock.mockQuery(/SELECT id FROM threads WHERE id = \$1/, {
        rows: [{ id: 't1' }],
      })
      // getThread SELECT
      mock.mockQuery(/SELECT \* FROM threads WHERE id/, {
        rows: [{ id: 't1', topic: 'Test', status: 'paused' }],
      })
      // thread_refs
      mock.mockQuery(/SELECT \* FROM thread_refs WHERE thread_id/, {
        rows: [{ id: 'r1', thread_id: 't1', ref_type: 'issue', repo: 'gigi', number: 42 }],
      })

      const result = await threads.getThread('t1')
      assert.ok(result)
      assert.equal(result!.id, 't1')
      assert.equal(result!.refs.length, 1)
      assert.equal(result!.refs[0].ref_type, 'issue')
    })

    it('returns null when thread not found', async () => {
      mock.mockQuery(/SELECT id FROM threads/, { rows: [] })

      const result = await threads.getThread('nonexistent')
      assert.equal(result, null)
    })
  })

  // ─── listThreads ──────────────────────────────────────────────────

  describe('listThreads', () => {
    it('lists threads with no filters', async () => {
      mock.mockQuery(/SELECT \* FROM threads.*ORDER BY/, {
        rows: [
          { id: 't1', status: 'active' },
          { id: 't2', status: 'paused' },
        ],
      })

      const result = await threads.listThreads()
      assert.equal(result.length, 2)

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(!q.sql.includes('WHERE'))
      assert.deepEqual(q.params, [50]) // default limit
    })

    it('filters by status', async () => {
      mock.mockQuery(/SELECT \* FROM threads/, { rows: [{ id: 't1', status: 'active' }] })

      await threads.listThreads({ status: 'active' })

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('status = $1'))
      assert.equal(q.params?.[0], 'active')
    })

    it('filters by kind', async () => {
      mock.mockQuery(/SELECT \* FROM threads/, { rows: [] })

      await threads.listThreads({ kind: 'task' })

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('kind = $1'))
      assert.equal(q.params?.[0], 'task')
    })

    it('filters by archived=false', async () => {
      mock.mockQuery(/SELECT \* FROM threads/, { rows: [] })

      await threads.listThreads({ archived: false })

      const log = mock.getQueryLog()
      assert.ok(log[0].sql.includes('archived_at IS NULL'))
    })

    it('filters by archived=true', async () => {
      mock.mockQuery(/SELECT \* FROM threads/, { rows: [] })

      await threads.listThreads({ archived: true })

      const log = mock.getQueryLog()
      assert.ok(log[0].sql.includes('archived_at IS NOT NULL'))
    })

    it('respects custom limit', async () => {
      mock.mockQuery(/SELECT \* FROM threads/, { rows: [] })

      await threads.listThreads({ limit: 10 })

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.params?.includes(10))
    })
  })

  // ─── updateThreadStatus ────────────────────────────────────────────

  describe('updateThreadStatus', () => {
    it('sets stopped status with closed_at', async () => {
      mock.mockQuery(/UPDATE threads SET/, { rows: [], rowCount: 1 })

      await threads.updateThreadStatus('t1', 'stopped')

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('closed_at = COALESCE(closed_at, now())'))
    })

    it('sets archived status with archived_at', async () => {
      mock.mockQuery(/UPDATE threads SET/, { rows: [], rowCount: 1 })

      await threads.updateThreadStatus('t1', 'archived')

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('archived_at = COALESCE(archived_at, now())'))
    })

    it('clears timestamps when reactivating', async () => {
      mock.mockQuery(/UPDATE threads SET/, { rows: [], rowCount: 1 })

      await threads.updateThreadStatus('t1', 'active')

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('closed_at = NULL'))
      assert.ok(q.sql.includes('archived_at = NULL'))
    })

    it('clears timestamps when pausing', async () => {
      mock.mockQuery(/UPDATE threads SET/, { rows: [], rowCount: 1 })

      await threads.updateThreadStatus('t1', 'paused')

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('closed_at = NULL'))
      assert.ok(q.sql.includes('archived_at = NULL'))
    })
  })

  // ─── Simple update operations ──────────────────────────────────────

  describe('setThreadSession', () => {
    it('updates session_id', async () => {
      mock.mockQuery(/UPDATE threads SET session_id/, { rows: [], rowCount: 1 })

      await threads.setThreadSession('t1', 'sess-abc')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', 'sess-abc'])
    })
  })

  describe('updateThreadTopic', () => {
    it('updates topic', async () => {
      mock.mockQuery(/UPDATE threads SET topic/, { rows: [], rowCount: 1 })

      await threads.updateThreadTopic('t1', 'New topic')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', 'New topic'])
    })
  })

  describe('updateThreadKind', () => {
    it('updates kind', async () => {
      mock.mockQuery(/UPDATE threads SET kind/, { rows: [], rowCount: 1 })

      await threads.updateThreadKind('t1', 'task')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', 'task'])
    })
  })

  describe('updateThreadDisplayName', () => {
    it('updates display_name', async () => {
      mock.mockQuery(/UPDATE threads SET display_name/, { rows: [], rowCount: 1 })

      await threads.updateThreadDisplayName('t1', 'My Thread')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', 'My Thread'])
    })

    it('clears display_name with null', async () => {
      mock.mockQuery(/UPDATE threads SET display_name/, { rows: [], rowCount: 1 })

      await threads.updateThreadDisplayName('t1', null)

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', null])
    })
  })

  describe('updateThreadSortOrder', () => {
    it('updates sort_order', async () => {
      mock.mockQuery(/UPDATE threads SET sort_order/, { rows: [], rowCount: 1 })

      await threads.updateThreadSortOrder('t1', 5)

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', 5])
    })
  })

  describe('updateThreadSummary', () => {
    it('updates summary', async () => {
      mock.mockQuery(/UPDATE threads SET summary/, { rows: [], rowCount: 1 })

      await threads.updateThreadSummary('t1', 'Thread summary text')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', 'Thread summary text'])
    })
  })

  describe('deleteThread', () => {
    it('deletes thread by id', async () => {
      mock.mockQuery(/DELETE FROM threads/, { rows: [], rowCount: 1 })

      await threads.deleteThread('t1')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1'])
    })
  })

  // ─── Thread Events ─────────────────────────────────────────────────

  describe('addThreadEvent', () => {
    it('inserts event and touches thread updated_at', async () => {
      mock.mockQuery(/UPDATE threads SET updated_at/, { rows: [], rowCount: 1 })
      mock.mockQuery(/INSERT INTO thread_events/, {
        rows: [{
          id: 'e1',
          thread_id: 't1',
          channel: 'web',
          direction: 'inbound',
          actor: 'user',
          content: [{ type: 'text', text: 'hello' }],
          message_type: 'text',
          event_kind: 'message',
          usage: null,
          metadata: {},
          is_compacted: false,
          created_at: '2026-01-01T00:00:00Z',
        }],
      })

      const result = await threads.addThreadEvent('t1', {
        channel: 'web',
        direction: 'inbound',
        actor: 'user',
        content: [{ type: 'text', text: 'hello' }],
      })

      assert.equal(result.id, 'e1')
      assert.equal(result.channel, 'web')

      const log = mock.getQueryLog()
      // First query: touch updated_at
      assert.ok(log[0].sql.includes('UPDATE threads'))
      // Second query: insert event
      assert.ok(log[1].sql.includes('INSERT INTO thread_events'))
      assert.equal(log[1].params?.[1], 'web') // channel
      assert.equal(log[1].params?.[2], 'inbound') // direction
      assert.equal(log[1].params?.[3], 'user') // actor
      // Content is JSON-stringified
      assert.equal(log[1].params?.[4], JSON.stringify([{ type: 'text', text: 'hello' }]))
    })

    it('uses default message_type and event_kind', async () => {
      mock.mockQuery(/UPDATE threads/, { rows: [], rowCount: 1 })
      mock.mockQuery(/INSERT INTO thread_events/, {
        rows: [{ id: 'e2', message_type: 'text', event_kind: 'message' }],
      })

      await threads.addThreadEvent('t1', {
        channel: 'webhook',
        direction: 'inbound',
        actor: 'system',
        content: 'test',
      })

      const log = mock.getQueryLog()
      const insertQ = log.find(l => l.sql.includes('INSERT INTO thread_events'))!
      assert.equal(insertQ.params?.[5], 'text') // message_type default
      assert.equal(insertQ.params?.[6], 'message') // event_kind default
    })
  })

  describe('getThreadEvents', () => {
    it('returns events with default filters', async () => {
      mock.mockQuery(/SELECT \* FROM thread_events/, {
        rows: [
          { id: 'e1', channel: 'web', is_compacted: false },
          { id: 'e2', channel: 'webhook', is_compacted: false },
        ],
      })

      const events = await threads.getThreadEvents('t1')
      assert.equal(events.length, 2)

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('is_compacted = false'))
      assert.ok(q.sql.includes('ORDER BY created_at ASC'))
    })

    it('filters by channel and direction', async () => {
      mock.mockQuery(/SELECT \* FROM thread_events/, { rows: [] })

      await threads.getThreadEvents('t1', { channel: 'web', direction: 'inbound' })

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('channel = $2'))
      assert.ok(q.sql.includes('direction = $3'))
      assert.equal(q.params?.[1], 'web')
      assert.equal(q.params?.[2], 'inbound')
    })

    it('includes compacted events when requested', async () => {
      mock.mockQuery(/SELECT \* FROM thread_events/, { rows: [] })

      await threads.getThreadEvents('t1', { include_compacted: true })

      const log = mock.getQueryLog()
      assert.ok(!log[0].sql.includes('is_compacted = false'))
    })

    it('respects limit and offset', async () => {
      mock.mockQuery(/SELECT \* FROM thread_events/, { rows: [] })

      await threads.getThreadEvents('t1', { limit: 10, offset: 20 })

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.params?.includes(10))
      assert.ok(q.params?.includes(20))
    })
  })

  describe('countThreadEvents', () => {
    it('returns event count', async () => {
      mock.mockQuery(/SELECT COUNT.*FROM thread_events/, {
        rows: [{ count: '42' }],
      })

      const count = await threads.countThreadEvents('t1')
      assert.equal(count, 42)
    })
  })

  describe('markEventsCompacted', () => {
    it('marks events as compacted before a date', async () => {
      mock.mockQuery(/UPDATE thread_events SET is_compacted = true/, {
        rows: [],
        rowCount: 5,
      })

      const count = await threads.markEventsCompacted('t1', '2026-01-15T00:00:00Z')
      assert.equal(count, 5)

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['t1', '2026-01-15T00:00:00Z'])
    })
  })

  // ─── Thread Refs ───────────────────────────────────────────────────

  describe('addThreadRef', () => {
    it('upserts a thread ref', async () => {
      mock.mockQuery(/INSERT INTO thread_refs/, {
        rows: [{
          id: 'r1',
          thread_id: 't1',
          ref_type: 'issue',
          repo: 'gigi',
          number: 42,
          ref: null,
          url: 'http://localhost/42',
          status: 'open',
        }],
      })

      const result = await threads.addThreadRef('t1', {
        ref_type: 'issue',
        repo: 'gigi',
        number: 42,
        url: 'http://localhost/42',
        status: 'open',
      })

      assert.equal(result.ref_type, 'issue')
      assert.equal(result.number, 42)

      const log = mock.getQueryLog()
      const q = log[0]
      assert.ok(q.sql.includes('ON CONFLICT'))
    })
  })

  describe('getThreadRefs', () => {
    it('returns refs ordered by created_at', async () => {
      mock.mockQuery(/SELECT \* FROM thread_refs WHERE thread_id/, {
        rows: [
          { id: 'r1', ref_type: 'issue', number: 42 },
          { id: 'r2', ref_type: 'pr', number: 10 },
        ],
      })

      const refs = await threads.getThreadRefs('t1')
      assert.equal(refs.length, 2)
      assert.equal(refs[0].ref_type, 'issue')
    })
  })

  describe('findThreadByRef', () => {
    it('returns thread with refs when found', async () => {
      mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, {
        rows: [{ id: 't1', topic: 'Issue #42', status: 'paused' }],
      })
      mock.mockQuery(/SELECT \* FROM thread_refs WHERE thread_id/, {
        rows: [{ id: 'r1', thread_id: 't1', ref_type: 'issue', repo: 'gigi', number: 42 }],
      })

      const result = await threads.findThreadByRef('gigi', 'issue', 42)
      assert.ok(result)
      assert.equal(result!.id, 't1')
      assert.equal(result!.refs.length, 1)
    })

    it('returns null when not found', async () => {
      mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })

      const result = await threads.findThreadByRef('gigi', 'issue', 999)
      assert.equal(result, null)
    })
  })

  describe('updateThreadRefStatus', () => {
    it('updates ref status by repo/type/number', async () => {
      mock.mockQuery(/UPDATE thread_refs SET status/, { rows: [], rowCount: 1 })

      await threads.updateThreadRefStatus('gigi', 'issue', 42, 'closed')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['gigi', 'issue', 42, 'closed'])
    })
  })

  describe('removeThreadRef', () => {
    it('deletes ref by id', async () => {
      mock.mockQuery(/DELETE FROM thread_refs/, { rows: [], rowCount: 1 })

      await threads.removeThreadRef('r1')

      const log = mock.getQueryLog()
      assert.deepEqual(log[0].params, ['r1'])
    })
  })

  // ─── Thread Usage ──────────────────────────────────────────────────

  describe('getThreadUsage', () => {
    it('aggregates usage from thread events', async () => {
      mock.mockQuery(/SUM.*inputTokens.*FROM thread_events/, {
        rows: [{
          input_tokens: '2000',
          output_tokens: '1000',
          total_cost: '0.15',
          event_count: '5',
        }],
      })

      const usage = await threads.getThreadUsage('t1')
      assert.equal(usage.input_tokens, 2000)
      assert.equal(usage.output_tokens, 1000)
      assert.equal(usage.total_cost, 0.15)
      assert.equal(usage.event_count, 5)
    })
  })

  // ─── getThreadLineage ──────────────────────────────────────────────

  describe('getThreadLineage', () => {
    it('returns lineage with parent, fork point, and children', async () => {
      // resolveThreadId for getThread('t2')
      mock.mockQuery(/SELECT id FROM threads WHERE id = \$1/, (sql, params) => {
        return { rows: [{ id: params?.[0] as string }] }
      })
      // getThread SELECT
      mock.mockQuery(/SELECT \* FROM threads WHERE id/, (sql, params) => {
        if (params?.[0] === 't2') {
          return { rows: [{ id: 't2', topic: 'Fork', parent_thread_id: 't1', fork_point_event_id: 'e5' }] }
        }
        if (params?.[0] === 't1') {
          return { rows: [{ id: 't1', topic: 'Original', parent_thread_id: null, fork_point_event_id: null }] }
        }
        return { rows: [] }
      })
      // thread_refs for any thread
      mock.mockQuery(/SELECT \* FROM thread_refs WHERE thread_id/, { rows: [] })
      // Fork point event
      mock.mockQuery(/SELECT \* FROM thread_events WHERE id/, {
        rows: [{ id: 'e5', thread_id: 't1', channel: 'web' }],
      })
      // Children threads
      mock.mockQuery(/SELECT \* FROM threads WHERE parent_thread_id/, {
        rows: [{ id: 't3', topic: 'Child', parent_thread_id: 't2' }],
      })

      const lineage = await threads.getThreadLineage('t2')
      assert.ok(lineage.parent)
      assert.equal(lineage.parent!.id, 't1')
      assert.ok(lineage.fork_point)
      assert.equal(lineage.fork_point!.id, 'e5')
      assert.equal(lineage.children.length, 1)
      assert.equal(lineage.children[0].id, 't3')
    })

    it('throws for non-existent thread', async () => {
      mock.mockQuery(/SELECT id FROM threads/, { rows: [] })

      await assert.rejects(
        () => threads.getThreadLineage('nonexistent'),
        /not found/
      )
    })
  })
})
