/**
 * Chat service — message sending logic
 *
 * Decouples chat business logic from UI components.
 * Validates and sends messages through the WebSocket client.
 */

import type { WSClient } from '$lib/services/ws-client'

export function sendChatMessage(ws: WSClient, message: string, conversationId?: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false

  ws.send({
    type: 'chat:send',
    message: trimmed,
    ...(conversationId ? { conversationId } : {}),
  })

  return true
}
