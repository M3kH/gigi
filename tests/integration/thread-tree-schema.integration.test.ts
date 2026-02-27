/**
 * Integration Test: Thread Tree Schema (Phase 1, Issue #298)
 *
 * Tests the new thread metadata columns (kind, display_name, sort_order)
 * and thread event card types (event_kind). Verifies:
 * - Migration adds columns with correct defaults
 * - New fields are readable/writable via thread API
 * - Existing threads continue to work unchanged (backward compat)
 * - Filtering by kind and event_kind works correctly
 */

import assert from 'node:assert/strict'
import {
  connectTestDB,
  disconnectTestDB,
  truncateAll,
} from './index'
import * as threads from '../../lib/core/threads'

// ─── Suite Setup ────────────────────────────────────────────────────

beforeAll(async () => {
  await connectTestDB()
})

afterAll(async () => {
  await disconnectTestDB()
})

beforeEach(async () => {
  await truncateAll()
})

// ─── Thread Metadata Columns ────────────────────────────────────────

describe('Thread tree: kind column', () => {
  it('defaults to "chat" when not specified', async () => {
    const thread = await threads.createThread({ topic: 'Default kind' })
    assert.equal(thread.kind, 'chat')
  })

  it('can be set to "system_log" on creation', async () => {
    const thread = await threads.createThread({
      topic: 'System events',
      kind: 'system_log',
    })
    assert.equal(thread.kind, 'system_log')
  })

  it('can be set to "task" on creation', async () => {
    const thread = await threads.createThread({
      topic: 'Automated task',
      kind: 'task',
    })
    assert.equal(thread.kind, 'task')
  })

  it('can be updated via updateThreadKind', async () => {
    const thread = await threads.createThread({ topic: 'Will change kind' })
    assert.equal(thread.kind, 'chat')

    await threads.updateThreadKind(thread.id, 'task')
    const updated = await threads.getThread(thread.id)
    assert.equal(updated?.kind, 'task')
  })

  it('persists through getThread round-trip', async () => {
    const thread = await threads.createThread({
      topic: 'Round trip',
      kind: 'system_log',
    })
    const fetched = await threads.getThread(thread.id)
    assert.equal(fetched?.kind, 'system_log')
  })
})

describe('Thread tree: display_name column', () => {
  it('defaults to null when not specified', async () => {
    const thread = await threads.createThread({ topic: 'No display name' })
    assert.equal(thread.display_name, null)
  })

  it('can be set on creation', async () => {
    const thread = await threads.createThread({
      topic: 'jwt-auth-feature',
      display_name: 'JWT Middleware',
    })
    assert.equal(thread.display_name, 'JWT Middleware')
  })

  it('can be updated via updateThreadDisplayName', async () => {
    const thread = await threads.createThread({ topic: 'Needs rename' })
    assert.equal(thread.display_name, null)

    await threads.updateThreadDisplayName(thread.id, 'Login UI')
    const updated = await threads.getThread(thread.id)
    assert.equal(updated?.display_name, 'Login UI')
  })

  it('can be set back to null', async () => {
    const thread = await threads.createThread({
      topic: 'Has name',
      display_name: 'Will be cleared',
    })
    assert.equal(thread.display_name, 'Will be cleared')

    await threads.updateThreadDisplayName(thread.id, null)
    const updated = await threads.getThread(thread.id)
    assert.equal(updated?.display_name, null)
  })
})

describe('Thread tree: sort_order column', () => {
  it('defaults to 0 when not specified', async () => {
    const thread = await threads.createThread({ topic: 'Default order' })
    assert.equal(thread.sort_order, 0)
  })

  it('can be set on creation', async () => {
    const thread = await threads.createThread({
      topic: 'High priority',
      sort_order: 10,
    })
    assert.equal(thread.sort_order, 10)
  })

  it('can be updated via updateThreadSortOrder', async () => {
    const thread = await threads.createThread({ topic: 'Reorder me' })
    assert.equal(thread.sort_order, 0)

    await threads.updateThreadSortOrder(thread.id, 5)
    const updated = await threads.getThread(thread.id)
    assert.equal(updated?.sort_order, 5)
  })

  it('siblings can be ordered by sort_order', async () => {
    const parent = await threads.createThread({ topic: 'Parent' })

    const child1 = await threads.createThread({
      topic: 'Child 1',
      parent_thread_id: parent.id,
      sort_order: 3,
    })
    const child2 = await threads.createThread({
      topic: 'Child 2',
      parent_thread_id: parent.id,
      sort_order: 1,
    })
    const child3 = await threads.createThread({
      topic: 'Child 3',
      parent_thread_id: parent.id,
      sort_order: 2,
    })

    const lineage = await threads.getThreadLineage(parent.id)
    const sorted = lineage.children.sort((a, b) => a.sort_order - b.sort_order)
    assert.deepEqual(sorted.map(c => c.topic), ['Child 2', 'Child 3', 'Child 1'])
  })
})

// ─── Thread Event event_kind Column ─────────────────────────────────

describe('Thread tree: event_kind column', () => {
  it('defaults to "message" when not specified', async () => {
    const thread = await threads.createThread({ topic: 'Events test' })
    const event = await threads.addThreadEvent(thread.id, {
      channel: 'web',
      direction: 'inbound',
      actor: 'user',
      content: 'Hello',
    })
    assert.equal(event.event_kind, 'message')
  })

  it('can be set to "link"', async () => {
    const thread = await threads.createThread({ topic: 'Link event' })
    const event = await threads.addThreadEvent(thread.id, {
      channel: 'system',
      direction: 'outbound',
      actor: 'gigi',
      content: { url: 'https://example.com/pr/1', title: 'PR #1' },
      event_kind: 'link',
    })
    assert.equal(event.event_kind, 'link')
  })

  it('can be set to "note"', async () => {
    const thread = await threads.createThread({ topic: 'Note event' })
    const event = await threads.addThreadEvent(thread.id, {
      channel: 'web',
      direction: 'outbound',
      actor: 'gigi',
      content: 'This is an annotation',
      event_kind: 'note',
    })
    assert.equal(event.event_kind, 'note')
  })

  it('can be set to "event"', async () => {
    const thread = await threads.createThread({ topic: 'System event' })
    const event = await threads.addThreadEvent(thread.id, {
      channel: 'system',
      direction: 'outbound',
      actor: 'system',
      content: 'Thread forked',
      event_kind: 'event',
    })
    assert.equal(event.event_kind, 'event')
  })

  it('can be filtered in getThreadEvents', async () => {
    const thread = await threads.createThread({ topic: 'Filter test' })

    // Add events of different kinds
    await threads.addThreadEvent(thread.id, {
      channel: 'web', direction: 'inbound', actor: 'user',
      content: 'A message', event_kind: 'message',
    })
    await threads.addThreadEvent(thread.id, {
      channel: 'system', direction: 'outbound', actor: 'gigi',
      content: { url: 'https://example.com' }, event_kind: 'link',
    })
    await threads.addThreadEvent(thread.id, {
      channel: 'web', direction: 'outbound', actor: 'gigi',
      content: 'A note', event_kind: 'note',
    })

    // Filter by event_kind
    const links = await threads.getThreadEvents(thread.id, { event_kind: 'link' })
    assert.equal(links.length, 1)
    assert.equal(links[0].event_kind, 'link')

    const messages = await threads.getThreadEvents(thread.id, { event_kind: 'message' })
    assert.equal(messages.length, 1)
    assert.equal(messages[0].event_kind, 'message')

    // All events (no filter)
    const all = await threads.getThreadEvents(thread.id)
    assert.equal(all.length, 3)
  })
})

// ─── Listing with kind filter ───────────────────────────────────────

describe('Thread tree: listThreads with kind filter', () => {
  it('filters threads by kind', async () => {
    await threads.createThread({ topic: 'Chat 1', kind: 'chat' })
    await threads.createThread({ topic: 'Chat 2', kind: 'chat' })
    await threads.createThread({ topic: 'Task 1', kind: 'task' })
    await threads.createThread({ topic: 'System', kind: 'system_log' })

    const chats = await threads.listThreads({ kind: 'chat' })
    assert.equal(chats.length, 2)
    assert.ok(chats.every(t => t.kind === 'chat'))

    const tasks = await threads.listThreads({ kind: 'task' })
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].kind, 'task')

    const logs = await threads.listThreads({ kind: 'system_log' })
    assert.equal(logs.length, 1)
    assert.equal(logs[0].kind, 'system_log')

    // No filter returns all
    const all = await threads.listThreads()
    assert.equal(all.length, 4)
  })
})

// ─── Backward Compatibility ─────────────────────────────────────────

describe('Thread tree: backward compatibility', () => {
  it('existing thread creation without new fields still works', async () => {
    // This mimics the old createThread call with no new fields
    const thread = await threads.createThread({
      topic: 'Legacy thread',
      status: 'paused',
      session_id: 'sess-123',
    })

    assert.ok(thread.id)
    assert.equal(thread.topic, 'Legacy thread')
    assert.equal(thread.status, 'paused')
    assert.equal(thread.kind, 'chat')          // default
    assert.equal(thread.display_name, null)     // default
    assert.equal(thread.sort_order, 0)          // default
  })

  it('existing addThreadEvent without event_kind still works', async () => {
    const thread = await threads.createThread({ topic: 'Legacy events' })
    const event = await threads.addThreadEvent(thread.id, {
      channel: 'web',
      direction: 'inbound',
      actor: 'user',
      content: 'Hello',
      // no event_kind specified
    })

    assert.ok(event.id)
    assert.equal(event.event_kind, 'message')  // default
  })

  it('fork still works with new columns', async () => {
    const source = await threads.createThread({
      topic: 'Source thread',
      kind: 'chat',
      display_name: 'Original',
    })
    await threads.addThreadEvent(source.id, {
      channel: 'web',
      direction: 'inbound',
      actor: 'user',
      content: 'Hello',
    })

    const fork = await threads.forkThread(source.id, { topic: 'Forked' })
    assert.ok(fork.id)
    assert.equal(fork.parent_thread_id, source.id)
    // Forked thread gets default kind (chat), not inherited
    assert.equal(fork.kind, 'chat')
  })
})
