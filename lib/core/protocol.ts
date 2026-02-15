/**
 * Core Protocol — Zod schemas for client↔server messages
 *
 * Defines the typed message contract for WebSocket/SSE communication.
 */

import { z } from 'zod'

// ─── View Context ───────────────────────────────────────────────────

export const ViewContextSchema = z.object({
  type: z.enum(['overview', 'repo', 'issue', 'pull', 'file', 'commit', 'unknown']),
  owner: z.string().optional(),
  repo: z.string().optional(),
  number: z.number().optional(),
  filepath: z.string().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  rawPath: z.string().optional(),
})

export type ViewContext = z.infer<typeof ViewContextSchema>

// ─── Client → Server ────────────────────────────────────────────────

export const ChatSend = z.object({
  type: z.literal('chat:send'),
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  context: ViewContextSchema.optional(),
})

export const ChatStop = z.object({
  type: z.literal('chat:stop'),
  conversationId: z.string().uuid(),
})

export const ViewNavigate = z.object({
  type: z.literal('view:navigate'),
  path: z.string(),
})

export const ConversationSelect = z.object({
  type: z.literal('conversation:select'),
  conversationId: z.string().uuid(),
})

export const TitleUpdate = z.object({
  type: z.literal('title:update'),
  conversationId: z.string().uuid(),
  title: z.string(),
})

export const Ping = z.object({
  type: z.literal('ping'),
})

export const ClientMessage = z.discriminatedUnion('type', [
  ChatSend,
  ChatStop,
  ViewNavigate,
  ConversationSelect,
  TitleUpdate,
  Ping,
])

export type ClientMessage = z.infer<typeof ClientMessage>

// ─── Server → Client ────────────────────────────────────────────────

export const AgentStartEvent = z.object({
  type: z.literal('agent_start'),
  conversationId: z.string(),
})

export const TextChunkEvent = z.object({
  type: z.literal('text_chunk'),
  conversationId: z.string().optional(),
  text: z.string(),
})

export const ToolUseEvent = z.object({
  type: z.literal('tool_use'),
  conversationId: z.string().optional(),
  toolUseId: z.string(),
  name: z.string(),
  input: z.unknown(),
})

export const ToolResultEvent = z.object({
  type: z.literal('tool_result'),
  conversationId: z.string().optional(),
  toolUseId: z.string(),
  result: z.string(),
})

export const AgentDoneEvent = z.object({
  type: z.literal('agent_done'),
  conversationId: z.string().optional(),
  cost: z.number().nullable(),
  duration: z.number(),
  turns: z.number(),
  isError: z.boolean(),
  usage: z.unknown().nullable(),
})

export const AgentStoppedEvent = z.object({
  type: z.literal('agent_stopped'),
  conversationId: z.string(),
})

export const TitleUpdateEvent = z.object({
  type: z.literal('title_update'),
  conversationId: z.string(),
  title: z.string(),
})

export const PongEvent = z.object({
  type: z.literal('pong'),
})

export const GiteaEvent = z.object({
  type: z.literal('gitea_event'),
  event: z.string(),
  action: z.string().optional(),
  repo: z.string().optional(),
})

export const ServerMessage = z.discriminatedUnion('type', [
  AgentStartEvent,
  TextChunkEvent,
  ToolUseEvent,
  ToolResultEvent,
  AgentDoneEvent,
  AgentStoppedEvent,
  TitleUpdateEvent,
  PongEvent,
  GiteaEvent,
])

export type ServerMessage = z.infer<typeof ServerMessage>
