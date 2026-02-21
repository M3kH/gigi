/**
 * WebSocket Test Client — Connect to WS endpoint and assert on event sequences
 *
 * Provides a test-friendly WebSocket client that collects events and supports
 * assertions on event sequences (agent_start -> text_chunk -> tool_use -> agent_done).
 */

import WebSocket from 'ws'

// ─── Types ──────────────────────────────────────────────────────────

export interface WSEvent {
  type: string
  conversationId?: string
  [key: string]: unknown
}

export interface WSClientOptions {
  url?: string
  /** Timeout for waitFor operations (ms) */
  timeout?: number
}

// ─── WebSocket Test Client ──────────────────────────────────────────

export class WSTestClient {
  private ws: WebSocket | null = null
  private events: WSEvent[] = []
  private waiters: Array<{ resolve: (event: WSEvent) => void; reject: (err: Error) => void; predicate: (event: WSEvent) => boolean }> = []
  private url: string
  private timeout: number
  private connected = false

  constructor(opts: WSClientOptions = {}) {
    this.url = opts.url || 'ws://localhost:3000/ws'
    this.timeout = opts.timeout || 10_000
  }

  /** Connect to the WebSocket server */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)

      this.ws.on('open', () => {
        this.connected = true
        resolve()
      })

      this.ws.on('message', (data) => {
        try {
          const event: WSEvent = JSON.parse(data.toString())
          this.events.push(event)

          // Resolve any pending waiters
          for (let i = this.waiters.length - 1; i >= 0; i--) {
            if (this.waiters[i].predicate(event)) {
              this.waiters[i].resolve(event)
              this.waiters.splice(i, 1)
            }
          }
        } catch { /* ignore malformed */ }
      })

      this.ws.on('error', (err) => {
        if (!this.connected) reject(err)
      })

      this.ws.on('close', () => {
        this.connected = false
        // Reject all pending waiters
        for (const waiter of this.waiters) {
          waiter.reject(new Error('WebSocket closed while waiting for event'))
        }
        this.waiters = []
      })
    })
  }

  /** Disconnect from the WebSocket server */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close()
      this.ws = null
      this.connected = false
    }
  }

  /** Send a raw message */
  send(msg: Record<string, unknown>): void {
    if (!this.ws || !this.connected) throw new Error('Not connected')
    this.ws.send(JSON.stringify(msg))
  }

  /** Send a chat message */
  sendChat(message: string, conversationId?: string): void {
    this.send({
      type: 'chat:send',
      message,
      ...(conversationId ? { conversationId } : {}),
    })
  }

  /** Send a ping */
  sendPing(): void {
    this.send({ type: 'ping' })
  }

  /** Send a stop signal */
  sendStop(conversationId: string): void {
    this.send({ type: 'chat:stop', conversationId })
  }

  /** Get all collected events */
  getEvents(): WSEvent[] {
    return [...this.events]
  }

  /** Get events of a specific type */
  getEventsByType(type: string): WSEvent[] {
    return this.events.filter(e => e.type === type)
  }

  /** Get events for a specific conversation */
  getEventsByConversation(conversationId: string): WSEvent[] {
    return this.events.filter(e => e.conversationId === conversationId)
  }

  /** Clear collected events */
  clearEvents(): void {
    this.events = []
  }

  /** Wait for a specific event type */
  async waitFor(type: string, timeoutMs?: number): Promise<WSEvent> {
    // Check if we already have it
    const existing = this.events.find(e => e.type === type)
    if (existing) return existing

    return this.waitForPredicate(e => e.type === type, timeoutMs)
  }

  /** Wait for an event matching a predicate */
  async waitForPredicate(predicate: (event: WSEvent) => boolean, timeoutMs?: number): Promise<WSEvent> {
    // Check existing events first
    const existing = this.events.find(predicate)
    if (existing) return existing

    const ms = timeoutMs || this.timeout
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex(w => w.resolve === resolve)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new Error(`Timed out waiting for event after ${ms}ms. Received: ${this.events.map(e => e.type).join(', ')}`))
      }, ms)

      this.waiters.push({
        resolve: (event) => {
          clearTimeout(timer)
          resolve(event)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
        predicate,
      })
    })
  }

  /** Wait for a specific event sequence (in order) */
  async waitForSequence(types: string[], timeoutMs?: number): Promise<WSEvent[]> {
    const ms = timeoutMs || this.timeout
    const deadline = Date.now() + ms
    const results: WSEvent[] = []

    for (const type of types) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(
          `Timed out waiting for sequence. Got [${results.map(e => e.type).join(', ')}], ` +
          `expected [${types.join(', ')}]`
        )
      }
      const event = await this.waitFor(type, remaining)
      results.push(event)
    }

    return results
  }

  /** Assert that events were received in a specific order */
  assertEventSequence(expectedTypes: string[]): void {
    const receivedTypes = this.events.map(e => e.type)

    let searchFrom = 0
    for (const expected of expectedTypes) {
      const idx = receivedTypes.indexOf(expected, searchFrom)
      if (idx === -1) {
        throw new Error(
          `Expected event "${expected}" after position ${searchFrom} ` +
          `but not found. Received: [${receivedTypes.join(', ')}]`
        )
      }
      searchFrom = idx + 1
    }
  }

  /** Assert that a specific event type was received */
  assertReceived(type: string): void {
    const found = this.events.some(e => e.type === type)
    if (!found) {
      throw new Error(
        `Expected event "${type}" but not received. Got: [${this.events.map(e => e.type).join(', ')}]`
      )
    }
  }

  /** Assert that a specific event type was NOT received */
  assertNotReceived(type: string): void {
    const found = this.events.some(e => e.type === type)
    if (found) {
      throw new Error(`Expected event "${type}" to NOT be received, but it was`)
    }
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.connected
  }
}

// ─── Event Collector ────────────────────────────────────────────────

/**
 * Standalone event collector for use with the event bus directly
 * (without a WebSocket connection). Useful for testing event emission
 * in unit/integration tests.
 */
export class EventCollector {
  private events: WSEvent[] = []
  private waiters: Array<{ resolve: (event: WSEvent) => void; predicate: (event: WSEvent) => boolean; timer: ReturnType<typeof setTimeout> }> = []

  /** Push an event into the collector */
  push(event: WSEvent): void {
    this.events.push(event)

    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].predicate(event)) {
        clearTimeout(this.waiters[i].timer)
        this.waiters[i].resolve(event)
        this.waiters.splice(i, 1)
      }
    }
  }

  /** Create a listener function suitable for subscribe() */
  listener(): (event: WSEvent) => void {
    return (event) => this.push(event)
  }

  /** Get all events */
  getEvents(): WSEvent[] {
    return [...this.events]
  }

  /** Get events by type */
  getEventsByType(type: string): WSEvent[] {
    return this.events.filter(e => e.type === type)
  }

  /** Clear events */
  clear(): void {
    this.events = []
  }

  /** Wait for an event matching a predicate */
  async waitFor(predicate: (event: WSEvent) => boolean, timeoutMs = 5000): Promise<WSEvent> {
    const existing = this.events.find(predicate)
    if (existing) return existing

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`EventCollector timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.waiters.push({ resolve, predicate, timer })
    })
  }

  /** Assert events were received in sequence */
  assertSequence(types: string[]): void {
    const received = this.events.map(e => e.type)
    let searchFrom = 0
    for (const expected of types) {
      const idx = received.indexOf(expected, searchFrom)
      if (idx === -1) {
        throw new Error(
          `Expected "${expected}" after position ${searchFrom}. Received: [${received.join(', ')}]`
        )
      }
      searchFrom = idx + 1
    }
  }
}
