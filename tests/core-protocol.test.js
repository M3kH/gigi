import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ClientMessageSchema,
  ServerMessageSchema,
  ChatSendSchema,
  ChatStopSchema,
  ViewNavigateSchema,
  ConversationSelectSchema,
  AgentStartSchema,
  TextChunkSchema,
  ToolUseSchema,
  ToolResultSchema,
  ToolProgressSchema,
  AgentDoneSchema,
  AgentErrorSchema,
  AgentStoppedSchema,
  ConversationUpdateSchema,
  ServerTitleUpdateSchema,
  ViewCommandSchema,
  ConversationListSchema,
  MessageHistorySchema,
  PongSchema,
} from '../lib/core-protocol/index.ts'

// ---------------------------------------------------------------------------
// Client messages
// ---------------------------------------------------------------------------

describe('ClientMessage schema', () => {
  it('parses chat.send with all fields', () => {
    const msg = { type: 'chat.send', message: 'hello', conversationId: 1, projectId: 2 }
    const parsed = ClientMessageSchema.parse(msg)
    assert.equal(parsed.type, 'chat.send')
    assert.equal(parsed.message, 'hello')
    assert.equal(parsed.conversationId, 1)
    assert.equal(parsed.projectId, 2)
  })

  it('parses chat.send with only required fields', () => {
    const msg = { type: 'chat.send', message: 'hi' }
    const parsed = ClientMessageSchema.parse(msg)
    assert.equal(parsed.type, 'chat.send')
    assert.equal(parsed.conversationId, undefined)
  })

  it('rejects chat.send with empty message', () => {
    const msg = { type: 'chat.send', message: '' }
    const result = ClientMessageSchema.safeParse(msg)
    assert.equal(result.success, false)
  })

  it('parses chat.stop', () => {
    const msg = { type: 'chat.stop', conversationId: 42 }
    const parsed = ClientMessageSchema.parse(msg)
    assert.equal(parsed.type, 'chat.stop')
    assert.equal(parsed.conversationId, 42)
  })

  it('rejects chat.stop without conversationId', () => {
    const result = ClientMessageSchema.safeParse({ type: 'chat.stop' })
    assert.equal(result.success, false)
  })

  it('parses view.navigate with target only', () => {
    const msg = { type: 'view.navigate', target: 'kanban' }
    const parsed = ClientMessageSchema.parse(msg)
    assert.equal(parsed.type, 'view.navigate')
    assert.equal(parsed.target, 'kanban')
  })

  it('parses view.navigate with id and path', () => {
    const msg = { type: 'view.navigate', target: 'issue', id: 48, path: '/details' }
    const parsed = ClientMessageSchema.parse(msg)
    assert.equal(parsed.id, 48)
    assert.equal(parsed.path, '/details')
  })

  it('rejects view.navigate with invalid target', () => {
    const result = ClientMessageSchema.safeParse({ type: 'view.navigate', target: 'unknown' })
    assert.equal(result.success, false)
  })

  it('parses conversation.select', () => {
    const parsed = ClientMessageSchema.parse({ type: 'conversation.select', conversationId: 5 })
    assert.equal(parsed.type, 'conversation.select')
  })

  it('parses title.update', () => {
    const parsed = ClientMessageSchema.parse({ type: 'title.update', conversationId: 1, title: 'New title' })
    assert.equal(parsed.type, 'title.update')
    assert.equal(parsed.title, 'New title')
  })

  it('parses ping', () => {
    const parsed = ClientMessageSchema.parse({ type: 'ping' })
    assert.equal(parsed.type, 'ping')
  })

  it('rejects unknown message type', () => {
    const result = ClientMessageSchema.safeParse({ type: 'unknown.action' })
    assert.equal(result.success, false)
  })

  it('rejects non-object input', () => {
    assert.equal(ClientMessageSchema.safeParse('string').success, false)
    assert.equal(ClientMessageSchema.safeParse(42).success, false)
    assert.equal(ClientMessageSchema.safeParse(null).success, false)
  })
})

// ---------------------------------------------------------------------------
// Server messages
// ---------------------------------------------------------------------------

describe('ServerMessage schema', () => {
  it('parses agent.start', () => {
    const parsed = ServerMessageSchema.parse({ type: 'agent.start', conversationId: 1 })
    assert.equal(parsed.type, 'agent.start')
  })

  it('parses agent.chunk', () => {
    const parsed = ServerMessageSchema.parse({ type: 'agent.chunk', conversationId: 1, text: 'hello' })
    assert.equal(parsed.type, 'agent.chunk')
    assert.equal(parsed.text, 'hello')
  })

  it('parses tool.use', () => {
    const msg = {
      type: 'tool.use',
      conversationId: 1,
      toolName: 'bash',
      toolId: 'tool-123',
      input: { command: 'ls' },
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.type, 'tool.use')
    assert.equal(parsed.toolName, 'bash')
    assert.deepEqual(parsed.input, { command: 'ls' })
  })

  it('parses tool.result', () => {
    const msg = {
      type: 'tool.result',
      conversationId: 1,
      toolId: 'tool-123',
      output: 'file1.txt\nfile2.txt',
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.type, 'tool.result')
    assert.equal(parsed.isError, undefined)
  })

  it('parses tool.result with isError', () => {
    const msg = {
      type: 'tool.result',
      conversationId: 1,
      toolId: 'tool-123',
      output: 'permission denied',
      isError: true,
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.isError, true)
  })

  it('parses tool.progress', () => {
    const msg = {
      type: 'tool.progress',
      conversationId: 1,
      toolId: 'tool-123',
      progress: 0.5,
      message: 'Processing...',
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.type, 'tool.progress')
    assert.equal(parsed.progress, 0.5)
  })

  it('rejects tool.progress with progress > 1', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'tool.progress',
      conversationId: 1,
      toolId: 'tool-123',
      progress: 1.5,
    })
    assert.equal(result.success, false)
  })

  it('parses agent.done with usage', () => {
    const msg = {
      type: 'agent.done',
      conversationId: 1,
      text: 'Done!',
      usage: { inputTokens: 100, outputTokens: 50 },
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.type, 'agent.done')
    assert.equal(parsed.usage.inputTokens, 100)
  })

  it('parses agent.done without usage', () => {
    const parsed = ServerMessageSchema.parse({ type: 'agent.done', conversationId: 1, text: 'Done' })
    assert.equal(parsed.usage, undefined)
  })

  it('parses agent.error', () => {
    const parsed = ServerMessageSchema.parse({ type: 'agent.error', conversationId: 1, error: 'Out of memory' })
    assert.equal(parsed.type, 'agent.error')
    assert.equal(parsed.error, 'Out of memory')
  })

  it('parses agent.stopped', () => {
    const parsed = ServerMessageSchema.parse({ type: 'agent.stopped', conversationId: 1 })
    assert.equal(parsed.type, 'agent.stopped')
  })

  it('parses conversation.update', () => {
    const msg = {
      type: 'conversation.update',
      conversation: { id: 1, title: 'Chat', updatedAt: '2026-02-14T00:00:00Z' },
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.type, 'conversation.update')
    assert.equal(parsed.conversation.title, 'Chat')
  })

  it('parses title.update', () => {
    const parsed = ServerMessageSchema.parse({ type: 'title.update', conversationId: 1, title: 'Updated' })
    assert.equal(parsed.type, 'title.update')
    assert.equal(parsed.title, 'Updated')
  })

  it('parses view.command', () => {
    const parsed = ServerMessageSchema.parse({ type: 'view.command', target: 'kanban', id: 2 })
    assert.equal(parsed.type, 'view.command')
    assert.equal(parsed.target, 'kanban')
  })

  it('parses conversation.list', () => {
    const msg = {
      type: 'conversation.list',
      conversations: [
        { id: 1, title: 'First', updatedAt: '2026-02-14T00:00:00Z' },
        { id: 2, title: 'Second', updatedAt: '2026-02-14T01:00:00Z' },
      ],
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.type, 'conversation.list')
    assert.equal(parsed.conversations.length, 2)
  })

  it('parses message.history', () => {
    const msg = {
      type: 'message.history',
      conversationId: 1,
      messages: [
        { id: 1, role: 'user', content: 'Hello', createdAt: '2026-02-14T00:00:00Z' },
        { id: 2, role: 'assistant', content: 'Hi!', createdAt: '2026-02-14T00:00:01Z' },
      ],
    }
    const parsed = ServerMessageSchema.parse(msg)
    assert.equal(parsed.type, 'message.history')
    assert.equal(parsed.messages.length, 2)
    assert.equal(parsed.messages[0].role, 'user')
  })

  it('rejects message.history with invalid role', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'message.history',
      conversationId: 1,
      messages: [{ id: 1, role: 'system', content: 'nope', createdAt: '2026-02-14T00:00:00Z' }],
    })
    assert.equal(result.success, false)
  })

  it('parses pong', () => {
    const parsed = ServerMessageSchema.parse({ type: 'pong' })
    assert.equal(parsed.type, 'pong')
  })

  it('rejects unknown message type', () => {
    const result = ServerMessageSchema.safeParse({ type: 'unknown.event' })
    assert.equal(result.success, false)
  })
})

// ---------------------------------------------------------------------------
// Type narrowing via discriminated union
// ---------------------------------------------------------------------------

describe('Type narrowing', () => {
  it('narrows ClientMessage by type field', () => {
    const msg = ClientMessageSchema.parse({ type: 'chat.send', message: 'hello' })
    if (msg.type === 'chat.send') {
      // TypeScript would narrow this to ChatSend — we verify the field exists
      assert.equal(typeof msg.message, 'string')
    } else {
      assert.fail('Should have narrowed to chat.send')
    }
  })

  it('narrows ServerMessage by type field', () => {
    const msg = ServerMessageSchema.parse({ type: 'tool.use', conversationId: 1, toolName: 'bash', toolId: 'x', input: {} })
    if (msg.type === 'tool.use') {
      assert.equal(typeof msg.toolName, 'string')
      assert.equal(typeof msg.toolId, 'string')
    } else {
      assert.fail('Should have narrowed to tool.use')
    }
  })

  it('narrows to conversation.list and accesses array', () => {
    const msg = ServerMessageSchema.parse({
      type: 'conversation.list',
      conversations: [{ id: 1, title: 'Test', updatedAt: '2026-02-14T00:00:00Z' }],
    })
    if (msg.type === 'conversation.list') {
      assert.equal(msg.conversations[0].id, 1)
    } else {
      assert.fail('Should have narrowed to conversation.list')
    }
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parse → serialize → parse
// ---------------------------------------------------------------------------

describe('Round-trip serialization', () => {
  const clientMessages = [
    { type: 'chat.send', message: 'hello', conversationId: 1 },
    { type: 'chat.stop', conversationId: 42 },
    { type: 'view.navigate', target: 'kanban' },
    { type: 'conversation.select', conversationId: 5 },
    { type: 'title.update', conversationId: 1, title: 'New' },
    { type: 'ping' },
  ]

  for (const msg of clientMessages) {
    it(`round-trips client ${msg.type}`, () => {
      const parsed = ClientMessageSchema.parse(msg)
      const json = JSON.stringify(parsed)
      const reparsed = ClientMessageSchema.parse(JSON.parse(json))
      assert.deepEqual(parsed, reparsed)
    })
  }

  const serverMessages = [
    { type: 'agent.start', conversationId: 1 },
    { type: 'agent.chunk', conversationId: 1, text: 'hi' },
    { type: 'agent.done', conversationId: 1, text: 'done' },
    { type: 'agent.error', conversationId: 1, error: 'oops' },
    { type: 'agent.stopped', conversationId: 1 },
    { type: 'tool.use', conversationId: 1, toolName: 'bash', toolId: 'x', input: { cmd: 'ls' } },
    { type: 'tool.result', conversationId: 1, toolId: 'x', output: 'ok' },
    { type: 'tool.progress', conversationId: 1, toolId: 'x', progress: 0.7 },
    { type: 'title.update', conversationId: 1, title: 'Updated' },
    { type: 'view.command', target: 'overview' },
    { type: 'conversation.list', conversations: [] },
    { type: 'message.history', conversationId: 1, messages: [] },
    { type: 'pong' },
  ]

  for (const msg of serverMessages) {
    it(`round-trips server ${msg.type}`, () => {
      const parsed = ServerMessageSchema.parse(msg)
      const json = JSON.stringify(parsed)
      const reparsed = ServerMessageSchema.parse(JSON.parse(json))
      assert.deepEqual(parsed, reparsed)
    })
  }
})
