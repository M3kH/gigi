/**
 * Stop Agent Integration Test
 *
 * Tests the full user flow: start conversation → send message → agent runs → click stop → agent stops.
 *
 * Simulates the real architecture:
 * - Hono HTTP server with /api/chat/send and /api/conversations/:id/stop
 * - WebSocket server broadcasting events
 * - Router with AbortController-based agent cancellation
 * - Mock runAgent that blocks until signal is aborted
 *
 * The real Claude SDK query() is NOT called. Instead, runAgent is mocked to
 * simulate a long-running agent that respects AbortSignal.
 */

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer, type WebSocket as WSType } from 'ws'
import { Hono } from 'hono'
import { getRequestListener } from '@hono/node-server'
import { subscribe, emit, type AgentEvent } from '../lib/core/events'

// ─── Mock Agent ──────────────────────────────────────────────────────

const runningAgents = new Map<string, { abortController: AbortController }>()

const startMockAgent = async (convId: string): Promise<void> => {
  const abortController = new AbortController()
  const { signal } = abortController

  runningAgents.set(convId, { abortController })

  const send = (event: Record<string, unknown>) => {
    emit({ ...event, conversationId: convId } as AgentEvent)
  }

  send({ type: 'agent_start', conversationId: convId })

  await sleep(10)
  if (signal.aborted) { cleanup(convId, send); return }

  send({ type: 'text_chunk', text: 'Let me think about this...' })

  await sleep(10)
  if (signal.aborted) { cleanup(convId, send); return }

  send({
    type: 'tool_use',
    toolUseId: `tu-${convId}`,
    name: 'Bash',
    input: { command: 'echo working' },
  })

  // Block until aborted
  try {
    await new Promise<void>((_, reject) => {
      if (signal.aborted) { reject(); return }
      signal.addEventListener('abort', () => reject(), { once: true })
    })
  } catch { /* expected */ }

  cleanup(convId, send)
}

function cleanup(convId: string, send: (e: Record<string, unknown>) => void) {
  runningAgents.delete(convId)
  send({ type: 'agent_stopped', conversationId: convId })
}

const stopMockAgent = (convId: string): boolean => {
  const state = runningAgents.get(convId)
  if (state) {
    state.abortController.abort()
    return true
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Test Server ─────────────────────────────────────────────────────

interface TestServer {
  port: number
  httpServer: Server
  close: () => Promise<void>
}

const startTestServer = async (): Promise<TestServer> => {
  const app = new Hono()
  let nextConvId = 1

  app.post('/api/chat/send', async (c) => {
    const body = await c.req.json<{ message: string; conversationId?: string }>()
    const convId = body.conversationId || `conv-${nextConvId++}`
    startMockAgent(convId).catch(() => {})
    return c.json({ conversationId: convId })
  })

  app.post('/api/conversations/:id/stop', async (c) => {
    const convId = c.req.param('id')
    const stopped = stopMockAgent(convId)
    return c.json({ ok: true, stopped })
  })

  app.get('/api/conversations', (c) => c.json([]))

  const listener = getRequestListener(app.fetch)
  const httpServer = createServer(listener)
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    const req = request as import('node:http').IncomingMessage
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (url.pathname !== '/ws') {
      (socket as import('node:stream').Duplex).destroy()
      return
    }
    wss.handleUpgrade(req, socket as import('node:stream').Duplex, head as Buffer, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    const unsub = subscribe((event: AgentEvent) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(event)) } catch { /* */ }
      }
    })
    ws.on('close', () => unsub())
  })

  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const addr = httpServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  return {
    port,
    httpServer,
    close: () => new Promise((resolve) => {
      for (const [convId] of runningAgents) stopMockAgent(convId)
      wss.close()
      httpServer.close(() => resolve())
    }),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

const connectWS = (port: number): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/**
 * Wait for a WS message matching a predicate.
 * Also checks messages that already arrived (buffered).
 */
const waitForEvent = (
  ws: WebSocket,
  buffer: Record<string, unknown>[],
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> => {
  // Check buffer first — event may have already arrived
  const existing = buffer.find(predicate)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for WS message')),
      timeoutMs,
    )
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

/**
 * Start collecting all WS messages into a buffer array.
 */
const collectMessages = (ws: WebSocket): Record<string, unknown>[] => {
  const messages: Record<string, unknown>[] = []
  ws.on('message', (data) => {
    try { messages.push(JSON.parse(data.toString())) } catch { /* */ }
  })
  return messages
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Stop Agent — Full User Flow', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startTestServer()
  })

  afterAll(async () => {
    await server?.close()
  })

  it('user sends message → agent starts → user clicks stop → agent_stopped event arrives', async () => {
    const ws = await connectWS(server.port)
    const buffer = collectMessages(ws)

    // ── Step 1: User sends a message (like typing in ChatInput and pressing Enter)
    const sendRes = await fetch(`http://localhost:${server.port}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Create a new plugin called my-awesome-plugin' }),
    })
    assert.equal(sendRes.status, 200)
    const { conversationId } = await sendRes.json() as { conversationId: string }
    assert.ok(conversationId, 'Should receive a conversation ID')

    // ── Step 2: Wait for agent_start (may already be in buffer)
    const startEvent = await waitForEvent(ws, buffer, (msg) =>
      msg.type === 'agent_start' && msg.conversationId === conversationId
    )
    assert.equal(startEvent.type, 'agent_start')

    // ── Step 3: Wait for streaming content (proves agent is actively working)
    const textEvent = await waitForEvent(ws, buffer, (msg) =>
      msg.type === 'text_chunk' && msg.conversationId === conversationId
    )
    assert.equal(textEvent.type, 'text_chunk')

    // ── Step 4: User clicks "Stop" → POST /api/conversations/:id/stop
    const stopRes = await fetch(
      `http://localhost:${server.port}/api/conversations/${conversationId}/stop`,
      { method: 'POST' },
    )
    assert.equal(stopRes.status, 200)
    const stopData = await stopRes.json() as { ok: boolean; stopped: boolean }
    assert.equal(stopData.ok, true)
    assert.equal(stopData.stopped, true, 'Server should confirm the agent was stopped')

    // ── Step 5: Wait for agent_stopped event
    //
    // THIS IS THE KEY ASSERTION: if the stop flow works correctly, the agent
    // should emit agent_stopped within a reasonable time after abort() is called.
    // If this times out, the stop mechanism is broken.
    const stoppedEvent = await waitForEvent(ws, buffer, (msg) =>
      msg.type === 'agent_stopped' && msg.conversationId === conversationId,
    )
    assert.equal(stoppedEvent.type, 'agent_stopped')
    assert.equal(stoppedEvent.conversationId, conversationId)

    // ── Step 6: Verify the full event sequence
    await sleep(50)

    const types = buffer
      .filter((m) => m.conversationId === conversationId)
      .map((m) => m.type)

    const startIdx = types.indexOf('agent_start')
    const stoppedIdx = types.indexOf('agent_stopped')
    assert.ok(startIdx >= 0, 'Must have agent_start')
    assert.ok(stoppedIdx >= 0, 'Must have agent_stopped')
    assert.ok(startIdx < stoppedIdx, 'agent_start must come before agent_stopped')
    assert.ok(!types.includes('agent_done'), 'Should NOT have agent_done — agent was stopped')

    ws.close()
  })

  it('stopping a non-existent conversation returns stopped: false', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/conversations/nonexistent-id/stop`,
      { method: 'POST' },
    )
    assert.equal(res.status, 200)
    const data = await res.json() as { ok: boolean; stopped: boolean }
    assert.equal(data.stopped, false)
  })

  it('stopping an already-stopped agent returns stopped: false', async () => {
    const ws = await connectWS(server.port)
    const buffer = collectMessages(ws)

    // Start agent
    const sendRes = await fetch(`http://localhost:${server.port}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Do something' }),
    })
    const { conversationId } = await sendRes.json() as { conversationId: string }

    // Wait for it to start
    await waitForEvent(ws, buffer, (msg) =>
      msg.type === 'agent_start' && msg.conversationId === conversationId
    )

    // Stop it
    const stop1 = await fetch(
      `http://localhost:${server.port}/api/conversations/${conversationId}/stop`,
      { method: 'POST' },
    )
    const data1 = await stop1.json() as { stopped: boolean }
    assert.equal(data1.stopped, true, 'First stop should succeed')

    // Wait for agent_stopped
    await waitForEvent(ws, buffer, (msg) =>
      msg.type === 'agent_stopped' && msg.conversationId === conversationId
    )

    // Try stopping again — agent is already gone from runningAgents
    const stop2 = await fetch(
      `http://localhost:${server.port}/api/conversations/${conversationId}/stop`,
      { method: 'POST' },
    )
    const data2 = await stop2.json() as { stopped: boolean }
    assert.equal(data2.stopped, false, 'Second stop should return false — agent already stopped')

    ws.close()
  })

  it('stop with wrong conversation ID fails silently — agent keeps running', async () => {
    // This documents the frontend race condition: if activeConversationId is null
    // when the user clicks Stop (between pressing Enter and receiving the
    // conversation ID back), the stop request goes to the wrong ID and fails.
    //
    // Frontend code:
    //   export async function stopAgent(): Promise<void> {
    //     if (!activeConversationId) return  // <-- silent no-op!
    //
    // Even if it did send the request, it would use the wrong ID.

    const ws = await connectWS(server.port)
    const buffer = collectMessages(ws)

    // Fire-and-forget send (mimics frontend's sendMessage)
    const sendPromise = fetch(`http://localhost:${server.port}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Quick task' }),
    })

    // Immediately try to stop with wrong ID (simulates the race)
    const stopRes = await fetch(
      `http://localhost:${server.port}/api/conversations/undefined/stop`,
      { method: 'POST' },
    )
    const stopData = await stopRes.json() as { stopped: boolean }
    assert.equal(stopData.stopped, false, 'Stop with wrong ID fails — agent keeps running')

    // Get the real conversation ID
    const { conversationId } = await sendPromise.then((r) => r.json()) as { conversationId: string }

    // Agent is still running — prove it
    const startEvent = await waitForEvent(ws, buffer, (msg) =>
      msg.type === 'agent_start' && msg.conversationId === conversationId
    )
    assert.ok(startEvent, 'Agent is still running despite stop attempt')

    // Clean up: stop with correct ID
    await fetch(
      `http://localhost:${server.port}/api/conversations/${conversationId}/stop`,
      { method: 'POST' },
    )
    await waitForEvent(ws, buffer, (msg) =>
      msg.type === 'agent_stopped' && msg.conversationId === conversationId
    )

    ws.close()
  })
})
