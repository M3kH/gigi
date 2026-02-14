/**
 * Core Protocol — the WebSocket contract between frontend and backend.
 *
 * All message types are defined as Zod schemas. TypeScript types are inferred
 * from schemas — no manual type definitions needed.
 *
 * Usage:
 *   import { ClientMessageSchema, ServerMessageSchema } from '../lib/core-protocol/index.js'
 *   const parsed = ClientMessageSchema.parse(raw)  // throws on invalid
 *   const safe   = ServerMessageSchema.safeParse(raw) // returns { success, data?, error? }
 */

// Client → Server
export {
  ClientMessageSchema,
  ChatSendSchema,
  ChatStopSchema,
  ViewNavigateSchema,
  ConversationSelectSchema,
  TitleUpdateSchema as ClientTitleUpdateSchema,
  PingSchema,
} from './client.js'

export type {
  ClientMessage,
  ChatSend,
  ChatStop,
  ViewNavigate,
  ConversationSelect,
  TitleUpdate as ClientTitleUpdate,
} from './client.js'

// Server → Client
export {
  ServerMessageSchema,
  AgentStartSchema,
  TextChunkSchema,
  ToolUseSchema,
  ToolResultSchema,
  ToolProgressSchema,
  AgentDoneSchema,
  AgentErrorSchema,
  AgentStoppedSchema,
  ConversationUpdateSchema,
  TitleUpdateSchema as ServerTitleUpdateSchema,
  ViewCommandSchema,
  ConversationListSchema,
  MessageHistorySchema,
  PongSchema,
} from './server.js'

export type {
  ServerMessage,
  AgentStart,
  TextChunk,
  ToolUse,
  ToolResult,
  ToolProgress,
  AgentDone,
  AgentError,
  AgentStopped,
  ConversationUpdate,
  TitleUpdate as ServerTitleUpdate,
  ViewCommand,
  ConversationList,
  MessageHistory,
} from './server.js'
