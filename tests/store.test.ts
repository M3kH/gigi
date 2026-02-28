/**
 * Unit tests for lib/core/store.ts — DB operations with mock pool
 *
 * Uses vi.mock to replace the `pg` module so that the module-level `pool`
 * inside store.ts is our mock. This approach avoids needing a real database
 * while testing SQL generation, parameter passing, and return value handling.
 */

import assert from 'node:assert/strict'
import { vi, beforeEach, afterEach } from 'vitest'
import { createMockPool } from './helpers/mock-pool'

// Create mock pool instance
const mock = createMockPool()

// Mock the `pg` module before store.ts imports it.
// store.ts does: import pg from 'pg'; const { Pool } = pg;
// We replace Pool with a class that returns our mock pool.
vi.mock('pg', () => ({
  default: {
    Pool: class MockPool {
      query = mock.pool.query
      end = (mock.pool as any).end
    },
  },
}))

// Now import store — it will use our mocked pg.Pool
import * as store from '../lib/core/store'

describe('store', () => {
  beforeEach(() => {
    mock.reset()
    // Mock migration query (called during connect)
    mock.mockQuery(/CREATE TABLE IF NOT EXISTS/, { rows: [], rowCount: 0 })
    mock.mockQuery(/ALTER TABLE/, { rows: [], rowCount: 0 })
    mock.mockQuery(/CREATE INDEX/, { rows: [], rowCount: 0 })
    mock.mockQuery(/UPDATE conversations SET status/, { rows: [], rowCount: 0 })
    mock.mockQuery(/DO \$\$/, { rows: [], rowCount: 0 })
    mock.mockQuery(/SELECT 1/, { rows: [{ '?column?': 1 }] })
  })

  afterEach(() => {
    mock.reset()
  })

  // ─── connect ───────────────────────────────────────────────────────

  describe('connect', () => {
    it('runs SELECT 1 health check and migrations', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      const log = mock.getQueryLog()
      // First query should be the health check
      assert.ok(log.some(q => q.sql.includes('SELECT 1')))
    })

    it('returns a pool instance', async () => {
      const pool = await store.connect('postgresql://test:test@localhost/test')
      assert.ok(pool)
    })
  })

  // ─── getPool ───────────────────────────────────────────────────────

  describe('getPool', () => {
    it('returns the connected pool', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      const pool = store.getPool()
      assert.ok(pool)
      assert.ok(pool.query)
    })
  })

  // ─── Config store ──────────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns the value when key exists', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT value FROM config/, { rows: [{ value: 'my-token' }] })

      const result = await store.getConfig('gitea_token')
      assert.equal(result, 'my-token')

      const log = mock.getQueryLog()
      const configQuery = log.find(q => q.sql.includes('SELECT value FROM config'))
      assert.ok(configQuery)
      assert.deepEqual(configQuery!.params, ['gitea_token'])
    })

    it('returns null when key does not exist', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT value FROM config/, { rows: [] })

      const result = await store.getConfig('nonexistent')
      assert.equal(result, null)
    })
  })

  describe('setConfig', () => {
    it('upserts a config key/value', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/INSERT INTO config/, { rows: [], rowCount: 1 })

      await store.setConfig('key1', 'value1')

      const log = mock.getQueryLog()
      const insertQuery = log.find(q => q.sql.includes('INSERT INTO config'))
      assert.ok(insertQuery)
      assert.deepEqual(insertQuery!.params, ['key1', 'value1'])
      assert.ok(insertQuery!.sql.includes('ON CONFLICT'))
    })
  })

  describe('getAllConfig', () => {
    it('returns all config as a key-value record', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT key, value FROM config/, {
        rows: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' },
        ],
      })

      const result = await store.getAllConfig()
      assert.deepEqual(result, { a: '1', b: '2' })
    })

    it('returns empty object when no config exists', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT key, value FROM config/, { rows: [] })

      const result = await store.getAllConfig()
      assert.deepEqual(result, {})
    })
  })

  describe('deleteConfig', () => {
    it('deletes a config key', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/DELETE FROM config/, { rows: [], rowCount: 1 })

      await store.deleteConfig('old_key')

      const log = mock.getQueryLog()
      const deleteQuery = log.find(q => q.sql.includes('DELETE FROM config'))
      assert.ok(deleteQuery)
      assert.deepEqual(deleteQuery!.params, ['old_key'])
    })
  })

  // ─── Conversations ─────────────────────────────────────────────────

  describe('createConversation', () => {
    it('creates a conversation with channel and topic', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()

      const fakeConv = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        channel: 'web',
        topic: 'Test topic',
        status: 'paused',
        tags: [],
        repo: null,
        session_id: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        closed_at: null,
        archived_at: null,
      }
      mock.mockQuery(/INSERT INTO conversations/, { rows: [fakeConv] })

      const result = await store.createConversation('web', 'Test topic')
      assert.equal(result.channel, 'web')
      assert.equal(result.topic, 'Test topic')
      assert.equal(result.status, 'paused')

      const log = mock.getQueryLog()
      const insertQ = log.find(q => q.sql.includes('INSERT INTO conversations'))
      assert.ok(insertQ)
      assert.deepEqual(insertQ!.params, ['web', 'Test topic'])
    })

    it('defaults topic to null', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/INSERT INTO conversations/, {
        rows: [{ id: 'id1', channel: 'webhook', topic: null, status: 'paused' }],
      })

      const result = await store.createConversation('webhook')
      assert.equal(result.topic, null)

      const log = mock.getQueryLog()
      const insertQ = log.find(q => q.sql.includes('INSERT INTO conversations'))
      assert.deepEqual(insertQ!.params, ['webhook', null])
    })
  })

  describe('getConversation', () => {
    it('returns conversation when found', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM conversations WHERE id/, {
        rows: [{ id: 'c1', channel: 'web', topic: 'Hi', status: 'active' }],
      })

      const result = await store.getConversation('c1')
      assert.ok(result)
      assert.equal(result!.id, 'c1')
    })

    it('returns null when not found', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM conversations WHERE id/, { rows: [] })

      const result = await store.getConversation('nonexistent')
      assert.equal(result, null)
    })
  })

  describe('deleteConversation', () => {
    it('deletes by id', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/DELETE FROM conversations/, { rows: [], rowCount: 1 })

      await store.deleteConversation('c1')
      const log = mock.getQueryLog()
      assert.ok(log.some(q => q.sql.includes('DELETE FROM conversations') && q.params?.[0] === 'c1'))
    })
  })

  // ─── Messages ──────────────────────────────────────────────────────

  describe('addMessage', () => {
    it('inserts a message and updates conversation updated_at', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()

      mock.mockQuery(/UPDATE conversations SET updated_at/, { rows: [], rowCount: 1 })
      mock.mockQuery(/INSERT INTO messages/, {
        rows: [{
          id: 'm1',
          conversation_id: 'c1',
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
          tool_calls: null,
          tool_outputs: null,
          message_type: 'text',
          usage: null,
          created_at: '2026-01-01T00:00:00Z',
        }],
      })

      const result = await store.addMessage('c1', 'user', [{ type: 'text', text: 'hello' }])
      assert.equal(result.id, 'm1')
      assert.equal(result.role, 'user')

      const log = mock.getQueryLog()
      // Should update conversation first, then insert message
      assert.ok(log[0].sql.includes('UPDATE conversations'))
      assert.ok(log[1].sql.includes('INSERT INTO messages'))
      // Content should be JSON-stringified
      assert.equal(log[1].params?.[2], JSON.stringify([{ type: 'text', text: 'hello' }]))
    })

    it('passes extras (tool_calls, usage, etc.)', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()

      mock.mockQuery(/UPDATE conversations/, { rows: [], rowCount: 1 })
      mock.mockQuery(/INSERT INTO messages/, {
        rows: [{ id: 'm2', role: 'assistant', content: 'resp', message_type: 'webhook' }],
      })

      await store.addMessage('c1', 'assistant', 'resp', {
        tool_calls: [{ name: 'Bash' }],
        message_type: 'webhook',
        usage: { inputTokens: 100, outputTokens: 50 },
      })

      const log = mock.getQueryLog()
      const insertQ = log.find(q => q.sql.includes('INSERT INTO messages'))!
      assert.equal(insertQ.params?.[3], JSON.stringify([{ name: 'Bash' }])) // tool_calls
      assert.equal(insertQ.params?.[5], 'webhook') // message_type
      assert.equal(insertQ.params?.[6], JSON.stringify({ inputTokens: 100, outputTokens: 50 })) // usage
    })
  })

  describe('getMessages', () => {
    it('returns messages ordered by created_at ASC', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()

      mock.mockQuery(/SELECT \* FROM messages WHERE conversation_id/, {
        rows: [
          { id: 'm1', role: 'user', content: 'first', created_at: '2026-01-01T00:00:00Z' },
          { id: 'm2', role: 'assistant', content: 'second', created_at: '2026-01-01T00:01:00Z' },
        ],
      })

      const messages = await store.getMessages('c1')
      assert.equal(messages.length, 2)
      assert.equal(messages[0].id, 'm1')
      assert.equal(messages[1].id, 'm2')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('SELECT * FROM messages'))!
      assert.ok(q.sql.includes('ORDER BY created_at ASC'))
      assert.deepEqual(q.params, ['c1', 100])
    })

    it('respects custom limit', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM messages/, { rows: [] })

      await store.getMessages('c1', 10)
      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('SELECT * FROM messages'))!
      assert.deepEqual(q.params, ['c1', 10])
    })
  })

  // ─── Action Log ────────────────────────────────────────────────────

  describe('logAction', () => {
    it('inserts an action log entry', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/INSERT INTO action_log/, { rows: [], rowCount: 1 })

      await store.logAction('comment', 'gigi', 'issue-42', { pr: 10 })

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('INSERT INTO action_log'))!
      assert.deepEqual(q.params, ['comment', 'gigi', 'issue-42', JSON.stringify({ pr: 10 })])
    })

    it('handles null refId and metadata', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/INSERT INTO action_log/, { rows: [], rowCount: 1 })

      await store.logAction('push', 'gigi')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('INSERT INTO action_log'))!
      assert.deepEqual(q.params, ['push', 'gigi', null, null])
    })
  })

  describe('checkRecentAction', () => {
    it('returns true when recent action exists', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM action_log/, {
        rows: [{ id: 1, action_type: 'comment', repo: 'gigi', ref_id: '42' }],
      })

      const result = await store.checkRecentAction('comment', 'gigi', '42')
      assert.equal(result, true)
    })

    it('returns false when no recent action', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM action_log/, { rows: [] })

      const result = await store.checkRecentAction('comment', 'gigi', '42')
      assert.equal(result, false)
    })
  })

  describe('cleanupOldActions', () => {
    it('returns count of deleted actions', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/DELETE FROM action_log/, { rows: [], rowCount: 5 })

      const count = await store.cleanupOldActions(24)
      assert.equal(count, 5)
    })

    it('returns 0 when nothing to clean', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/DELETE FROM action_log/, { rows: [], rowCount: 0 })

      const count = await store.cleanupOldActions()
      assert.equal(count, 0)
    })
  })

  // ─── Session management ────────────────────────────────────────────

  describe('setSessionId', () => {
    it('updates session_id and sets status to active', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET session_id/, { rows: [], rowCount: 1 })

      await store.setSessionId('c1', 'sess-abc')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('UPDATE conversations SET session_id'))!
      assert.ok(q.sql.includes("status = 'active'"))
      assert.deepEqual(q.params, ['c1', 'sess-abc'])
    })
  })

  describe('getSessionId', () => {
    it('returns session_id when present', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT session_id FROM conversations/, {
        rows: [{ session_id: 'sess-abc' }],
      })

      const result = await store.getSessionId('c1')
      assert.equal(result, 'sess-abc')
    })

    it('returns null when no session', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT session_id FROM conversations/, {
        rows: [{ session_id: null }],
      })

      const result = await store.getSessionId('c1')
      assert.equal(result, null)
    })

    it('returns null when conversation not found', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT session_id FROM conversations/, { rows: [] })

      const result = await store.getSessionId('nonexistent')
      assert.equal(result, null)
    })
  })

  describe('clearSessionId', () => {
    it('sets session_id to NULL', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET session_id = NULL/, { rows: [], rowCount: 1 })

      await store.clearSessionId('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('session_id = NULL'))!
      assert.ok(q)
      assert.deepEqual(q.params, ['c1'])
    })
  })

  // ─── Thread lifecycle transitions ──────────────────────────────────

  describe('activateThread', () => {
    it('transitions from paused/stopped to active', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'active'/, { rows: [], rowCount: 1 })

      await store.activateThread('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'active'"))!
      assert.ok(q.sql.includes("IN ('paused', 'stopped')"))
    })
  })

  describe('pauseThread', () => {
    it('transitions from active to paused', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'paused'/, { rows: [], rowCount: 1 })

      await store.pauseThread('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'paused'"))!
      assert.ok(q.sql.includes("status = 'active'"))
    })
  })

  describe('stopThread', () => {
    it('transitions to stopped with closed_at timestamp', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'stopped'/, { rows: [], rowCount: 1 })

      await store.stopThread('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'stopped'"))!
      assert.ok(q.sql.includes('closed_at = now()'))
      assert.ok(q.sql.includes("status != 'archived'"))
    })
  })

  describe('archiveThread', () => {
    it('transitions from stopped to archived', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'archived'/, { rows: [], rowCount: 1 })

      await store.archiveThread('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'archived'"))!
      assert.ok(q.sql.includes('archived_at = now()'))
      assert.ok(q.sql.includes("status = 'stopped'"))
    })
  })

  describe('reopenThread', () => {
    it('transitions from stopped/archived to paused', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'paused'/, { rows: [], rowCount: 1 })

      await store.reopenThread('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'paused'"))!
      assert.ok(q.sql.includes('closed_at = NULL'))
      assert.ok(q.sql.includes('archived_at = NULL'))
      assert.ok(q.sql.includes("IN ('stopped', 'archived')"))
    })
  })

  // ─── updateConversation ────────────────────────────────────────────

  describe('updateConversation', () => {
    it('updates multiple fields dynamically', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET/, { rows: [], rowCount: 1 })

      await store.updateConversation('c1', { topic: 'New topic', status: 'active' })

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('UPDATE conversations SET') && l.sql.includes('topic'))!
      assert.ok(q)
      assert.ok(q.sql.includes('topic = $2'))
      assert.ok(q.sql.includes('status = $3'))
      assert.deepEqual(q.params, ['c1', 'New topic', 'active'])
    })

    it('does nothing when no fields provided', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()

      await store.updateConversation('c1', {})

      const log = mock.getQueryLog()
      assert.equal(log.length, 0) // No query executed
    })
  })

  // ─── Tags ──────────────────────────────────────────────────────────

  describe('addTags', () => {
    it('adds tags with deduplication', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET tags/, { rows: [], rowCount: 1 })

      await store.addTags('c1', ['gigi', 'gigi#42'])

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes('UPDATE conversations SET tags'))!
      assert.ok(q.sql.includes('DISTINCT'))
      assert.deepEqual(q.params, ['c1', ['gigi', 'gigi#42']])
    })
  })

  describe('findByTag', () => {
    it('returns conversations matching a tag', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM conversations WHERE .+ = ANY\(tags\)/, {
        rows: [
          { id: 'c1', tags: ['gigi#42'], status: 'active' },
          { id: 'c2', tags: ['gigi#42'], status: 'paused' },
        ],
      })

      const result = await store.findByTag('gigi#42')
      assert.equal(result.length, 2)
    })

    it('returns empty array when no matches', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM conversations WHERE .+ = ANY\(tags\)/, { rows: [] })

      const result = await store.findByTag('nonexistent')
      assert.deepEqual(result, [])
    })
  })

  describe('findLatest', () => {
    it('returns latest active/paused conversation for channel', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM conversations WHERE channel/, {
        rows: [{ id: 'c1', channel: 'web', status: 'active' }],
      })

      const result = await store.findLatest('web')
      assert.ok(result)
      assert.equal(result!.id, 'c1')
    })

    it('returns null when no conversation found', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SELECT \* FROM conversations WHERE channel/, { rows: [] })

      const result = await store.findLatest('telegram')
      assert.equal(result, null)
    })
  })

  // ─── Auto-archive ──────────────────────────────────────────────────

  describe('autoArchiveStale', () => {
    it('returns count of archived conversations', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations.*SET status = 'archived'.*WHERE status IN \('paused', 'stopped'\)/, {
        rows: [],
        rowCount: 3,
      })

      const count = await store.autoArchiveStale(7)
      assert.equal(count, 3)
    })
  })

  // ─── Archive/Unarchive ─────────────────────────────────────────────

  describe('archiveConversation', () => {
    it('sets status to archived with archived_at timestamp', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'archived'/, { rows: [], rowCount: 1 })

      await store.archiveConversation('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'archived'") && l.sql.includes('archived_at'))!
      assert.ok(q)
    })
  })

  describe('unarchiveConversation', () => {
    it('sets status to paused and clears archived_at', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'paused'/, { rows: [], rowCount: 1 })

      await store.unarchiveConversation('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'paused'") && l.sql.includes('archived_at = NULL'))!
      assert.ok(q)
    })
  })

  // ─── Token usage ───────────────────────────────────────────────────

  describe('getConversationUsage', () => {
    it('aggregates token usage from messages', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SUM.*inputTokens/, {
        rows: [{
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_tokens: 200,
          cache_creation_tokens: 50,
          total_cost: 0.05,
          messages_with_usage: 3,
        }],
      })

      const usage = await store.getConversationUsage('c1')
      assert.equal(usage.input_tokens, 1000)
      assert.equal(usage.output_tokens, 500)
      assert.equal(usage.cache_read_tokens, 200)
      assert.equal(usage.total_cost, 0.05)
    })
  })

  // ─── Budget check ──────────────────────────────────────────────────

  describe('checkBudget', () => {
    it('reports under budget', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SUM.*costUSD/, { rows: [{ period_spend: '5.00' }] })

      const result = await store.checkBudget(100, 7)
      assert.equal(result.periodSpend, 5)
      assert.equal(result.budgetUSD, 100)
      assert.equal(result.overBudget, false)
      assert.equal(result.percentUsed, 5)
    })

    it('reports over budget', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/SUM.*costUSD/, { rows: [{ period_spend: '150.00' }] })

      const result = await store.checkBudget(100)
      assert.equal(result.overBudget, true)
      assert.equal(result.percentUsed, 150)
    })
  })

  // ─── closeConversation (deprecated) ────────────────────────────────

  describe('closeConversation', () => {
    it('maps to stopped status', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()
      mock.mockQuery(/UPDATE conversations SET status = 'stopped'/, { rows: [], rowCount: 1 })

      await store.closeConversation('c1')

      const log = mock.getQueryLog()
      const q = log.find(l => l.sql.includes("status = 'stopped'"))!
      assert.ok(q)
      assert.ok(q.sql.includes('closed_at = now()'))
    })
  })

  // ─── Conversation Analysis ─────────────────────────────────────────

  describe('getConversationAnalysis', () => {
    it('computes tool breakdown and optimization hints', async () => {
      await store.connect('postgresql://test:test@localhost/test')
      mock.resetQueryLog()

      mock.mockQuery(/SELECT role, content, tool_calls, usage, created_at.*FROM messages/, {
        rows: [
          {
            role: 'user',
            content: 'hello',
            tool_calls: null,
            usage: null,
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            role: 'assistant',
            content: 'response',
            tool_calls: [{ name: 'Bash' }, { name: 'Read' }],
            usage: { costUSD: 0.10, inputTokens: 5000, outputTokens: 1000, cacheReadInputTokens: 500 },
            created_at: '2026-01-01T00:01:00Z',
          },
          {
            role: 'assistant',
            content: 'more response',
            tool_calls: [{ name: 'Bash' }],
            usage: { costUSD: 0.08, inputTokens: 4000, outputTokens: 800, cacheReadInputTokens: 300 },
            created_at: '2026-01-01T00:02:00Z',
          },
        ],
      })

      const analysis = await store.getConversationAnalysis('c1')
      assert.equal(analysis.messageCount, 3)
      assert.equal(analysis.totalCost, 0.18)
      assert.equal(analysis.totalInputTokens, 9000)
      assert.equal(analysis.totalOutputTokens, 1800)

      // Tool breakdown
      assert.ok(analysis.toolBreakdown.find(t => t.toolName === 'Bash' && t.callCount === 2))
      assert.ok(analysis.toolBreakdown.find(t => t.toolName === 'Read' && t.callCount === 1))

      // Timeline only includes assistant messages with usage
      assert.equal(analysis.messageTimeline.length, 2)
    })
  })
})
