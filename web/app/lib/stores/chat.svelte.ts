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
  StreamSegment,
  DialogState,
  TokenUsage,
  ThreadStatus,
  ThreadLineage,
  ThreadEvent,
  ThreadRef,
  CompactStatus,
} from '$lib/types/chat'
import type { ServerMessage } from '$lib/types/protocol'
import { fetchBoard } from '$lib/stores/kanban.svelte'
import { applyEvent, answerSegment as applyAnswer } from '$lib/utils/segment-builder'
import { getWSClient } from '$lib/stores/connection.svelte'
import { getViewContext } from '$lib/stores/navigation.svelte'

// ── State ─────────────────────────────────────────────────────────────

let conversations = $state<Conversation[]>([])
let archivedConversations = $state<Conversation[]>([])
let activeConversationId = $state<string | null>(null)
let messages = $state<ChatMessage[]>([])
let dialogState = $state<DialogState>('idle')
let agentRunning = $state<Set<string>>(new Set())

// Unified streaming segments
let streamSegments = $state<StreamSegment[]>([])

// Track when we're waiting for a new conversation's ID
let awaitingConversation = $state(false)

// System prompt prepended to the next user message (e.g. from greeting flow)
let pendingPrompt = $state<string | null>(null)

// ── REST API helpers ──────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts)
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json()
}

// ── Public API ────────────────────────────────────────────────────────

export async function loadConversations(): Promise<void> {
  try {
    const [active, archived] = await Promise.all([
      apiFetch<any[]>('/api/conversations?archived=false'),
      apiFetch<any[]>('/api/conversations?archived=true'),
    ])
    conversations = active.map(mapConversation)
    archivedConversations = archived.map(mapConversation)
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
  streamSegments = []
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
  streamSegments = []
  dialogState = 'idle'
}

/** Add a local-only message to the chat (not sent to the agent) */
export function addLocalMessage(role: 'user' | 'assistant', content: string): void {
  messages = [...messages, {
    id: `local-${Date.now()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  }]
}

/** Queue a hidden prompt to prepend to the next user message */
export function setPendingPrompt(prompt: string): void {
  pendingPrompt = prompt
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

  // Consume pending prompt (e.g. "make sure to create a repo for: ...")
  let agentMessage = trimmed
  if (pendingPrompt) {
    agentMessage = `${pendingPrompt}\n\n${trimmed}`
    pendingPrompt = null
  }

  // Send via REST (fire-and-forget, events come via WS)
  try {
    const context = getViewContext()
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: agentMessage,
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

export async function archiveConversation(convId: string): Promise<void> {
  try {
    await fetch(`/api/conversations/${convId}/archive`, { method: 'POST' })
    await loadConversations()
    // If we archived the active conversation, deselect it
    if (activeConversationId === convId) {
      activeConversationId = null
      messages = []
      streamSegments = []
    }
  } catch (err) {
    console.error('[chat] Archive failed:', err)
  }
}

export async function unarchiveConversation(convId: string): Promise<void> {
  try {
    await fetch(`/api/conversations/${convId}/unarchive`, { method: 'POST' })
    await loadConversations()
  } catch (err) {
    console.error('[chat] Unarchive failed:', err)
  }
}

export async function deleteConversation(convId: string): Promise<void> {
  try {
    await fetch(`/api/conversations/${convId}`, { method: 'DELETE' })
    await loadConversations()
    if (activeConversationId === convId) {
      activeConversationId = null
      messages = []
      streamSegments = []
    }
  } catch (err) {
    console.error('[chat] Delete failed:', err)
  }
}

/**
 * Fork a conversation/thread — creates a copy to explore alternate directions.
 * Navigates to the forked thread after creation.
 */
export async function forkConversation(convId: string, opts?: { topic?: string; compact?: boolean }): Promise<string | null> {
  try {
    const res = await fetch(`/api/threads/${convId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: opts?.topic,
        compact: opts?.compact ?? false,
      }),
    })
    if (!res.ok) {
      console.error('[chat] Fork failed:', res.status)
      return null
    }
    const forked = await res.json()
    // Refresh conversation list and select the fork
    await loadConversations()
    await selectConversation(forked.id)
    return forked.id
  } catch (err) {
    console.error('[chat] Fork failed:', err)
    return null
  }
}

/**
 * Fetch lineage info for a thread (parent, children, fork point).
 */
export async function getThreadLineage(threadId: string): Promise<ThreadLineage | null> {
  try {
    return await apiFetch<ThreadLineage>(`/api/threads/${threadId}/lineage`)
  } catch {
    return null
  }
}

/**
 * Fetch thread events (unified timeline).
 * Excludes compacted events by default unless includeCompacted is true.
 */
export async function getThreadEvents(threadId: string, includeCompacted = false): Promise<ThreadEvent[]> {
  try {
    const qs = includeCompacted ? '?include_compacted=true' : ''
    return await apiFetch<ThreadEvent[]>(`/api/threads/${threadId}/events${qs}`)
  } catch {
    return []
  }
}

/**
 * Fetch thread refs (linked issues, PRs, commits, branches).
 */
export async function getThreadRefs(threadId: string): Promise<ThreadRef[]> {
  try {
    const thread = await apiFetch<{ refs?: ThreadRef[] }>(`/api/threads/${threadId}`)
    return thread.refs || []
  } catch {
    return []
  }
}

/**
 * Check if a thread should be compacted (event count vs threshold).
 */
export async function getCompactStatus(threadId: string): Promise<CompactStatus | null> {
  try {
    return await apiFetch<CompactStatus>(`/api/threads/${threadId}/compact-status`)
  } catch {
    return null
  }
}

/**
 * Compact a thread (in-place). Summarizes older events and keeps recent ones.
 */
export async function compactThread(threadId: string, keepRecent = 10): Promise<void> {
  try {
    await fetch(`/api/threads/${threadId}/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'in-place', keep_recent: keepRecent }),
    })
    // Reload messages to reflect compacted state
    if (activeConversationId === threadId) {
      await loadMessages(threadId)
    }
  } catch (err) {
    console.error('[chat] Compact failed:', err)
  }
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

export async function stopThread(convId: string): Promise<void> {
  try {
    await fetch(`/api/conversations/${convId}/stop-thread`, { method: 'POST' })
    conversations = conversations.map(c =>
      c.id === convId ? { ...c, status: 'stopped' as ThreadStatus } : c
    )
  } catch (err) {
    console.error('[chat] Stop thread failed:', err)
  }
}

export async function reopenThread(convId: string): Promise<void> {
  try {
    await fetch(`/api/conversations/${convId}/reopen`, { method: 'POST' })
    // Move from archived to conversations if needed
    const archived = archivedConversations.find(c => c.id === convId)
    if (archived) {
      archivedConversations = archivedConversations.filter(c => c.id !== convId)
      conversations = [{ ...archived, status: 'paused' as ThreadStatus, archivedAt: null }, ...conversations]
    } else {
      conversations = conversations.map(c =>
        c.id === convId ? { ...c, status: 'paused' as ThreadStatus } : c
      )
    }
  } catch (err) {
    console.error('[chat] Reopen thread failed:', err)
  }
}

// ── Event handler (called from connection store) ──────────────────────

export function handleServerEvent(event: ServerMessage): void {
  const convId = 'conversationId' in event ? event.conversationId : undefined
  const isActive = convId === activeConversationId || (!convId && activeConversationId)

  switch (event.type) {
    case 'agent_start': {
      if (convId) {
        agentRunning = new Set([...agentRunning, convId])
        // Update conversation status to active
        conversations = conversations.map(c =>
          c.id === convId ? { ...c, status: 'active' as ThreadStatus } : c
        )
      }
      // Adopt conversation ID for new conversations (handles race with REST response)
      if (!activeConversationId && awaitingConversation && convId) {
        activeConversationId = convId
        awaitingConversation = false
      }
      if (convId === activeConversationId) {
        dialogState = 'thinking'
        streamSegments = []
      }
      break
    }

    case 'text_chunk': {
      if (isActive) {
        dialogState = 'streaming'
        streamSegments = applyEvent(streamSegments, event)
      }
      break
    }

    case 'tool_use': {
      if (isActive) {
        dialogState = 'tool_running'
        streamSegments = applyEvent(streamSegments, event)
      }
      break
    }

    case 'tool_result': {
      if (isActive) {
        streamSegments = applyEvent(streamSegments, event)
      }
      break
    }

    case 'agent_done': {
      if (convId) {
        const next = new Set(agentRunning)
        next.delete(convId)
        agentRunning = next
        // Update conversation status to paused
        conversations = conversations.map(c =>
          c.id === convId ? { ...c, status: 'paused' as ThreadStatus } : c
        )
      }
      if (isActive) {
        dialogState = 'idle'
        // Await loadMessages before clearing streamSegments so stored
        // messages are rendered before the live segments disappear.
        // Without this, there's a gap where both are empty and the user
        // sees "Send a message to get started" flash.
        if (activeConversationId) {
          loadMessages(activeConversationId).then(() => {
            streamSegments = []
          })
        } else {
          streamSegments = []
        }
      }
      loadConversations()
      // Refresh kanban board — agent may have changed issue labels/status
      fetchBoard().catch(() => { /* ignore */ })
      break
    }

    case 'agent_stopped': {
      if (convId) {
        const next = new Set(agentRunning)
        next.delete(convId)
        agentRunning = next
        // Update conversation status to paused
        conversations = conversations.map(c =>
          c.id === convId ? { ...c, status: 'paused' as ThreadStatus } : c
        )
      }
      if (convId === activeConversationId) {
        dialogState = 'idle'
        if (activeConversationId) {
          loadMessages(activeConversationId).then(() => {
            streamSegments = []
          })
        } else {
          streamSegments = []
        }
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

    case 'ask_user': {
      if (isActive) {
        dialogState = 'waiting_for_user'
        streamSegments = applyEvent(streamSegments, event)
      }
      break
    }

    case 'thread_status': {
      const status = (event as { status: ThreadStatus }).status
      if (convId) {
        // Update conversation status in real-time
        conversations = conversations.map(c =>
          c.id === convId ? { ...c, status } : c
        )
        // If thread is archived, move it to archived list
        if (status === 'archived') {
          const conv = conversations.find(c => c.id === convId)
          if (conv) {
            conversations = conversations.filter(c => c.id !== convId)
            archivedConversations = [{ ...conv, status: 'archived' }, ...archivedConversations]
          }
        }
        // If thread is unarchived (reopened), move it back
        if (status === 'paused' || status === 'active') {
          const archived = archivedConversations.find(c => c.id === convId)
          if (archived) {
            archivedConversations = archivedConversations.filter(c => c.id !== convId)
            conversations = [{ ...archived, status }, ...conversations]
          }
        }
      }
      break
    }

    case 'gitea_event': {
      // Notify listeners that Gitea state changed
      for (const fn of giteaEventListeners) fn(event as { type: 'gitea_event'; event: string; action?: string; repo?: string })
      // Also push a system segment into the chat
      if (activeConversationId) {
        streamSegments = applyEvent(streamSegments, event)
      }
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

export function getArchivedConversations(): Conversation[] {
  return archivedConversations
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

export function getStreamSegments(): StreamSegment[] {
  return streamSegments
}

export function answerQuestion(questionId: string, answer: string): void {
  // Mark as answered locally
  streamSegments = applyAnswer(streamSegments, questionId, answer)

  // Send answer to backend via WebSocket
  const ws = getWSClient()
  ws.send({ type: 'user:answer', questionId, answer })

  // Resume agent state
  if (dialogState === 'waiting_for_user') {
    dialogState = 'thinking'
  }
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
  // Map legacy status values to new lifecycle states
  let status: ThreadStatus = raw.status || 'paused'
  if (status === ('open' as string)) status = 'paused'
  if (status === ('closed' as string)) status = 'stopped'

  return {
    id: raw.id,
    topic: raw.topic || raw.channel || 'Untitled',
    channel: raw.channel || '',
    channelId: raw.channel_id || '',
    status,
    tags: raw.tags || [],
    repo: raw.repo,
    createdAt: raw.created_at || raw.createdAt || '',
    updatedAt: raw.updated_at || raw.updatedAt || '',
    archivedAt: raw.archived_at || raw.archivedAt || null,
    lastMessagePreview: raw.last_message_preview || undefined,
    usageCost: raw.usage_cost ? Number(raw.usage_cost) : undefined,
    usageInputTokens: raw.usage_input_tokens ? Number(raw.usage_input_tokens) : undefined,
    usageOutputTokens: raw.usage_output_tokens ? Number(raw.usage_output_tokens) : undefined,
  }
}

function mapMessage(raw: any): ChatMessage {
  // Extract text from content (can be string or array of blocks)
  let content = ''
  let interleavedContent: ChatMessage['interleavedContent'] = undefined

  if (typeof raw.content === 'string') {
    content = raw.content
  } else if (Array.isArray(raw.content)) {
    // Check if content has interleaved tool_use blocks (new format)
    const hasToolUse = raw.content.some((b: any) => b.type === 'tool_use')

    content = raw.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n\n')

    if (hasToolUse && raw.role === 'assistant') {
      interleavedContent = raw.content
        .filter((b: any) => b.type === 'text' || b.type === 'tool_use')
        .map((b: any) => {
          if (b.type === 'text') return { type: 'text' as const, text: b.text }
          return { type: 'tool_use' as const, toolUseId: b.toolUseId, name: b.name, input: b.input }
        })
    }
  }

  return {
    id: raw.id || `msg-${Date.now()}-${Math.random()}`,
    role: raw.role,
    content,
    interleavedContent,
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
