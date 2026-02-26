/**
 * Integration Test: Events — Event bus, collector, and agent stub
 *
 * Tests the event bus pub-sub system, event collection for assertions,
 * and the agent stub's event emission behavior.
 */

import assert from 'node:assert/strict'
import {
  connectTestDB,
  disconnectTestDB,
  truncateAll,
  EventCollector,
  createAgentStub,
  createSimpleStub,
  createToolStub,
  collectEvents,
  createTestThread,
} from './index'
import * as store from '../../lib/core/store'
import { emit, subscribe } from '../../lib/core/events'

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

// ─── Tests ──────────────────────────────────────────────────────────

describe('Event Bus', () => {
  it('should broadcast events to subscribers', () => {
    const received: Array<Record<string, unknown>> = []
    const unsub = subscribe((event) => received.push(event))

    emit({ type: 'test_event', data: 'hello' })
    emit({ type: 'another_event', value: 42 })

    assert.equal(received.length, 2)
    assert.equal(received[0].type, 'test_event')
    assert.equal(received[1].type, 'another_event')

    unsub()
  })

  it('should stop receiving after unsubscribe', () => {
    const received: Array<Record<string, unknown>> = []
    const unsub = subscribe((event) => received.push(event))

    emit({ type: 'before' })
    unsub()
    emit({ type: 'after' })

    assert.equal(received.length, 1)
    assert.equal(received[0].type, 'before')
  })

  it('should support multiple subscribers', () => {
    const a: string[] = []
    const b: string[] = []
    const unsub1 = subscribe((e) => a.push(e.type))
    const unsub2 = subscribe((e) => b.push(e.type))

    emit({ type: 'shared_event' })

    assert.deepEqual(a, ['shared_event'])
    assert.deepEqual(b, ['shared_event'])

    unsub1()
    unsub2()
  })
})

describe('EventCollector', () => {
  it('should collect events pushed to it', () => {
    const collector = new EventCollector()
    collector.push({ type: 'agent_start', conversationId: 'c1' })
    collector.push({ type: 'text_chunk', conversationId: 'c1', text: 'Hello' })
    collector.push({ type: 'agent_done', conversationId: 'c1' })

    const events = collector.getEvents()
    assert.equal(events.length, 3)
    assert.equal(events[0].type, 'agent_start')
    assert.equal(events[2].type, 'agent_done')
  })

  it('should filter events by type', () => {
    const collector = new EventCollector()
    collector.push({ type: 'text_chunk', text: 'a' })
    collector.push({ type: 'tool_use', name: 'Bash' })
    collector.push({ type: 'text_chunk', text: 'b' })

    const textChunks = collector.getEventsByType('text_chunk')
    assert.equal(textChunks.length, 2)
  })

  it('should assert event sequences', () => {
    const collector = new EventCollector()
    collector.push({ type: 'agent_start' })
    collector.push({ type: 'text_chunk', text: 'hello' })
    collector.push({ type: 'tool_use', name: 'Bash' })
    collector.push({ type: 'tool_result', result: 'ok' })
    collector.push({ type: 'agent_done' })

    // This should not throw
    collector.assertSequence(['agent_start', 'text_chunk', 'tool_use', 'agent_done'])
  })

  it('should throw on incorrect sequence', () => {
    const collector = new EventCollector()
    collector.push({ type: 'agent_start' })
    collector.push({ type: 'agent_done' })

    assert.throws(() => {
      collector.assertSequence(['agent_start', 'text_chunk', 'agent_done'])
    }, /Expected "text_chunk"/)
  })

  it('should integrate with the event bus via collectEvents helper', async () => {
    const { collector, unsubscribe } = await collectEvents()

    emit({ type: 'agent_start', conversationId: 'test-conv' })
    emit({ type: 'text_chunk', conversationId: 'test-conv', text: 'working...' })
    emit({ type: 'agent_done', conversationId: 'test-conv' })

    collector.assertSequence(['agent_start', 'text_chunk', 'agent_done'])
    assert.equal(collector.getEvents().length, 3)

    unsubscribe()
  })
})

describe('Agent Stub', () => {
  it('should return default response', async () => {
    const stub = createSimpleStub('I handled it!')
    const runner = stub.getRunner()

    const result = await runner([
      { role: 'user', content: [{ type: 'text', text: 'Do something' }] },
    ])

    assert.equal(result.text, 'I handled it!')
    assert.ok(result.sessionId)
    assert.equal(result.stopReason, 'end_turn')
    assert.equal(stub.getCallCount(), 1)
  })

  it('should match patterns and return appropriate responses', async () => {
    const stub = createAgentStub()
      .when('hello').respond({ text: 'Hi there!' })
      .when(/fix.*bug/i).respond({ text: 'Bug fixed!' })
      .setDefault('Unknown command')

    const runner = stub.getRunner()

    const r1 = await runner([{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }])
    assert.equal(r1.text, 'Hi there!')

    const r2 = await runner([{ role: 'user', content: [{ type: 'text', text: 'Please fix the bug' }] }])
    assert.equal(r2.text, 'Bug fixed!')

    const r3 = await runner([{ role: 'user', content: [{ type: 'text', text: 'random stuff' }] }])
    assert.equal(r3.text, 'Unknown command')

    assert.equal(stub.getCallCount(), 3)
  })

  it('should emit events when callback is provided', async () => {
    const stub = createToolStub('Bash', { command: 'ls' }, 'file1\nfile2')
    const runner = stub.getRunner()
    const collector = new EventCollector()

    await runner(
      [{ role: 'user', content: [{ type: 'text', text: 'list files' }] }],
      collector.listener()
    )

    collector.assertSequence(['agent_start', 'text_chunk', 'tool_use', 'tool_result', 'agent_done'])

    const toolEvents = collector.getEventsByType('tool_use')
    assert.equal(toolEvents.length, 1)
    assert.equal(toolEvents[0].name, 'Bash')
  })

  it('should record call history', async () => {
    const stub = createAgentStub().setDefault('ok')
    const runner = stub.getRunner()

    await runner([{ role: 'user', content: [{ type: 'text', text: 'first' }] }])
    await runner([{ role: 'user', content: [{ type: 'text', text: 'second' }] }], null, { sessionId: 'abc' })

    const calls = stub.getCalls()
    assert.equal(calls.length, 2)
    assert.equal(calls[1].options?.sessionId, 'abc')

    const last = stub.getLastCall()
    assert.ok(last)
    assert.equal(last.options?.sessionId, 'abc')
  })

  it('should reset call history and patterns', async () => {
    const stub = createAgentStub()
      .when('test').respond({ text: 'matched' })
      .setDefault('default')

    const runner = stub.getRunner()
    await runner([{ role: 'user', content: [{ type: 'text', text: 'test' }] }])

    assert.equal(stub.getCallCount(), 1)

    stub.reset()
    assert.equal(stub.getCallCount(), 0)

    // Patterns should still work after reset()
    const r = await runner([{ role: 'user', content: [{ type: 'text', text: 'test' }] }])
    assert.equal(r.text, 'matched')

    // resetAll clears patterns too
    stub.resetAll()
    const r2 = await stub.getRunner()([{ role: 'user', content: [{ type: 'text', text: 'test' }] }])
    assert.equal(r2.text, 'Stub response') // back to global default
  })
})

describe('End-to-End: Event flow with thread creation', () => {
  it('should create a thread, emit events, and verify the full flow', async () => {
    const { collector, unsubscribe } = await collectEvents()

    // Create a thread with stored messages
    const { conversation } = await createTestThread({
      topic: 'E2E test',
      tags: ['gigi', 'gigi#100'],
      events: [
        { channel: 'webhook', role: 'system', text: 'Issue opened', messageType: 'webhook' },
        { channel: 'web', role: 'user', text: 'Work on this', messageType: 'text' },
      ],
    })

    // Simulate agent processing via events
    emit({ type: 'agent_start', conversationId: conversation.id })
    emit({ type: 'text_chunk', conversationId: conversation.id, text: 'Working on it...' })
    emit({ type: 'agent_done', conversationId: conversation.id, cost: 0.005, duration: 1500, turns: 3, isError: false, usage: null })

    // Store agent response
    await store.addMessage(conversation.id, 'assistant', [{ type: 'text', text: 'Done!' }], {
      usage: { inputTokens: 300, outputTokens: 100, costUSD: 0.005 },
    })

    // Verify events
    collector.assertSequence(['agent_start', 'text_chunk', 'agent_done'])

    // Verify stored data
    const messages = await store.getMessages(conversation.id)
    assert.equal(messages.length, 3) // system + user + assistant
    assert.equal(messages[2].role, 'assistant')

    // Verify usage
    const usage = await store.getConversationUsage(conversation.id)
    assert.equal(Number(usage.total_cost), 0.005)

    unsubscribe()
  })
})
