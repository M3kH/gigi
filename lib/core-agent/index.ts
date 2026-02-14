/**
 * Core Agent — typed agent interfaces.
 * Wraps the existing src/agent.js with TypeScript types.
 */

export interface AgentResponse {
  text: string
  toolCalls: ToolCall[]
  toolResults: Record<string, unknown>
  sessionId?: string
  usage?: TokenUsage
  content?: MessageContent[]
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
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
