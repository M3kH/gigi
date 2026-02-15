/**
 * Client-side protocol types
 *
 * Mirrors the server-side Zod schemas from lib/core/protocol.ts
 * without depending on Zod in the browser bundle.
 */

import type { ViewContext } from '$lib/stores/navigation.svelte'

// ─── Client → Server ────────────────────────────────────────────────

export type ChatSend = {
  type: 'chat:send'
  message: string
  conversationId?: string
  context?: ViewContext
}

export type ChatStop = {
  type: 'chat:stop'
  conversationId: string
}

export type ViewNavigate = {
  type: 'view:navigate'
  path: string
}

export type ConversationSelect = {
  type: 'conversation:select'
  conversationId: string
}

export type TitleUpdate = {
  type: 'title:update'
  conversationId: string
  title: string
}

export type Ping = {
  type: 'ping'
}

export type ClientMessage =
  | ChatSend
  | ChatStop
  | ViewNavigate
  | ConversationSelect
  | TitleUpdate
  | Ping

// ─── Server → Client ────────────────────────────────────────────────

export type AgentStartEvent = {
  type: 'agent_start'
  conversationId: string
}

export type TextChunkEvent = {
  type: 'text_chunk'
  conversationId?: string
  text: string
}

export type ToolUseEvent = {
  type: 'tool_use'
  conversationId?: string
  toolUseId: string
  name: string
  input: unknown
}

export type ToolResultEvent = {
  type: 'tool_result'
  conversationId?: string
  toolUseId: string
  result: string
}

export type AgentDoneEvent = {
  type: 'agent_done'
  conversationId?: string
  cost: number | null
  duration: number
  turns: number
  isError: boolean
  usage: unknown | null
}

export type AgentStoppedEvent = {
  type: 'agent_stopped'
  conversationId: string
}

export type TitleUpdateEvent = {
  type: 'title_update'
  conversationId: string
  title: string
}

export type PongEvent = {
  type: 'pong'
}

export type GiteaEvent = {
  type: 'gitea_event'
  event: string    // e.g. 'repository', 'issues', 'push', 'pull_request'
  action?: string  // e.g. 'created', 'deleted', 'opened', 'closed'
  repo?: string
}

export type ServerMessage =
  | AgentStartEvent
  | TextChunkEvent
  | ToolUseEvent
  | ToolResultEvent
  | AgentDoneEvent
  | AgentStoppedEvent
  | TitleUpdateEvent
  | PongEvent
  | GiteaEvent
