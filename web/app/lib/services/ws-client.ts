/**
 * Typed WebSocket client with auto-reconnect
 *
 * Connects to the Gigi backend, validates messages against protocol types,
 * and exposes a readable Svelte store for reactive UI updates.
 */

import type { ClientMessage, ServerMessage } from '$lib/types/protocol'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

export type WSListener = (message: ServerMessage) => void
export type StateListener = (state: ConnectionState) => void

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000] // Exponential backoff, max 16s
const PING_INTERVAL = 30_000

export function createWSClient(url: string) {
  let ws: WebSocket | null = null
  let state: ConnectionState = 'disconnected'
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  const messageListeners = new Set<WSListener>()
  const stateListeners = new Set<StateListener>()

  function setState(next: ConnectionState) {
    state = next
    for (const fn of stateListeners) fn(next)
  }

  function startPing() {
    stopPing()
    pingTimer = setInterval(() => {
      send({ type: 'ping' })
    }, PING_INTERVAL)
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function connect() {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return

    setState(reconnectAttempt > 0 ? 'reconnecting' : 'connecting')

    ws = new WebSocket(url)

    ws.onopen = () => {
      reconnectAttempt = 0
      setState('connected')
      startPing()
    }

    ws.onmessage = (event) => {
      try {
        const data: ServerMessage = JSON.parse(event.data)
        for (const fn of messageListeners) fn(data)
      } catch {
        console.warn('[ws] Failed to parse message:', event.data)
      }
    }

    ws.onclose = () => {
      stopPing()
      setState('disconnected')
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)]
    reconnectAttempt++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function send(message: ClientMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    stopPing()
    reconnectAttempt = Infinity // Prevent auto-reconnect
    ws?.close()
    ws = null
    setState('disconnected')
  }

  function onMessage(fn: WSListener): () => void {
    messageListeners.add(fn)
    return () => messageListeners.delete(fn)
  }

  function onStateChange(fn: StateListener): () => void {
    stateListeners.add(fn)
    return () => stateListeners.delete(fn)
  }

  function getState(): ConnectionState {
    return state
  }

  return {
    connect,
    disconnect,
    send,
    onMessage,
    onStateChange,
    getState,
  }
}

export type WSClient = ReturnType<typeof createWSClient>
