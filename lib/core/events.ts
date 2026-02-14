/**
 * Core Event Bus
 *
 * Simple pub-sub for broadcasting agent events to SSE clients and other listeners.
 */

export interface AgentEvent {
  type: string
  conversationId?: string
  [key: string]: unknown
}

export type EventListener = (event: AgentEvent) => void

const listeners = new Set<EventListener>()

export const subscribe = (fn: EventListener): (() => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const emit = (event: AgentEvent): void => {
  for (const fn of listeners) fn(event)
}
