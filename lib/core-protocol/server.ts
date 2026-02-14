/**
 * Server-to-client message schemas.
 * Defines all messages the server can send to the frontend via WebSocket.
 */
import { z } from 'zod'

export const AgentStartSchema = z.object({
  type: z.literal('agent.start'),
  conversationId: z.string().uuid(),
})

export const AgentChunkSchema = z.object({
  type: z.literal('agent.chunk'),
  conversationId: z.string().uuid(),
  text: z.string(),
})

export const AgentDoneSchema = z.object({
  type: z.literal('agent.done'),
  conversationId: z.string().uuid(),
  text: z.string(),
})

export const AgentErrorSchema = z.object({
  type: z.literal('agent.error'),
  conversationId: z.string().uuid(),
  error: z.string(),
})

export const AgentStoppedSchema = z.object({
  type: z.literal('agent.stopped'),
  conversationId: z.string().uuid(),
})

export const ToolCallSchema = z.object({
  type: z.literal('tool.call'),
  conversationId: z.string().uuid(),
  toolName: z.string(),
  toolId: z.string(),
  input: z.record(z.unknown()),
})

export const ToolResultSchema = z.object({
  type: z.literal('tool.result'),
  conversationId: z.string().uuid(),
  toolId: z.string(),
  output: z.string(),
  isError: z.boolean().optional(),
})

export const TitleUpdateSchema = z.object({
  type: z.literal('title.update'),
  conversationId: z.string().uuid(),
  title: z.string(),
})

export const PongSchema = z.object({
  type: z.literal('pong'),
})

export const ServerMessageSchema = z.discriminatedUnion('type', [
  AgentStartSchema,
  AgentChunkSchema,
  AgentDoneSchema,
  AgentErrorSchema,
  AgentStoppedSchema,
  ToolCallSchema,
  ToolResultSchema,
  TitleUpdateSchema,
  PongSchema,
])

export type ServerMessage = z.infer<typeof ServerMessageSchema>
