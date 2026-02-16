/**
 * Pure segment builder — transforms server events into an ordered StreamSegment array.
 *
 * No Svelte, no DOM — pure functions for testability.
 */

import type { StreamSegment } from '../types/chat'

/** Server event shape (mirrors ServerMessage but avoids Svelte import path) */
export type SegmentEvent =
  | { type: 'text_chunk'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; result: string }
  | { type: 'ask_user'; questionId: string; question: string; options?: string[] }
  | { type: 'gitea_event'; event: string; action?: string; repo?: string }

/**
 * Apply a server event to the current segments array.
 * Returns a new array (immutable).
 */
export function applyEvent(
  segments: StreamSegment[],
  event: SegmentEvent,
  now: number = Date.now(),
): StreamSegment[] {
  switch (event.type) {
    case 'text_chunk': {
      const last = segments[segments.length - 1]
      if (last && last.type === 'text') {
        // Merge consecutive text chunks
        return [
          ...segments.slice(0, -1),
          { type: 'text', content: last.content + event.text },
        ]
      }
      return [...segments, { type: 'text', content: event.text }]
    }

    case 'tool_use': {
      return [
        ...segments,
        {
          type: 'tool',
          toolUseId: event.toolUseId,
          name: event.name,
          input: event.input,
          status: 'running',
          startedAt: now,
        },
      ]
    }

    case 'tool_result': {
      const idx = segments.findIndex(
        (s) => s.type === 'tool' && s.toolUseId === event.toolUseId,
      )
      if (idx === -1) return segments // unknown tool — no-op
      const tool = segments[idx] as Extract<StreamSegment, { type: 'tool' }>
      return [
        ...segments.slice(0, idx),
        { ...tool, result: event.result, status: 'done' },
        ...segments.slice(idx + 1),
      ]
    }

    case 'ask_user': {
      return [
        ...segments,
        {
          type: 'ask_user',
          questionId: event.questionId,
          question: event.question,
          options: event.options ?? [],
        },
      ]
    }

    case 'gitea_event': {
      return [
        ...segments,
        {
          type: 'system',
          text: formatGiteaEvent(event.event, event.action, event.repo),
          event: event.event,
          action: event.action,
          repo: event.repo,
        },
      ]
    }

    default:
      return segments
  }
}

/**
 * Mark an ask_user segment as answered. Returns new array.
 */
export function answerSegment(
  segments: StreamSegment[],
  questionId: string,
  answer: string,
  now: number = Date.now(),
): StreamSegment[] {
  const idx = segments.findIndex(
    (s) => s.type === 'ask_user' && s.questionId === questionId,
  )
  if (idx === -1) return segments // unknown question — no-op
  const seg = segments[idx] as Extract<StreamSegment, { type: 'ask_user' }>
  return [
    ...segments.slice(0, idx),
    { ...seg, answer, answeredAt: now },
    ...segments.slice(idx + 1),
  ]
}

/**
 * Format a Gitea webhook event into a human-readable string.
 */
export function formatGiteaEvent(event: string, action?: string, repo?: string): string {
  const parts: string[] = []
  // Capitalize event type
  parts.push(event.charAt(0).toUpperCase() + event.slice(1))
  if (action) parts[0] += `: ${action}`
  if (repo) parts.push(repo)
  return parts.join(' — ')
}
