/**
 * Chat domain types
 *
 * Typed representations for conversations, messages, tool blocks, and token usage.
 */

// ── Conversation ────────────────────────────────────────────────────

export type ThreadStatus = 'active' | 'paused' | 'stopped' | 'archived'

export interface Conversation {
  id: string
  topic: string
  channel: string
  channelId: string
  status: ThreadStatus
  tags: string[]
  repo?: string
  createdAt: string
  updatedAt: string
  archivedAt?: string | null
  lastMessagePreview?: string
  usageCost?: number
  usageInputTokens?: number
  usageOutputTokens?: number
  refCount?: number
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

/** An ordered content block — text or tool_use — preserving interleaving for faithful replay */
export type InterleavedBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Ordered content blocks preserving text/tool interleaving (for assistant messages) */
  interleavedContent?: InterleavedBlock[]
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

// ── Ask user block (agent asking a question) ───────────────────────

export interface AskUserBlock {
  questionId: string
  question: string
  options: string[]
  answer?: string
  answeredAt?: number
}

// ── Stream segment (unified live rendering) ────────────────────────

export type StreamSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolUseId: string; name: string; input: unknown; result?: string; status: 'running' | 'done'; startedAt: number }
  | { type: 'ask_user'; questionId: string; question: string; options: string[]; answer?: string; answeredAt?: number }
  | { type: 'system'; text: string; event?: string; action?: string; repo?: string }

// ── Thread lineage (fork tracking) ──────────────────────────────────

export interface ThreadRef {
  id: string
  thread_id: string
  ref_type: 'issue' | 'pr' | 'commit' | 'branch'
  repo: string
  number: number | null
  ref: string | null
  url: string | null
  status: string | null
  created_at: string
}

export interface ThreadLineageThread {
  id: string
  topic: string | null
  status: ThreadStatus
  parent_thread_id: string | null
  fork_point_event_id: string | null
  created_at: string
  refs: ThreadRef[]
}

export type ThreadChannel = 'web' | 'telegram' | 'gitea_comment' | 'gitea_review' | 'webhook' | 'system'

export interface ThreadEvent {
  id: string
  thread_id: string
  channel: ThreadChannel | string
  direction: 'inbound' | 'outbound' | string
  actor: string
  content: unknown
  message_type: string
  usage?: unknown
  metadata?: Record<string, unknown>
  is_compacted?: boolean
  created_at: string
}

export interface CompactStatus {
  should_compact: boolean
  event_count: number
  threshold: number
}

export interface ThreadLineage {
  parent: ThreadLineageThread | null
  fork_point: ThreadEvent | null
  children: ThreadLineageThread[]
}

// ── Chat dialog state ───────────────────────────────────────────────

export type DialogState = 'idle' | 'thinking' | 'streaming' | 'tool_running' | 'waiting_for_user'
