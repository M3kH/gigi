/**
 * Chat store — Svelte 5 runes for conversation and message state
 *
 * Manages:
 * - Conversation list (fetched from REST, updated via events)
 * - Active conversation and its messages
 * - Live streaming state (text chunks, tool blocks)
 * - Agent running status per conversation
 *
 * Events come from the WS connection store's onMessage.
 */

import type {
  Conversation,
  ChatMessage,
  LiveToolBlock,
  DialogState,
  TokenUsage,
} from '$lib/types/chat'
import type { ServerMessage } from '$lib/types/protocol'
import { getWSClient } from '$lib/stores/connection.svelte'
import { getViewContext } from '$lib/stores/navigation.svelte'

// ── State ─────────────────────────────────────────────────────────────

let conversations = $state<Conversation[]>([])
let activeConversationId = $state<string | null>(null)
let messages = $state<ChatMessage[]>([])
let dialogState = $state<DialogState>('idle')
let agentRunning = $state<Set<string>>(new Set())

// Streaming accumulator
let streamingText = $state('')
let liveToolBlocks = $state<LiveToolBlock[]>([])

// Track when we're waiting for a new conversation's ID
let awaitingConversation = $state(false)

// ── REST API helpers ──────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts)
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json()
}

// ── Public API ────────────────────────────────────────────────────────

export async function loadConversations(): Promise<void> {
  try {
    const raw = await apiFetch<any[]>('/api/conversations')
    conversations = raw.map(mapConversation)
  } catch (err) {
    console.error('[chat] Failed to load conversations:', err)
  }
}

export async function loadMessages(convId: string): Promise<void> {
  try {
    const raw = await apiFetch<any[]>(`/api/conversations/${convId}/messages`)
    messages = raw
      .filter((m: any) => m.message_type !== 'tool_result')
      .map(mapMessage)
  } catch (err) {
    console.error('[chat] Failed to load messages:', err)
  }
}

export async function selectConversation(convId: string): Promise<void> {
  activeConversationId = convId
  streamingText = ''
  liveToolBlocks = []
  dialogState = 'idle'

  await loadMessages(convId)

  // If agent is running for this conv, show thinking state
  if (agentRunning.has(convId)) {
    dialogState = 'thinking'
  }
}

export function newConversation(): void {
  activeConversationId = null
  messages = []
  streamingText = ''
  liveToolBlocks = []
  dialogState = 'idle'
}

export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  // Optimistic: add user message to UI
  const userMsg: ChatMessage = {
    id: `temp-${Date.now()}`,
    role: 'user',
    content: trimmed,
    createdAt: new Date().toISOString(),
  }
  messages = [...messages, userMsg]

  // Track that we're awaiting a new conversation ID
  const isNew = !activeConversationId
  if (isNew) awaitingConversation = true

  // Send via REST (fire-and-forget, events come via WS)
  try {
    const context = getViewContext()
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: trimmed,
        conversationId: activeConversationId || undefined,
        context: context.type !== 'overview' ? context : undefined,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      // Set conversation ID if we don't have one yet
      // (agent_start event may have already set it via the race handler)
      if (data.conversationId && !activeConversationId) {
        activeConversationId = data.conversationId
        awaitingConversation = false
      }
    }
  } catch (err) {
    console.error('[chat] Send failed:', err)
    awaitingConversation = false
  }

  // Refresh sidebar shortly to catch new conversation
  setTimeout(() => loadConversations(), 500)
}

export async function stopAgent(): Promise<void> {
  if (!activeConversationId) return
  try {
    await fetch(`/api/conversations/${activeConversationId}/stop`, {
      method: 'POST',
    })
  } catch (err) {
    console.error('[chat] Stop failed:', err)
  }
}

// ── Event handler (called from connection store) ──────────────────────

export function handleServerEvent(event: ServerMessage): void {
  const convId = 'conversationId' in event ? event.conversationId : undefined

  switch (event.type) {
    case 'agent_start': {
      if (convId) {
        agentRunning = new Set([...agentRunning, convId])
      }
      // Adopt conversation ID for new conversations (handles race with REST response)
      if (!activeConversationId && awaitingConversation && convId) {
        activeConversationId = convId
        awaitingConversation = false
      }
      if (convId === activeConversationId) {
        dialogState = 'thinking'
        streamingText = ''
        liveToolBlocks = []
      }
      break
    }

    case 'text_chunk': {
      if (convId === activeConversationId || (!convId && activeConversationId)) {
        dialogState = 'streaming'
        streamingText += event.text
      }
      break
    }

    case 'tool_use': {
      if (convId === activeConversationId || (!convId && activeConversationId)) {
        dialogState = 'tool_running'
        // Finalize any current streaming text as a message segment
        const block: LiveToolBlock = {
          toolUseId: event.toolUseId,
          name: event.name,
          input: event.input,
          status: 'running',
          startedAt: Date.now(),
        }
        liveToolBlocks = [...liveToolBlocks, block]
      }
      break
    }

    case 'tool_result': {
      if (convId === activeConversationId || (!convId && activeConversationId)) {
        liveToolBlocks = liveToolBlocks.map(b =>
          b.toolUseId === event.toolUseId
            ? { ...b, result: event.result, status: 'done' as const }
            : b
        )
      }
      break
    }

    case 'agent_done': {
      if (convId) {
        const next = new Set(agentRunning)
        next.delete(convId)
        agentRunning = next
      }
      if (convId === activeConversationId || (!convId && activeConversationId)) {
        // Finalize: re-load messages from server to get authoritative state
        dialogState = 'idle'
        if (activeConversationId) {
          loadMessages(activeConversationId)
        }
        streamingText = ''
        liveToolBlocks = []
      }
      loadConversations()
      break
    }

    case 'agent_stopped': {
      if (convId) {
        const next = new Set(agentRunning)
        next.delete(convId)
        agentRunning = next
      }
      if (convId === activeConversationId) {
        dialogState = 'idle'
        if (activeConversationId) {
          loadMessages(activeConversationId)
        }
        streamingText = ''
        liveToolBlocks = []
      }
      loadConversations()
      break
    }

    case 'title_update': {
      if (convId) {
        conversations = conversations.map(c =>
          c.id === convId ? { ...c, topic: event.title } : c
        )
      }
      break
    }

    case 'gitea_event': {
      // Notify listeners that Gitea state changed (repo created/deleted, issue opened, etc.)
      for (const fn of giteaEventListeners) fn(event as { type: 'gitea_event'; event: string; action?: string; repo?: string })
      break
    }

    default:
      break
  }
}

// ── Getters (reactive) ────────────────────────────────────────────────

export function getConversations(): Conversation[] {
  return conversations
}

export function getActiveConversationId(): string | null {
  return activeConversationId
}

export function getMessages(): ChatMessage[] {
  return messages
}

export function getDialogState(): DialogState {
  return dialogState
}

export function getStreamingText(): string {
  return streamingText
}

export function getLiveToolBlocks(): LiveToolBlock[] {
  return liveToolBlocks
}

export function isAgentRunning(convId: string): boolean {
  return agentRunning.has(convId)
}

export function getActiveConversation(): Conversation | undefined {
  if (!activeConversationId) return undefined
  return conversations.find(c => c.id === activeConversationId)
}

// ── Gitea event listeners ─────────────────────────────────────────────

export type GiteaEventData = { type: 'gitea_event'; event: string; action?: string; repo?: string }
type GiteaListener = (ev: GiteaEventData) => void
const giteaEventListeners = new Set<GiteaListener>()

export function onGiteaEvent(fn: GiteaListener): () => void {
  giteaEventListeners.add(fn)
  return () => { giteaEventListeners.delete(fn) }
}

// ── Mappers ───────────────────────────────────────────────────────────

function mapConversation(raw: any): Conversation {
  return {
    id: raw.id,
    topic: raw.topic || raw.channel || 'Untitled',
    channel: raw.channel || '',
    channelId: raw.channel_id || '',
    status: raw.status || 'open',
    tags: raw.tags || [],
    repo: raw.repo,
    createdAt: raw.created_at || raw.createdAt || '',
    updatedAt: raw.updated_at || raw.updatedAt || '',
    lastMessagePreview: raw.last_message_preview || undefined,
    usageCost: raw.usage_cost ? Number(raw.usage_cost) : undefined,
    usageInputTokens: raw.usage_input_tokens ? Number(raw.usage_input_tokens) : undefined,
    usageOutputTokens: raw.usage_output_tokens ? Number(raw.usage_output_tokens) : undefined,
  }
}

function mapMessage(raw: any): ChatMessage {
  // Extract text from content (can be string or array of blocks)
  let content = ''
  if (typeof raw.content === 'string') {
    content = raw.content
  } else if (Array.isArray(raw.content)) {
    content = raw.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
  }

  return {
    id: raw.id || `msg-${Date.now()}-${Math.random()}`,
    role: raw.role,
    content,
    toolCalls: raw.tool_calls,
    toolOutputs: raw.tool_outputs,
    usage: raw.usage ? mapUsage(raw.usage) : undefined,
    createdAt: raw.created_at || raw.createdAt || '',
  }
}

function mapUsage(raw: any): TokenUsage {
  return {
    inputTokens: raw.inputTokens || raw.input_tokens,
    outputTokens: raw.outputTokens || raw.output_tokens,
    cacheReadInputTokens: raw.cacheReadInputTokens || raw.cache_read_input_tokens,
    cacheCreationInputTokens: raw.cacheCreationInputTokens || raw.cache_creation_input_tokens,
    costUSD: raw.costUSD || raw.cost_usd,
    durationMs: raw.durationMs || raw.duration_ms,
    numTurns: raw.numTurns || raw.num_turns,
  }
}
