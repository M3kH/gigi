/**
 * Core Router — typed message routing interfaces.
 */

export type Channel = 'web' | 'telegram' | 'webhook'

export interface RouteContext {
  channel: Channel
  conversationId: string
  message: string
  tags?: string[]
  repo?: string
  systemMessage?: string
}

export interface RouterResult {
  text: string
  conversationId: string
  sessionId?: string
}
