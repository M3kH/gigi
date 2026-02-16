/**
 * ask_user Integration Test
 *
 * Tests the full round-trip of the ask_user feature:
 *
 * 1. HTTP bridge: MCP tool → POST /api/internal/ask-user → blocks until answered
 * 2. Event bus: ask_user event emitted → reaches WS clients
 * 3. WS answer: client sends user:answer → resolves the pending question
 * 4. Simulated agent flow: mock agent emits tool_use → ask_user bridge → answer → agent continues
 *
 * The real Claude SDK query() is NOT called. Instead we simulate the agent's
 * behavior by calling the HTTP bridge directly (what the MCP tool does).
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import { Hono } from 'hono'
import { getRequestListener } from '@hono/node-server'
import { subscribe, emit, type AgentEvent } from '../lib/core/events'
import { askUser, answerQuestion, hasPendingQuestion } from '../lib/core/ask-user'

// ─── Minimal Test Server ────────────────────────────────────────────
//
// We build a minimal Hono app with ONLY the ask-user endpoint and a
// lightweight WS server that forwards events + handles user:answer.
// This avoids needing the full store/router/agent setup.

import { WebSocketServer, type WebSocket as WSType } from 'ws'

interface TestServer {
  port: number
  httpServer: Server
  close: () => Promise<void>
}

const startTestServer = async (): Promise<TestServer> => {
  const app = new Hono()

  // The ask-user HTTP bridge (same as lib/api/web.ts)
  app.post('/api/internal/ask-user', async (c) => {
    const body = await c.req.json<{ questionId: string; question: string; options?: string[] }>()
    const { questionId, question, options } = body

    if (!questionId || !question) {
      return c.json({ error: 'questionId and question are required' }, 400)
    }

    const answer = await askUser(questionId, question, options)
    return c.json({ answer })
  })

  // Start HTTP server using Hono's Node.js adapter
  const listener = getRequestListener(app.fetch)
  const httpServer = createServer(listener)

  // WS server — forwards events to clients, handles user:answer
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<WSType>()

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`)
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws) => {
    // Subscribe to event bus
    const unsub = subscribe((event: AgentEvent) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(event))
      }
    })

    clients.add(ws)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'user:answer') {
          answerQuestion(msg.questionId, msg.answer)
        }
      } catch { /* ignore */ }
    })

    ws.on('close', () => {
      unsub()
      clients.delete(ws)
    })
  })

  // Listen on random port
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const addr = httpServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  return {
    port,
    httpServer,
    close: () => new Promise((resolve) => {
      wss.close()
      httpServer.close(() => resolve())
    }),
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

const connectWS = (port: number): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

const waitForMessage = (ws: WebSocket, predicate: (msg: Record<string, unknown>) => boolean, timeoutMs = 5000): Promise<Record<string, unknown>> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WS message')), timeoutMs)
    const handler = (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString())
        if (predicate(msg)) {
          clearTimeout(timeout)
          ws.removeListener('message', handler)
          resolve(msg)
        }
      } catch { /* ignore non-JSON */ }
    }
    ws.on('message', handler)
  })
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('ask_user Integration — Full Round-Trip', () => {
  let server: TestServer

  before(async () => {
    server = await startTestServer()
  })

  after(async () => {
    await server?.close()
  })

  it('HTTP bridge: POST blocks until answer, then returns it', async () => {
    // Subscribe to event bus — auto-answer when question arrives
    const unsub = subscribe((event) => {
      if (event.type === 'ask_user' && event.questionId === 'q-bridge-1') {
        setTimeout(() => answerQuestion('q-bridge-1', 'Blue'), 20)
      }
    })

    const res = await fetch(`http://localhost:${server.port}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'q-bridge-1',
        question: 'What color?',
        options: ['Red', 'Blue', 'Green'],
      }),
    })

    assert.equal(res.status, 200)
    const data = await res.json() as { answer: string }
    assert.equal(data.answer, 'Blue')

    unsub()
  })

  it('HTTP bridge: rejects missing question', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: 'q-bad' }),
    })

    assert.equal(res.status, 400)
  })

  it('WS client receives ask_user event when HTTP bridge is called', async () => {
    const ws = await connectWS(server.port)

    // Start the bridge call (don't await — it blocks until answered)
    const bridgePromise = fetch(`http://localhost:${server.port}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'q-ws-1',
        question: 'Pick a framework',
        options: ['Hono', 'Express'],
      }),
    })

    // WS client should receive the ask_user event
    const event = await waitForMessage(ws, (msg) =>
      msg.type === 'ask_user' && msg.questionId === 'q-ws-1'
    )

    assert.equal(event.type, 'ask_user')
    assert.equal(event.question, 'Pick a framework')
    assert.deepEqual(event.options, ['Hono', 'Express'])

    // Answer via event bus (simulating what WS handler does)
    answerQuestion('q-ws-1', 'Hono')

    // Verify HTTP bridge returns the answer
    const res = await bridgePromise
    assert.equal(res.status, 200)
    const data = await res.json() as { answer: string }
    assert.equal(data.answer, 'Hono')

    ws.close()
  })

  it('WS client answers via user:answer message → resolves HTTP bridge', async () => {
    const ws = await connectWS(server.port)

    // Start bridge call
    const bridgePromise = fetch(`http://localhost:${server.port}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'q-ws-answer-1',
        question: 'Deploy now?',
        options: ['Yes', 'No'],
      }),
    })

    // Wait for the event on WS
    const event = await waitForMessage(ws, (msg) =>
      msg.type === 'ask_user' && msg.questionId === 'q-ws-answer-1'
    )

    assert.equal(event.question, 'Deploy now?')

    // Send answer via WS (this is what the Svelte frontend does)
    ws.send(JSON.stringify({
      type: 'user:answer',
      questionId: 'q-ws-answer-1',
      answer: 'Yes',
    }))

    // Verify the HTTP bridge resolves
    const res = await bridgePromise
    const data = await res.json() as { answer: string }
    assert.equal(data.answer, 'Yes')

    ws.close()
  })

  it('simulated agent flow: tool_use → ask_user bridge → WS event → user answer → agent continues', async () => {
    const ws = await connectWS(server.port)
    const events: AgentEvent[] = []

    // Collect all events the WS client receives
    ws.on('message', (data) => {
      try { events.push(JSON.parse(data.toString())) } catch { /* */ }
    })

    // ── Simulate agent behavior ──
    // The agent emits tool_use for ask_user, then the MCP tool calls the bridge

    // Step 1: Agent starts (router emits this)
    emit({ type: 'agent_start', conversationId: 'conv-sim-1' })

    // Step 2: Agent emits tool_use (this is what processResponse does)
    emit({
      type: 'tool_use',
      conversationId: 'conv-sim-1',
      toolUseId: 'tu-ask-1',
      name: 'mcp__gigi-tools__ask_user',
      input: { question: 'Create repo "kids-books"?', options: ['Yes', 'No', 'Ask me later'] },
    })

    // Step 3: The MCP tool calls the HTTP bridge (this happens in the separate MCP process)
    const bridgePromise = fetch(`http://localhost:${server.port}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'q-sim-1',
        question: 'Create repo "kids-books"?',
        options: ['Yes', 'No', 'Ask me later'],
      }),
    })

    // Step 4: WS client (frontend) receives ask_user event
    const askEvent = await waitForMessage(ws, (msg) =>
      msg.type === 'ask_user' && msg.questionId === 'q-sim-1'
    )
    assert.equal(askEvent.question, 'Create repo "kids-books"?')

    // Step 5: User clicks "Yes" in the UI → frontend sends user:answer
    ws.send(JSON.stringify({
      type: 'user:answer',
      questionId: 'q-sim-1',
      answer: 'Yes',
    }))

    // Step 6: Bridge resolves → MCP tool returns to agent
    const res = await bridgePromise
    const data = await res.json() as { answer: string }
    assert.equal(data.answer, 'Yes')

    // Step 7: Agent continues (would emit more events in real flow)
    emit({
      type: 'text_chunk',
      conversationId: 'conv-sim-1',
      text: 'Great! Creating repo kids-books...',
    })

    emit({
      type: 'agent_done',
      conversationId: 'conv-sim-1',
      cost: 0.01,
      turns: 2,
    })

    // Allow WS messages to arrive
    await new Promise(r => setTimeout(r, 50))

    // Verify the WS client received the full event sequence
    const types = events.map(e => e.type)
    assert.ok(types.includes('agent_start'), 'Should receive agent_start')
    assert.ok(types.includes('tool_use'), 'Should receive tool_use')
    assert.ok(types.includes('ask_user'), 'Should receive ask_user')
    assert.ok(types.includes('text_chunk'), 'Should receive text_chunk after answer')
    assert.ok(types.includes('agent_done'), 'Should receive agent_done')

    // Verify event ordering
    const startIdx = types.indexOf('agent_start')
    const toolIdx = types.indexOf('tool_use')
    const askIdx = types.indexOf('ask_user')
    const textIdx = types.indexOf('text_chunk')
    const doneIdx = types.indexOf('agent_done')
    assert.ok(startIdx < toolIdx, 'agent_start before tool_use')
    assert.ok(toolIdx < askIdx, 'tool_use before ask_user')
    assert.ok(askIdx < textIdx, 'ask_user before text_chunk (agent continues after answer)')
    assert.ok(textIdx < doneIdx, 'text_chunk before agent_done')

    ws.close()
  })

  it('multiple WS clients receive the same ask_user event', async () => {
    const ws1 = await connectWS(server.port)
    const ws2 = await connectWS(server.port)

    // Start bridge
    const bridgePromise = fetch(`http://localhost:${server.port}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'q-multi-ws',
        question: 'Both clients see this?',
        options: ['Yes'],
      }),
    })

    // Both WS clients should receive the event
    const [event1, event2] = await Promise.all([
      waitForMessage(ws1, (msg) => msg.type === 'ask_user' && msg.questionId === 'q-multi-ws'),
      waitForMessage(ws2, (msg) => msg.type === 'ask_user' && msg.questionId === 'q-multi-ws'),
    ])

    assert.equal(event1.question, 'Both clients see this?')
    assert.equal(event2.question, 'Both clients see this?')

    // Only one client needs to answer
    ws1.send(JSON.stringify({
      type: 'user:answer',
      questionId: 'q-multi-ws',
      answer: 'Yes',
    }))

    const res = await bridgePromise
    const data = await res.json() as { answer: string }
    assert.equal(data.answer, 'Yes')

    ws1.close()
    ws2.close()
  })

  it('second answer to same question is ignored', async () => {
    const ws = await connectWS(server.port)

    const bridgePromise = fetch(`http://localhost:${server.port}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: 'q-double-answer',
        question: 'Only first answer counts?',
        options: ['First', 'Second'],
      }),
    })

    await waitForMessage(ws, (msg) => msg.type === 'ask_user' && msg.questionId === 'q-double-answer')

    // First answer
    ws.send(JSON.stringify({ type: 'user:answer', questionId: 'q-double-answer', answer: 'First' }))

    const res = await bridgePromise
    const data = await res.json() as { answer: string }
    assert.equal(data.answer, 'First')

    // Second answer — should return false (no pending question)
    const resolved = answerQuestion('q-double-answer', 'Second')
    assert.equal(resolved, false, 'Second answer should be ignored')

    ws.close()
  })
})
