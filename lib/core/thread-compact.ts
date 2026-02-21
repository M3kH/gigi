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
 * Build agent context messages from a thread, using summaries when available.
 *
 * Strategy:
 * 1. If thread has a summary event → use it as the first message
 * 2. Load non-compacted events after the summary
 * 3. Convert to agent message format: [summary?, ...recent_events]
 *
 * This replaces the sliding window approach in router.ts for threads.
 */
export const buildThreadContext = async (
  threadId: string
): Promise<Array<{ role: 'user' | 'assistant'; content: unknown }>> => {
  // Load non-compacted events (summary events are NOT compacted, so they appear)
  const events = await getThreadEvents(threadId, {
    include_compacted: false,
    limit: 10000,
  })

  if (events.length === 0) return []

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []

  for (const event of events) {
    // Map event direction/actor to message role
    const role: 'user' | 'assistant' =
      event.direction === 'inbound' ? 'user' : 'assistant'

    // Summary events get a special prefix for clarity
    if (event.message_type === 'summary') {
      const summaryText = extractEventText(event)
      const metadata = event.metadata as Record<string, unknown>
      const compactedCount = metadata?.compacted_count ?? metadata?.source_event_count ?? '?'
      messages.push({
        role: 'user', // summaries are presented as context to the assistant
        content: [
          {
            type: 'text',
            text: `[THREAD SUMMARY — ${compactedCount} earlier events condensed]\n${summaryText}`,
          },
        ],
      })
      continue
    }

    messages.push({ role, content: event.content })
  }

  return messages
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
