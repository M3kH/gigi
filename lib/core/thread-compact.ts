/**
 * Thread Compact — Summarize and reduce thread context
 *
 * Implements two compaction modes:
 * 1. In-place compact: summarize older events, keep recent ones in full
 * 2. Fork-compact: create a new thread starting with a summary of the original
 *
 * Uses Haiku for cost-efficient summary generation.
 *
 * See issue #40 for full specification.
 */

import {
  getThread,
  getThreadEvents,
  addThreadEvent,
  markEventsCompacted,
  updateThreadSummary,
  createThread,
  addThreadRef,
  getThreadRefs,
  countThreadEvents,
  type ThreadEvent,
  type ThreadRef,
} from './threads.js'
import { queryLLM } from './agent.js'

// ─── Types ──────────────────────────────────────────────────────────

export interface CompactResult {
  thread_id: string
  summary_event_id: string
  compacted_count: number
  summary: string
}

export interface ForkCompactResult {
  original_thread_id: string
  new_thread_id: string
  summary_event_id: string
  compacted_count: number
  summary: string
}

export interface CompactOptions {
  /** Number of recent events to keep in full detail (default: 10) */
  keep_recent?: number
}

// ─── Summary Generation ─────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are a thread summarizer. Given a sequence of conversation events from a cross-channel thread (web, telegram, gitea, webhooks), produce a concise summary.

Your summary MUST include:
- Key decisions made
- Current state/status of the work
- Linked issues, PRs, or branches (with numbers)
- Pending actions or unresolved questions
- Who participated and through which channels

Format the summary as a structured, readable paragraph. Be concise but preserve important context that would be needed to continue the conversation.
Do NOT include any preamble like "Here is a summary" — just output the summary directly.`

/**
 * Extract readable text from a thread event's content field.
 */
const extractEventText = (event: ThreadEvent): string => {
  const content = event.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n')
  }
  // For webhook/tool events, JSON-stringify for context
  if (content && typeof content === 'object') {
    try {
      return JSON.stringify(content).slice(0, 500)
    } catch {
      return '[non-text content]'
    }
  }
  return ''
}

/**
 * Format events into a prompt for the summarizer.
 */
const formatEventsForSummary = (events: ThreadEvent[]): string => {
  return events.map(e => {
    const text = extractEventText(e)
    const timestamp = new Date(e.created_at).toISOString().slice(0, 16)
    const truncated = text.length > 600 ? text.slice(0, 600) + '...' : text
    return `[${timestamp}] [${e.channel}/${e.direction}] ${e.actor}: ${truncated}`
  }).join('\n\n')
}

/**
 * Generate a summary of thread events using Haiku for cost efficiency.
 * Uses queryLLM() which reuses the centralized agent auth (OAuth + API keys).
 */
export const generateSummary = async (events: ThreadEvent[]): Promise<string> => {
  if (events.length === 0) return 'No events to summarize.'

  const formattedEvents = formatEventsForSummary(events)
  const prompt = `Summarize this thread history (${events.length} events):\n\n${formattedEvents}`

  try {
    const text = await queryLLM(prompt, SUMMARY_SYSTEM_PROMPT, 'claude-haiku-4-5')
    return text || 'Summary generation produced no output.'
  } catch (err) {
    console.error('[compact] Summary generation failed:', (err as Error).message)
    return formatBasicSummary(events)
  }
}

/**
 * Fallback: basic summary without LLM (when queryLLM fails).
 */
const formatBasicSummary = (events: ThreadEvent[]): string => {
  const channels = [...new Set(events.map(e => e.channel))]
  const actors = [...new Set(events.map(e => e.actor))]
  const firstDate = events[0]?.created_at ? new Date(events[0].created_at).toISOString().slice(0, 10) : 'unknown'
  const lastDate = events[events.length - 1]?.created_at
    ? new Date(events[events.length - 1].created_at).toISOString().slice(0, 10)
    : 'unknown'

  return `Thread with ${events.length} events from ${firstDate} to ${lastDate}. Channels: ${channels.join(', ')}. Participants: ${actors.join(', ')}.`
}

// ─── In-Place Compact ───────────────────────────────────────────────

/**
 * Compact a thread in-place: summarize older events and keep recent ones.
 *
 * Steps:
 * 1. Load all non-compacted events
 * 2. Split into older (to summarize) and recent (to keep)
 * 3. Generate summary via Haiku
 * 4. Mark older events as compacted
 * 5. Insert a summary event
 * 6. Update thread's summary field
 */
export const compactThread = async (
  threadId: string,
  opts: CompactOptions = {}
): Promise<CompactResult> => {
  const keepRecent = opts.keep_recent ?? 10

  // Verify thread exists
  const thread = await getThread(threadId)
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`)
  }

  // Load all non-compacted events
  const allEvents = await getThreadEvents(threadId, {
    include_compacted: false,
    limit: 10000, // high limit to get all
  })

  if (allEvents.length <= keepRecent) {
    throw new Error(
      `Thread has only ${allEvents.length} events — nothing to compact (keep_recent: ${keepRecent})`
    )
  }

  // Split: older events get summarized, recent ones kept
  const olderEvents = allEvents.slice(0, -keepRecent)
  const cutoffDate = allEvents[allEvents.length - keepRecent].created_at

  // Generate summary
  const summary = await generateSummary(olderEvents)

  // Mark older events as compacted
  const compactedCount = await markEventsCompacted(threadId, cutoffDate)

  // Insert summary event
  const summaryEvent = await addThreadEvent(threadId, {
    channel: 'system',
    direction: 'outbound',
    actor: 'system',
    content: [{ type: 'text', text: summary }],
    message_type: 'summary',
    metadata: {
      compact_type: 'in-place',
      compacted_count: compactedCount,
      compacted_before: cutoffDate,
    },
  })

  // Update thread's summary field
  await updateThreadSummary(threadId, summary)

  console.log(`[compact] In-place compact: ${compactedCount} events summarized for thread ${threadId}`)

  return {
    thread_id: threadId,
    summary_event_id: summaryEvent.id,
    compacted_count: compactedCount,
    summary,
  }
}

// ─── Fork-Compact ───────────────────────────────────────────────────

/**
 * Fork-compact: create a new thread that starts with a summary of the original.
 *
 * Steps:
 * 1. Load all events from the original thread
 * 2. Generate summary
 * 3. Create new thread with parent_thread_id pointing to original
 * 4. Copy all thread_refs to the new thread
 * 5. Insert summary as first event in new thread
 * 6. Return the new thread info
 */
export const forkCompactThread = async (
  threadId: string,
  opts: { topic?: string } = {}
): Promise<ForkCompactResult> => {
  // Verify original thread exists
  const originalThread = await getThread(threadId)
  if (!originalThread) {
    throw new Error(`Thread ${threadId} not found`)
  }

  // Load all events from original
  const allEvents = await getThreadEvents(threadId, {
    include_compacted: true, // include everything for a complete summary
    limit: 10000,
  })

  if (allEvents.length === 0) {
    throw new Error(`Thread ${threadId} has no events to summarize`)
  }

  // Get the last event ID as the fork point
  const lastEvent = allEvents[allEvents.length - 1]

  // Generate summary of the entire thread
  const summary = await generateSummary(allEvents)

  // Create new thread
  const newThread = await createThread({
    topic: opts.topic || `Fork of: ${originalThread.topic || 'Untitled thread'}`,
    status: 'paused',
    parent_thread_id: threadId,
    fork_point_event_id: lastEvent.id,
  })

  // Copy all refs from original to new thread
  const originalRefs = await getThreadRefs(threadId)
  for (const ref of originalRefs) {
    await addThreadRef(newThread.id, {
      ref_type: ref.ref_type,
      repo: ref.repo,
      number: ref.number ?? undefined,
      ref: ref.ref ?? undefined,
      url: ref.url ?? undefined,
      status: ref.status ?? undefined,
    })
  }

  // Insert summary as first event in new thread
  const summaryEvent = await addThreadEvent(newThread.id, {
    channel: 'system',
    direction: 'outbound',
    actor: 'system',
    content: [{ type: 'text', text: summary }],
    message_type: 'summary',
    metadata: {
      compact_type: 'fork',
      source_thread_id: threadId,
      source_event_count: allEvents.length,
      fork_point_event_id: lastEvent.id,
    },
  })

  // Update new thread's summary field
  await updateThreadSummary(newThread.id, summary)

  console.log(`[compact] Fork-compact: thread ${threadId} (${allEvents.length} events) → new thread ${newThread.id}`)

  return {
    original_thread_id: threadId,
    new_thread_id: newThread.id,
    summary_event_id: summaryEvent.id,
    compacted_count: allEvents.length,
    summary,
  }
}

// ─── Context Builder ────────────────────────────────────────────────

/**
 * Channel labels for attribution in agent context.
 * The agent sees these so it knows WHERE each message originated.
 */
const CHANNEL_LABELS: Record<string, string> = {
  web: 'Web',
  telegram: 'Telegram',
  gitea_comment: 'Gitea comment',
  gitea_review: 'Gitea review',
  webhook: 'Webhook',
  system: 'System',
}

/**
 * Format a channel attribution prefix for an event.
 * Returns e.g., "[via Telegram]" or "[via Gitea comment by @mauro]"
 */
const formatChannelAttribution = (event: ThreadEvent): string => {
  const label = CHANNEL_LABELS[event.channel] ?? event.channel
  const actor = event.actor !== 'user' && event.actor !== 'gigi'
    ? ` by ${event.actor}`
    : ''
  return `[via ${label}${actor}]`
}

/**
 * Add channel attribution to an event's text content.
 * Only adds it for inbound events (user messages) — outbound events
 * from gigi don't need channel labels since they are responses.
 */
const addChannelAttributionToContent = (
  event: ThreadEvent,
  enableAttribution: boolean
): unknown => {
  // Don't add attribution if disabled or for gigi's own responses
  if (!enableAttribution || event.direction === 'outbound') {
    return event.content
  }

  const attribution = formatChannelAttribution(event)
  const content = event.content

  // For text content blocks, prepend the attribution
  if (Array.isArray(content)) {
    const blocks = content as Array<{ type: string; text?: string }>
    const firstTextIdx = blocks.findIndex(b => b.type === 'text' && b.text)
    if (firstTextIdx >= 0) {
      const modified = [...blocks]
      modified[firstTextIdx] = {
        ...modified[firstTextIdx],
        text: `${attribution} ${modified[firstTextIdx].text}`,
      }
      return modified
    }
  }

  if (typeof content === 'string') {
    return `${attribution} ${content}`
  }

  return content
}

/**
 * Format linked refs as a context preamble for the agent.
 * Shows the thread's linked issues/PRs so the agent knows the context.
 */
const formatRefsContext = (refs: ThreadRef[]): string | null => {
  if (refs.length === 0) return null

  const lines = refs.map(r => {
    const num = r.number ? `#${r.number}` : r.ref || ''
    const status = r.status ? ` (${r.status})` : ''
    return `- ${r.ref_type} ${r.repo}${num}${status}${r.url ? ` — ${r.url}` : ''}`
  })

  return `[LINKED REFS]\n${lines.join('\n')}`
}

export interface BuildContextOptions {
  /** Add channel attribution prefixes like [via Telegram] to messages (default: true) */
  channelAttribution?: boolean
  /** Include linked refs as context preamble (default: true) */
  includeRefs?: boolean
}

export interface BuildContextResult {
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>
  /** Estimated token count of the context (rough: ~4 chars per token) */
  estimatedTokens: number
  /** Number of thread events included */
  eventCount: number
  /** Channels represented in the context */
  channels: string[]
}

/**
 * Estimate token count for a content block.
 * Uses a rough heuristic: ~4 characters per token (works for English text).
 * Good enough for budget checks — not meant to be precise.
 */
export const estimateTokens = (content: unknown): number => {
  if (typeof content === 'string') return Math.ceil(content.length / 4)
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .reduce((sum, b) => sum + (b.text ? Math.ceil(b.text.length / 4) : 0), 0)
  }
  if (content && typeof content === 'object') {
    try { return Math.ceil(JSON.stringify(content).length / 4) } catch { return 0 }
  }
  return 0
}

/**
 * Build agent context messages from a thread, using summaries when available.
 *
 * Full unified context pipeline (issue #43):
 * 1. Prepend linked refs context (issues, PRs linked to this thread)
 * 2. If thread has a summary event → use it as context preamble
 * 3. Load non-compacted events from all channels
 * 4. Add channel attribution to each message so agent knows the source
 * 5. Convert to agent message format: [refs?, summary?, ...events]
 * 6. Estimate token count for budget awareness
 *
 * This replaces the sliding window approach in router.ts for threads.
 */
export const buildThreadContext = async (
  threadId: string,
  opts: BuildContextOptions = {}
): Promise<BuildContextResult> => {
  const enableAttribution = opts.channelAttribution ?? true
  const includeRefs = opts.includeRefs ?? true

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  const channelsSet = new Set<string>()
  let totalTokens = 0

  // 1. Load and prepend linked refs
  if (includeRefs) {
    const refs = await getThreadRefs(threadId)
    const refsText = formatRefsContext(refs)
    if (refsText) {
      const refsContent = [{ type: 'text', text: refsText }]
      messages.push({ role: 'user', content: refsContent })
      totalTokens += estimateTokens(refsContent)
    }
  }

  // 2. Load non-compacted events (summary events are NOT compacted, so they appear)
  const events = await getThreadEvents(threadId, {
    include_compacted: false,
    limit: 10000,
  })

  if (events.length === 0 && messages.length === 0) {
    return { messages: [], estimatedTokens: 0, eventCount: 0, channels: [] }
  }

  // 3. Convert each event to agent message format
  for (const event of events) {
    channelsSet.add(event.channel)

    // Map event direction/actor to message role
    const role: 'user' | 'assistant' =
      event.direction === 'inbound' ? 'user' : 'assistant'

    // Summary events get a special prefix for clarity
    if (event.message_type === 'summary') {
      const summaryText = extractEventText(event)
      const metadata = event.metadata as Record<string, unknown>
      const compactedCount = metadata?.compacted_count ?? metadata?.source_event_count ?? '?'
      const content = [
        {
          type: 'text',
          text: `[THREAD SUMMARY — ${compactedCount} earlier events condensed]\n${summaryText}`,
        },
      ]
      messages.push({ role: 'user', content })
      totalTokens += estimateTokens(content)
      continue
    }

    // Add channel attribution for cross-channel awareness
    const content = addChannelAttributionToContent(event, enableAttribution)
    messages.push({ role, content })
    totalTokens += estimateTokens(content)
  }

  return {
    messages,
    estimatedTokens: totalTokens,
    eventCount: events.length,
    channels: [...channelsSet],
  }
}

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Check if a thread would benefit from compaction.
 * Returns suggested action and reason.
 */
export const shouldCompact = async (
  threadId: string,
  threshold: number = 20
): Promise<{ shouldCompact: boolean; eventCount: number; reason: string }> => {
  const count = await countThreadEvents(threadId)

  if (count > threshold) {
    return {
      shouldCompact: true,
      eventCount: count,
      reason: `Thread has ${count} events (threshold: ${threshold})`,
    }
  }

  return {
    shouldCompact: false,
    eventCount: count,
    reason: `Thread has ${count} events — below threshold of ${threshold}`,
  }
}
