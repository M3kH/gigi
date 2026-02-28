/**
 * Unit tests for lib/api/webhookRouter.ts — routeWebhook with mocked dependencies
 *
 * Tests the main routeWebhook function by mocking store, threads, agent, events,
 * and notification modules. This tests the routing logic, auto-create/close behavior,
 * and thread event recording without any real database or external services.
 */

import assert from 'node:assert/strict'
import { vi, beforeEach, afterEach } from 'vitest'
import { createMockPool } from './helpers/mock-pool'

const mock = createMockPool()

// ─── Mock all dependencies ───────────────────────────────────────────

const mockConversation = {
  id: 'conv-1',
  channel: 'webhook',
  topic: 'Issue #42: Bug',
  status: 'paused',
  tags: ['gigi', 'gigi#42'],
  repo: 'gigi',
  session_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  closed_at: null,
  archived_at: null,
}

const mockThread = {
  id: 'thread-1',
  topic: 'Issue #42: Bug',
  status: 'paused',
  kind: 'chat',
  display_name: null,
  sort_order: 0,
  session_id: null,
  summary: null,
  parent_thread_id: null,
  fork_point_event_id: null,
  conversation_id: 'conv-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  closed_at: null,
  archived_at: null,
  refs: [{ id: 'r1', thread_id: 'thread-1', ref_type: 'issue', repo: 'gigi', number: 42 }],
}

// Mock store module
vi.mock('../lib/core/store', () => ({
  getPool: () => mock.pool,
  createConversation: vi.fn(async () => mockConversation),
  getConversation: vi.fn(async () => mockConversation),
  findByTag: vi.fn(async () => []),
  addMessage: vi.fn(async () => ({ id: 'msg-1' })),
  addTags: vi.fn(async () => {}),
  updateConversation: vi.fn(async () => {}),
  stopThread: vi.fn(async () => {}),
  setSessionId: vi.fn(async () => {}),
  getMessages: vi.fn(async () => []),
}))

// Mock threads module
vi.mock('../lib/core/threads', () => ({
  findThreadByRef: vi.fn(async () => null),
  createThread: vi.fn(async () => mockThread),
  addThreadRef: vi.fn(async () => ({ id: 'r1' })),
  addThreadEvent: vi.fn(async () => ({ id: 'e1' })),
  updateThreadRefStatus: vi.fn(async () => {}),
  updateThreadStatus: vi.fn(async () => {}),
  getThread: vi.fn(async () => mockThread),
  setThreadSession: vi.fn(async () => {}),
}))

// Mock agent
vi.mock('../lib/core/agent', () => ({
  runAgent: vi.fn(async () => ({
    text: 'Agent response',
    toolCalls: [],
    toolResults: {},
    sessionId: 'sess-1',
    usage: null,
  })),
}))

// Mock events
vi.mock('../lib/core/events', () => ({
  emit: vi.fn(),
}))

// Mock webhookNotifier
vi.mock('../lib/api/webhookNotifier', () => ({
  notifyWebhook: vi.fn(async () => {}),
  notifyThreadEvent: vi.fn(async () => {}),
}))

// Mock response-routing
vi.mock('../lib/core/response-routing', () => ({
  determineRouting: vi.fn(() => ({ notify: [], notifyCondition: 'significant' })),
  isSignificantEvent: vi.fn(() => false),
  buildDeliveryMetadata: vi.fn(() => ({ origin: 'webhook', delivered_to: ['webhook'] })),
  getThreadActiveChannels: vi.fn(async () => ['webhook']),
}))

// Import after mocks are set up
import { routeWebhook } from '../lib/api/webhookRouter'
import * as store from '../lib/core/store'
import * as threads from '../lib/core/threads'
import { emit } from '../lib/core/events'
import { notifyWebhook } from '../lib/api/webhookNotifier'

describe('routeWebhook', () => {
  beforeEach(() => {
    mock.reset()
    vi.clearAllMocks()

    // Default: findAllThreadsByRef returns the mock thread via pool.query
    // This is used by the internal findAllThreadsByRef function
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, {
      rows: [{
        ...mockThread,
        refs: undefined, // raw row from DB
      }],
    })
    mock.mockQuery(/SELECT \* FROM thread_refs WHERE thread_id/, {
      rows: mockThread.refs,
    })
  })

  afterEach(() => {
    mock.reset()
    vi.clearAllMocks()
  })

  // ─── Basic routing ─────────────────────────────────────────────────

  it('returns null when no tags or refs can be extracted', async () => {
    const result = await routeWebhook('star', {})
    assert.equal(result, null)
  })

  it('routes issue event to existing conversation via thread_refs', async () => {
    const result = await routeWebhook('issues', {
      action: 'edited',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok(result)
    assert.equal(result!.conversationId, 'conv-1')
    assert.ok(result!.tags.includes('gigi'))
    assert.ok(result!.tags.includes('gigi#42'))
    assert.ok(result!.systemMessage.includes('Issue #42'))
  })

  it('stores webhook as system message', async () => {
    await routeWebhook('issues', {
      action: 'edited',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok((store.addMessage as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    const call = (store.addMessage as ReturnType<typeof vi.fn>).mock.calls[0]
    assert.equal(call[0], 'conv-1') // conversationId
    assert.equal(call[1], 'system') // role
    assert.equal(call[3].message_type, 'webhook')
  })

  it('emits conversation_updated event', async () => {
    await routeWebhook('issues', {
      action: 'edited',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok((emit as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    const emitCall = (emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    assert.equal(emitCall.type, 'conversation_updated')
    assert.equal(emitCall.conversationId, 'conv-1')
  })

  it('fires Telegram notification (fire-and-forget)', async () => {
    await routeWebhook('issues', {
      action: 'edited',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok((notifyWebhook as ReturnType<typeof vi.fn>).mock.calls.length > 0)
  })

  // ─── Auto-create ───────────────────────────────────────────────────

  it('auto-creates conversation for newly opened issues', async () => {
    // No existing thread for this ref
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })
    ;(threads.findThreadByRef as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    // findByTag also returns empty (no tag-based match)
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await routeWebhook('issues', {
      action: 'opened',
      repository: { name: 'gigi' },
      issue: { number: 99, title: 'New issue', html_url: 'http://localhost/99', user: { login: 'bob' } },
      sender: { login: 'bob' },
    })

    assert.ok(result)
    // Should have called createConversation
    assert.ok((store.createConversation as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    // Should have created a thread
    assert.ok((threads.createThread as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    // Should have added thread refs
    assert.ok((threads.addThreadRef as ReturnType<typeof vi.fn>).mock.calls.length > 0)
  })

  it('auto-creates conversation for newly opened PRs', async () => {
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })
    ;(threads.findThreadByRef as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await routeWebhook('pull_request', {
      action: 'opened',
      number: 50,
      repository: { name: 'gigi' },
      pull_request: {
        number: 50,
        title: 'New PR',
        html_url: 'http://localhost/pr/50',
        user: { login: 'carol' },
        head: { ref: 'feat/x' },
        base: { ref: 'main' },
      },
      sender: { login: 'carol' },
    })

    assert.ok(result)
    assert.ok((store.createConversation as ReturnType<typeof vi.fn>).mock.calls.length > 0)
  })

  it('does NOT auto-create for comment events', async () => {
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await routeWebhook('issue_comment', {
      action: 'created',
      repository: { name: 'gigi' },
      issue: { number: 99 },
      comment: { body: 'LGTM', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    // No conversation found and not auto-creatable
    assert.equal(result, null)
  })

  // ─── Auto-close ────────────────────────────────────────────────────

  it('auto-stops conversation when issue is closed', async () => {
    const result = await routeWebhook('issues', {
      action: 'closed',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok(result)
    assert.ok((store.stopThread as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    assert.ok((threads.updateThreadStatus as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    assert.deepEqual(
      (threads.updateThreadStatus as ReturnType<typeof vi.fn>).mock.calls[0],
      ['thread-1', 'stopped']
    )
  })

  it('auto-stops conversation when PR is merged', async () => {
    const result = await routeWebhook('pull_request', {
      action: 'closed',
      number: 42,
      repository: { name: 'gigi' },
      pull_request: {
        number: 42,
        title: 'Feature',
        merged: true,
        html_url: 'http://localhost/pr/42',
        user: { login: 'bob' },
        head: { ref: 'feat' },
        base: { ref: 'main' },
      },
      sender: { login: 'bob' },
    })

    assert.ok(result)
    assert.ok((store.stopThread as ReturnType<typeof vi.fn>).mock.calls.length > 0)
  })

  it('does NOT auto-stop already stopped conversation', async () => {
    // Override mock to return stopped conversation
    const stoppedConv = { ...mockConversation, status: 'stopped' }
    ;(store.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue(stoppedConv)

    await routeWebhook('issues', {
      action: 'closed',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    // stopThread should NOT be called since conv is already stopped
    assert.equal((store.stopThread as ReturnType<typeof vi.fn>).mock.calls.length, 0)
  })

  // ─── Ref status updates ────────────────────────────────────────────

  it('updates thread ref status when issue is closed', async () => {
    await routeWebhook('issues', {
      action: 'closed',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok((threads.updateThreadRefStatus as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    assert.deepEqual(
      (threads.updateThreadRefStatus as ReturnType<typeof vi.fn>).mock.calls[0],
      ['gigi', 'issue', 42, 'closed']
    )
  })

  it('updates thread ref status to merged when PR is merged', async () => {
    await routeWebhook('pull_request', {
      action: 'closed',
      number: 42,
      repository: { name: 'gigi' },
      pull_request: {
        number: 42,
        title: 'Feature',
        merged: true,
        html_url: 'http://localhost/pr/42',
        user: { login: 'bob' },
        head: { ref: 'feat' },
        base: { ref: 'main' },
      },
      sender: { login: 'bob' },
    })

    assert.ok((threads.updateThreadRefStatus as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    const refCall = (threads.updateThreadRefStatus as ReturnType<typeof vi.fn>).mock.calls[0]
    assert.equal(refCall[3], 'merged')
  })

  // ─── Thread event recording ────────────────────────────────────────

  it('records webhook event in thread events', async () => {
    await routeWebhook('issues', {
      action: 'edited',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok((threads.addThreadEvent as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    const eventCall = (threads.addThreadEvent as ReturnType<typeof vi.fn>).mock.calls[0]
    assert.equal(eventCall[0], 'thread-1')
    assert.equal(eventCall[1].channel, 'webhook')
    assert.equal(eventCall[1].direction, 'inbound')
    assert.equal(eventCall[1].actor, 'alice')
    assert.equal(eventCall[1].message_type, 'webhook')
  })

  // ─── @gigi mention auto-create ─────────────────────────────────────

  it('auto-creates conversation when @gigi is mentioned on untracked issue', async () => {
    // No existing thread for this ref
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })
    ;(threads.findThreadByRef as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await routeWebhook('issue_comment', {
      action: 'created',
      repository: { name: 'gigi' },
      issue: { number: 77, title: 'Old issue' },
      comment: { body: 'Hey @gigi can you fix this?', user: { login: 'dave' } },
      sender: { login: 'dave' },
    })

    assert.ok(result)
    // Should have created conversation for the @gigi mention
    assert.ok((store.createConversation as ReturnType<typeof vi.fn>).mock.calls.length > 0)
  })

  it('does NOT auto-create for @gigi mention by gigi itself', async () => {
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await routeWebhook('issue_comment', {
      action: 'created',
      repository: { name: 'gigi' },
      issue: { number: 77 },
      comment: { body: 'I fixed it @gigi', user: { login: 'gigi' } },
      sender: { login: 'gigi' },
    })

    assert.equal(result, null)
  })

  // ─── Push event routing ────────────────────────────────────────────

  it('returns null for push events (no refs, only repo tag)', async () => {
    // Push events only get a repo tag, no issue/PR refs
    // findByTag returns nothing
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await routeWebhook('push', {
      ref: 'refs/heads/main',
      repository: { name: 'gigi' },
      pusher: { login: 'dave' },
      commits: [{ message: 'feat: something' }],
    })

    // Push has tags but no matching conversation → null
    assert.equal(result, null)
  })

  // ─── Tag-based fallback ────────────────────────────────────────────

  it('falls back to tag-based lookup when no thread ref match', async () => {
    // No thread_refs match
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })

    // Tag-based lookup finds a conversation
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockImplementation(async (tag: string) => {
      if (tag === 'gigi#42') {
        return [{ ...mockConversation, status: 'paused' }]
      }
      return []
    })

    // Thread lookup for conversation_id (used in findConversation fallback)
    mock.mockQuery(/SELECT id FROM threads WHERE conversation_id/, {
      rows: [{ id: 'thread-1' }],
    })

    const result = await routeWebhook('issues', {
      action: 'edited',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok(result)
    assert.equal(result!.conversationId, 'conv-1')
  })

  // ─── Dedup behavior ────────────────────────────────────────────────

  it('reuses existing thread when auto-creating would duplicate', async () => {
    // No thread found in findAllThreadsByRef (used by findConversation)
    mock.mockQuery(/SELECT t\.\* FROM threads t.*JOIN thread_refs/, { rows: [] })
    ;(store.findByTag as ReturnType<typeof vi.fn>).mockResolvedValue([])

    // But findThreadByRef (used inside createForWebhook dedup check) finds one
    ;(threads.findThreadByRef as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockThread,
      conversation_id: 'conv-1',
    })
    ;(store.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue(mockConversation)

    const result = await routeWebhook('issues', {
      action: 'opened',
      repository: { name: 'gigi' },
      issue: { number: 42, title: 'Bug', html_url: 'http://localhost/42', user: { login: 'alice' } },
      sender: { login: 'alice' },
    })

    assert.ok(result)
    // Should NOT have called createConversation (reused existing)
    assert.equal((store.createConversation as ReturnType<typeof vi.fn>).mock.calls.length, 0)
  })
})
