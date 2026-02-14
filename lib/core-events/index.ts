/**
 * Core Events — typed event bus interfaces.
 */

export interface AgentEvent {
  type: string
  conversationId?: string
  [key: string]: unknown
}

export type EventListener = (event: AgentEvent) => void

export interface EventBus {
  on(type: string, listener: EventListener): void
  off(type: string, listener: EventListener): void
  emit(event: AgentEvent): void
}
