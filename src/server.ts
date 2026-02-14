/**
 * WebSocket server for the core protocol.
 *
 * Defines WebSocket upgrade handling using Hono.
 * Validates incoming messages against the Zod schemas defined
 * in lib/core-protocol/ and dispatches them accordingly.
 *
 * NOT yet wired into src/index.js — this is scaffolding for
 * future integration. Currently only needs to pass tsc --noEmit.
 */
import { Hono } from 'hono'
import { ClientMessageSchema } from '../lib/core-protocol/client.js'
import type { ServerMessage } from '../lib/core-protocol/server.js'

export const createWsApp = () => {
  const app = new Hono()

  // WebSocket upgrade endpoint placeholder
  // Future: use @hono/node-ws or raw ws upgrade
  app.get('/ws', (c) => {
    return c.json(
      { error: 'WebSocket upgrade required', protocol: 'gigi-core/1' },
      426
    )
  })

  return app
}

/**
 * Parse and validate an incoming client message.
 */
export const parseClientMessage = (raw: string) => {
  try {
    const data: unknown = JSON.parse(raw)
    return ClientMessageSchema.parse(data)
  } catch {
    return null
  }
}

/**
 * Serialize a server message to JSON.
 */
export const serializeServerMessage = (msg: ServerMessage): string => {
  return JSON.stringify(msg)
}
