/**
 * Chat domain types
 *
 * Typed representations for conversations, messages, tool blocks, and token usage.
 */

// ── Conversation ────────────────────────────────────────────────────

export interface Conversation {
  id: string
  topic: string
  channel: string
  channelId: string
  status: 'open' | 'active' | 'closed'
  tags: string[]
  repo?: string
  createdAt: string
  updatedAt: string
  lastMessagePreview?: string
  usageCost?: number
  usageInputTokens?: number
  usageOutputTokens?: number
}

// ── Message ─────────────────────────────────────────────────────────

export interface ToolCall {
  toolUseId: string
  name: string
  input: unknown
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  costUSD?: number
  durationMs?: number
  numTurns?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  toolOutputs?: Record<string, string>
  usage?: TokenUsage
  createdAt: string
}

// ── Live tool block (during streaming) ──────────────────────────────

export interface LiveToolBlock {
  toolUseId: string
  name: string
  input: unknown
  result?: string
  status: 'running' | 'done'
  startedAt: number
}

// ── Chat dialog state ───────────────────────────────────────────────

export type DialogState = 'idle' | 'thinking' | 'streaming' | 'tool_running'
