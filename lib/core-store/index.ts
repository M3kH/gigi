/**
 * Core Store — typed database interfaces.
 */

export interface Conversation {
  id: string
  channel: string
  topic: string | null
  status: 'active' | 'closed'
  tags: string[]
  repo: string | null
  created_at: string
  updated_at: string
  session_id: string | null
  closed_at: string | null
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: MessageContent[]
  tool_calls: unknown | null
  tool_outputs: unknown | null
  message_type: string
  usage: TokenUsage | null
  created_at: string
}

export interface MessageContent {
  type: 'text'
  text: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
}

export interface ConfigEntry {
  key: string
  value: string
}
