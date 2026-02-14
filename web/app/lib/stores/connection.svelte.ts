/**
 * Connection store — Svelte 5 runes for WebSocket state
 *
 * Provides reactive access to the WebSocket connection and messages.
 */

import { createWSClient, type ConnectionState, type WSClient } from '$lib/services/ws-client'
import type { ServerMessage } from '$lib/types/protocol'

// ─── Singleton WS client ─────────────────────────────────────────────
const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

let client: WSClient | null = null

function getClient(): WSClient {
  if (!client) {
    client = createWSClient(wsUrl)
  }
  return client
}

// ─── Reactive state using Svelte 5 runes ──────────────────────────────

let connectionState = $state<ConnectionState>('disconnected')
let lastMessage = $state<ServerMessage | null>(null)

export function initConnection() {
  const ws = getClient()

  ws.onStateChange((s) => {
    connectionState = s
  })

  ws.onMessage((msg) => {
    lastMessage = msg
  })

  ws.connect()

  return ws
}

export function getConnectionState(): ConnectionState {
  return connectionState
}

export function getLastMessage(): ServerMessage | null {
  return lastMessage
}

export function getWSClient(): WSClient {
  return getClient()
}
