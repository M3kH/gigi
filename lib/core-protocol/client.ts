/**
 * Client-to-server message schemas.
 * Defines all messages the frontend can send to the server via WebSocket.
 */
import { z } from 'zod'

export const ChatSendSchema = z.object({
  type: z.literal('chat.send'),
  message: z.string().min(1),
  conversationId: z.number().optional(),
  projectId: z.number().optional(),
})

export const ChatStopSchema = z.object({
  type: z.literal('chat.stop'),
  conversationId: z.number(),
})

export const ViewNavigateSchema = z.object({
  type: z.literal('view.navigate'),
  target: z.enum(['issue', 'pr', 'code', 'kanban', 'overview']),
  id: z.number().optional(),
  path: z.string().optional(),
})

export const ConversationSelectSchema = z.object({
  type: z.literal('conversation.select'),
  conversationId: z.number(),
})

export const TitleUpdateSchema = z.object({
  type: z.literal('title.update'),
  conversationId: z.number(),
  title: z.string().min(1),
})

export const PingSchema = z.object({
  type: z.literal('ping'),
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ChatSendSchema,
  ChatStopSchema,
  ViewNavigateSchema,
  ConversationSelectSchema,
  TitleUpdateSchema,
  PingSchema,
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type ChatSend = z.infer<typeof ChatSendSchema>
export type ChatStop = z.infer<typeof ChatStopSchema>
export type ViewNavigate = z.infer<typeof ViewNavigateSchema>
export type ConversationSelect = z.infer<typeof ConversationSelectSchema>
export type TitleUpdate = z.infer<typeof TitleUpdateSchema>
