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

export type UserAnswer = {
  type: 'user:answer'
  questionId: string
  answer: string
}

export type ClientMessage =
  | ChatSend
  | ChatStop
  | ViewNavigate
  | ConversationSelect
  | TitleUpdate
  | Ping
  | UserAnswer

// ─── Server → Client ────────────────────────────────────────────────

export type AgentStartEvent = {
  type: 'agent_start'
  conversationId: string
  channel?: string
}

export type TextChunkEvent = {
  type: 'text_chunk'
  conversationId?: string
  channel?: string
  text: string
}

export type ToolUseEvent = {
  type: 'tool_use'
  conversationId?: string
  channel?: string
  toolUseId: string
  name: string
  input: unknown
}

export type ToolResultEvent = {
  type: 'tool_result'
  conversationId?: string
  channel?: string
  toolUseId: string
  result: string
}

export type AgentDoneEvent = {
  type: 'agent_done'
  conversationId?: string
  channel?: string
  cost: number | null
  duration: number
  turns: number
  isError: boolean
  usage: unknown | null
}

export type AgentStoppedEvent = {
  type: 'agent_stopped'
  conversationId: string
  channel?: string
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

export type AskUserEvent = {
  type: 'ask_user'
  conversationId?: string
  questionId: string
  question: string
  options: string[]
}

export type ThreadStatus = 'active' | 'paused' | 'stopped' | 'archived'

export type ThreadStatusEvent = {
  type: 'thread_status'
  conversationId: string
  status: ThreadStatus
}

export type ConversationUpdatedEvent = {
  type: 'conversation_updated'
  conversationId: string
  reason?: 'webhook_message' | 'new_message'
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
  | AskUserEvent
  | ThreadStatusEvent
  | ConversationUpdatedEvent
