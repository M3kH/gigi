/**
 * Integration Test: Store — Database operations with real Postgres
 *
 * Tests conversation and message CRUD, tag operations, and usage tracking
 * against a real Postgres database with per-test isolation via truncation.
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  connectTestDB,
  disconnectTestDB,
  truncateAll,
  createTestThread,
  createMultiChannelThread,
  assertThreadEvents,
  assertThreadTags,
  assertThreadStatus,
  simulateWebMessage,
} from './index'
import * as store from '../../lib/core/store'

// ─── Suite Setup ────────────────────────────────────────────────────

before(async () => {
  await connectTestDB()
})

after(async () => {
  await disconnectTestDB()
})

beforeEach(async () => {
  await truncateAll()
})

// ─── Tests ──────────────────────────────────────────────────────────

describe('Store Integration: Conversations', () => {
  it('should create and retrieve a conversation', async () => {
    const conv = await store.createConversation('test', 'My Topic')
    assert.ok(conv.id)
    assert.equal(conv.channel, 'test')
    assert.equal(conv.topic, 'My Topic')
    assert.equal(conv.status, 'open')

    const fetched = await store.getConversation(conv.id)
    assert.ok(fetched)
    assert.equal(fetched.id, conv.id)
    assert.equal(fetched.topic, 'My Topic')
  })

  it('should list conversations with preview and usage', async () => {
    const conv = await store.createConversation('web', 'Chat 1')
    await store.addMessage(conv.id, 'user', [{ type: 'text', text: 'Hello world' }])
    await store.addMessage(conv.id, 'assistant', [{ type: 'text', text: 'Hi there!' }], {
      usage: { inputTokens: 100, outputTokens: 50, costUSD: 0.002 },
    })

    const list = await store.listConversations('web')
    assert.ok(list.length >= 1)
    const found = list.find(c => c.id === conv.id)
    assert.ok(found)
    assert.ok(found.last_message_preview?.includes('Hi there'))
  })

  it('should update conversation fields', async () => {
    const conv = await store.createConversation('test', null)
    await store.updateConversation(conv.id, {
      topic: 'Updated Topic',
      status: 'active',
      repo: 'gigi',
    })

    const updated = await store.getConversation(conv.id)
    assert.equal(updated?.topic, 'Updated Topic')
    assert.equal(updated?.status, 'active')
    assert.equal(updated?.repo, 'gigi')
  })

  it('should close and archive conversations', async () => {
    const conv = await store.createConversation('test', 'To close')

    await store.closeConversation(conv.id)
    let fetched = await store.getConversation(conv.id)
    assert.equal(fetched?.status, 'closed')
    assert.ok(fetched?.closed_at)

    await store.archiveConversation(conv.id)
    fetched = await store.getConversation(conv.id)
    assert.ok(fetched?.archived_at)

    await store.unarchiveConversation(conv.id)
    fetched = await store.getConversation(conv.id)
    assert.equal(fetched?.archived_at, null)
  })

  it('should manage tags with deduplication', async () => {
    const conv = await store.createConversation('test', 'Tagged')
    await store.addTags(conv.id, ['gigi', 'gigi#42'])
    await store.addTags(conv.id, ['gigi', 'pr#42']) // 'gigi' should deduplicate

    const fetched = await store.getConversation(conv.id)
    assert.ok(fetched?.tags.includes('gigi'))
    assert.ok(fetched?.tags.includes('gigi#42'))
    assert.ok(fetched?.tags.includes('pr#42'))
    // 'gigi' should only appear once
    assert.equal(fetched?.tags.filter(t => t === 'gigi').length, 1)
  })

  it('should find conversations by tag', async () => {
    const conv = await store.createConversation('test', 'Findable')
    await store.addTags(conv.id, ['myrepo#99'])

    const found = await store.findByTag('myrepo#99')
    assert.ok(found.length >= 1)
    assert.ok(found.some(c => c.id === conv.id))
  })
})

describe('Store Integration: Messages', () => {
  it('should add and retrieve messages in order', async () => {
    const conv = await store.createConversation('test', 'Messages')
    await store.addMessage(conv.id, 'user', [{ type: 'text', text: 'First' }])
    await store.addMessage(conv.id, 'assistant', [{ type: 'text', text: 'Second' }])
    await store.addMessage(conv.id, 'user', [{ type: 'text', text: 'Third' }])

    const messages = await store.getMessages(conv.id)
    assert.equal(messages.length, 3)
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[2].role, 'user')
  })

  it('should store tool calls and usage metadata', async () => {
    const conv = await store.createConversation('test', 'Tools')
    await store.addMessage(conv.id, 'assistant', [{ type: 'text', text: 'Using tools' }], {
      tool_calls: [{ name: 'Bash', input: { command: 'ls' } }],
      tool_outputs: [{ result: 'file1\nfile2' }],
      usage: { inputTokens: 500, outputTokens: 200, costUSD: 0.01 },
    })

    const messages = await store.getMessages(conv.id)
    assert.equal(messages.length, 1)
    assert.ok(messages[0].tool_calls)
    assert.ok(messages[0].usage)
  })

  it('should handle JSONB content types correctly', async () => {
    const conv = await store.createConversation('test', 'JSONB')

    // String content
    await store.addMessage(conv.id, 'user', 'Simple string')

    // Array content (standard format)
    await store.addMessage(conv.id, 'assistant', [
      { type: 'text', text: 'Part 1' },
      { type: 'text', text: 'Part 2' },
    ])

    const messages = await store.getMessages(conv.id)
    assert.equal(messages.length, 2)
  })
})

describe('Store Integration: Sessions', () => {
  it('should manage session IDs', async () => {
    const conv = await store.createConversation('test', 'Session')
    assert.equal(await store.getSessionId(conv.id), null)

    await store.setSessionId(conv.id, 'session-abc-123')
    assert.equal(await store.getSessionId(conv.id), 'session-abc-123')

    // Setting session should change status to active
    const fetched = await store.getConversation(conv.id)
    assert.equal(fetched?.status, 'active')

    await store.clearSessionId(conv.id)
    assert.equal(await store.getSessionId(conv.id), null)

    const cleared = await store.getConversation(conv.id)
    assert.equal(cleared?.status, 'open')
  })
})

describe('Store Integration: Usage Analytics', () => {
  it('should calculate conversation usage', async () => {
    const conv = await store.createConversation('test', 'Usage')
    await store.addMessage(conv.id, 'assistant', 'Response 1', {
      usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.002 },
    })
    await store.addMessage(conv.id, 'assistant', 'Response 2', {
      usage: { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 50, cacheCreationInputTokens: 0, costUSD: 0.005 },
    })

    const usage = await store.getConversationUsage(conv.id)
    assert.equal(Number(usage.input_tokens), 300)
    assert.equal(Number(usage.output_tokens), 150)
    assert.equal(Number(usage.cache_read_tokens), 50)
    assert.equal(Number(usage.total_cost), 0.007)
    assert.equal(Number(usage.messages_with_usage), 2)
  })
})

describe('Store Integration: Multi-Channel Thread', () => {
  it('should create a thread with events from 3 channels and read them back', async () => {
    const { conversation, messages } = await createMultiChannelThread({
      repo: 'gigi',
      issueNumber: 38,
      topic: 'Integration test infra',
    })

    // Verify conversation
    assert.equal(conversation.channel, 'webhook')
    assert.equal(conversation.repo, 'gigi')

    // Verify tags
    await assertThreadTags(conversation.id, ['gigi', 'gigi#38'])

    // Verify 3 messages from different "channels"
    assert.equal(messages.length, 3)
    await assertThreadEvents(conversation.id, [
      { role: 'system', textContains: 'Issue #38 opened' },
      { role: 'user', textContains: 'issue #38' },
      { role: 'assistant', textContains: 'investigate' },
    ])

    // Add another message (simulating web chat continuation)
    await simulateWebMessage(conversation.id, 'Any updates?')

    const allMessages = await store.getMessages(conversation.id)
    assert.equal(allMessages.length, 4)

    // Verify status
    await assertThreadStatus(conversation.id, 'open')
  })

  it('should find thread by tag and continue the conversation', async () => {
    const { conversation } = await createMultiChannelThread({
      repo: 'org-press',
      issueNumber: 7,
    })

    // Find by specific issue tag
    const found = await store.findByTag('org-press#7')
    assert.ok(found.length >= 1)
    assert.ok(found.some(c => c.id === conversation.id))

    // Find by repo tag
    const byRepo = await store.findByTag('org-press')
    assert.ok(byRepo.some(c => c.id === conversation.id))
  })
})

describe('Store Integration: Action Log', () => {
  it('should log and check recent actions for deduplication', async () => {
    await store.logAction('create_issue', 'gigi', '42', { title: 'Test' })

    const recent = await store.checkRecentAction('create_issue', 'gigi', '42')
    assert.equal(recent, true)

    const notRecent = await store.checkRecentAction('create_pr', 'gigi', '42')
    assert.equal(notRecent, false)
  })
})
