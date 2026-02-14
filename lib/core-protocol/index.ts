/**
 * Core Protocol — re-exports client and server message types.
 */
export { ClientMessageSchema } from './client.js'
export type { ClientMessage, ChatSend, ChatNew, ChatResume, ChatStop } from './client.js'

export { ServerMessageSchema } from './server.js'
export type { ServerMessage } from './server.js'
