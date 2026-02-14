/**
 * Client-to-server message schemas.
 * Defines all messages the frontend can send to the server via WebSocket.
 */
import { z } from 'zod'

export const ChatSendSchema = z.object({
  type: z.literal('chat.send'),
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
})

export const ChatNewSchema = z.object({
  type: z.literal('chat.new'),
})

export const ChatResumeSchema = z.object({
  type: z.literal('chat.resume'),
  conversationId: z.string().uuid(),
})

export const ChatStopSchema = z.object({
  type: z.literal('chat.stop'),
  conversationId: z.string().uuid(),
})

export const PingSchema = z.object({
  type: z.literal('ping'),
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ChatSendSchema,
  ChatNewSchema,
  ChatResumeSchema,
  ChatStopSchema,
  PingSchema,
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type ChatSend = z.infer<typeof ChatSendSchema>
export type ChatNew = z.infer<typeof ChatNewSchema>
export type ChatResume = z.infer<typeof ChatResumeSchema>
export type ChatStop = z.infer<typeof ChatStopSchema>
