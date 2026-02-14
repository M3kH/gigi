/**
 * Server-to-client message schemas.
 * Defines all messages the server can send to the frontend via WebSocket.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Agent events
// ---------------------------------------------------------------------------

export const AgentStartSchema = z.object({
  type: z.literal('agent.start'),
  conversationId: z.number(),
})

export const TextChunkSchema = z.object({
  type: z.literal('agent.chunk'),
  conversationId: z.number(),
  text: z.string(),
})

export const ToolUseSchema = z.object({
  type: z.literal('tool.use'),
  conversationId: z.number(),
  toolName: z.string(),
  toolId: z.string(),
  input: z.record(z.unknown()),
})

export const ToolResultSchema = z.object({
  type: z.literal('tool.result'),
  conversationId: z.number(),
  toolId: z.string(),
  output: z.string(),
  isError: z.boolean().optional(),
})

export const ToolProgressSchema = z.object({
  type: z.literal('tool.progress'),
  conversationId: z.number(),
  toolId: z.string(),
  progress: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
})

export const AgentDoneSchema = z.object({
  type: z.literal('agent.done'),
  conversationId: z.number(),
  text: z.string(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }).optional(),
})

export const AgentErrorSchema = z.object({
  type: z.literal('agent.error'),
  conversationId: z.number(),
  error: z.string(),
})

export const AgentStoppedSchema = z.object({
  type: z.literal('agent.stopped'),
  conversationId: z.number(),
})

// ---------------------------------------------------------------------------
// UI events
// ---------------------------------------------------------------------------

const ConversationSummary = z.object({
  id: z.number(),
  title: z.string(),
  updatedAt: z.string().datetime(),
})

export const ConversationUpdateSchema = z.object({
  type: z.literal('conversation.update'),
  conversation: ConversationSummary,
})

export const TitleUpdateSchema = z.object({
  type: z.literal('title.update'),
  conversationId: z.number(),
  title: z.string(),
})

export const ViewCommandSchema = z.object({
  type: z.literal('view.command'),
  target: z.enum(['issue', 'pr', 'code', 'kanban', 'overview']),
  id: z.number().optional(),
  path: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Data events
// ---------------------------------------------------------------------------

export const ConversationListSchema = z.object({
  type: z.literal('conversation.list'),
  conversations: z.array(ConversationSummary),
})

const MessageRecord = z.object({
  id: z.number(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string().datetime(),
})

export const MessageHistorySchema = z.object({
  type: z.literal('message.history'),
  conversationId: z.number(),
  messages: z.array(MessageRecord),
})

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const PongSchema = z.object({
  type: z.literal('pong'),
})

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const ServerMessageSchema = z.discriminatedUnion('type', [
  // Agent events
  AgentStartSchema,
  TextChunkSchema,
  ToolUseSchema,
  ToolResultSchema,
  ToolProgressSchema,
  AgentDoneSchema,
  AgentErrorSchema,
  AgentStoppedSchema,
  // UI events
  ConversationUpdateSchema,
  TitleUpdateSchema,
  ViewCommandSchema,
  // Data events
  ConversationListSchema,
  MessageHistorySchema,
  // Heartbeat
  PongSchema,
])

export type ServerMessage = z.infer<typeof ServerMessageSchema>
export type AgentStart = z.infer<typeof AgentStartSchema>
export type TextChunk = z.infer<typeof TextChunkSchema>
export type ToolUse = z.infer<typeof ToolUseSchema>
export type ToolResult = z.infer<typeof ToolResultSchema>
export type ToolProgress = z.infer<typeof ToolProgressSchema>
export type AgentDone = z.infer<typeof AgentDoneSchema>
export type AgentError = z.infer<typeof AgentErrorSchema>
export type AgentStopped = z.infer<typeof AgentStoppedSchema>
export type ConversationUpdate = z.infer<typeof ConversationUpdateSchema>
export type TitleUpdate = z.infer<typeof TitleUpdateSchema>
export type ViewCommand = z.infer<typeof ViewCommandSchema>
export type ConversationList = z.infer<typeof ConversationListSchema>
export type MessageHistory = z.infer<typeof MessageHistorySchema>
