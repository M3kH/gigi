/**
 * WebSocket server — real-time event broadcasting + client message handling
 *
 * Uses the `ws` package for WebSocket upgrades on the same HTTP server.
 * Subscribes each connected client to the core event bus and handles
 * incoming client messages (chat:send, chat:stop, ping, etc.).
 */

import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { ClientMessage } from '../lib/core/protocol'
import type { ServerMessage } from '../lib/core/protocol'
import { subscribe, type AgentEvent } from '../lib/core/events'
import { handleMessage, resumeConversation, stopAgent } from '../lib/core/router'
import { answerQuestion } from '../lib/core/ask-user'
import * as store from '../lib/core/store'

// ── Types ────────────────────────────────────────────────────────────

interface WSClient {
  ws: WebSocket
  unsubscribe: () => void
}

// ── WebSocket Server ─────────────────────────────────────────────────

const clients = new Set<WSClient>()

export const createWSServer = (server: { on: (event: string, listener: (...args: unknown[]) => void) => void }): void => {
  const wss = new WebSocketServer({ noServer: true })

  // Handle HTTP upgrade requests for /ws path
  server.on('upgrade', (request: unknown, socket: unknown, head: unknown) => {
    const req = request as IncomingMessage
    const sock = socket as Duplex
    const hd = head as Buffer
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (url.pathname !== '/ws') {
      sock.destroy()
      return
    }

    wss.handleUpgrade(req, sock, hd, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws: WebSocket) => {
    // Subscribe this client to the event bus
    const unsubscribe = subscribe((event: AgentEvent) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(event))
        } catch { /* client gone */ }
      }
    })

    const client: WSClient = { ws, unsubscribe }
    clients.add(client)

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const raw: unknown = JSON.parse(data.toString())
        const parsed = ClientMessage.safeParse(raw)
        if (!parsed.success) return

        handleClientMessage(ws, parsed.data)
      } catch { /* ignore malformed */ }
    })

    ws.on('close', () => {
      unsubscribe()
      clients.delete(client)
    })

    ws.on('error', () => {
      unsubscribe()
      clients.delete(client)
    })
  })

  console.log('WebSocket server ready on /ws')
}

// ── Client Message Handling ──────────────────────────────────────────

const handleClientMessage = (ws: WebSocket, msg: ClientMessage): void => {
  switch (msg.type) {
    case 'ping': {
      sendPong(ws)
      break
    }

    case 'chat:send': {
      const channelId = msg.conversationId || 'default'
      if (msg.conversationId) {
        resumeConversation('web', channelId, msg.conversationId)
      }
      handleMessage('web', channelId, msg.message, null, msg.context).catch((err) => {
        console.error('[ws] chat error:', (err as Error).message)
      })
      break
    }

    case 'chat:stop': {
      stopAgent(msg.conversationId)
      break
    }

    case 'conversation:select': {
      // Frontend-only state — no server action needed
      break
    }

    case 'title:update': {
      store.updateConversation(msg.conversationId, { topic: msg.title }).catch((err) => {
        console.error('[ws] title update error:', (err as Error).message)
      })
      break
    }

    case 'view:navigate': {
      // Frontend-only state — no server action needed
      break
    }

    case 'user:answer': {
      const resolved = answerQuestion(msg.questionId, msg.answer)
      if (!resolved) {
        console.warn('[ws] user:answer for unknown questionId:', msg.questionId)
      }
      break
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Send a pong directly to a specific WebSocket */
export const sendPong = (ws: WebSocket): void => {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'pong' }))
    } catch { /* ignore */ }
  }
}

/**
 * Serialize a server message to JSON.
 */
export const serializeServerMessage = (msg: ServerMessage): string => {
  return JSON.stringify(msg)
}
