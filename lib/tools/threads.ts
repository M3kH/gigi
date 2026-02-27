/**
 * MCP Tool — Thread Management
 *
 * Agent-callable tools for managing threads: list, switch, create, and inspect.
 * These enable the agent to navigate thread trees, spawn sub-threads, and
 * provide thread-aware responses.
 *
 * See issue #297 — Phase 0: Telegram Thread Binding
 */

import { z } from 'zod'
import type { AgentTool } from '../core/registry'

// All thread operations go through the internal HTTP API to stay in-process
// with the main Gigi server (same pattern as ask-user tool).
const internalFetch = async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
  const port = process.env.PORT || '3000'
  const baseUrl = `http://localhost:${port}`

  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${baseUrl}${path}`, opts)
  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown error')
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

// ── Schemas ──────────────────────────────────────────────────────────

const ListThreadsSchema = z.object({
  status: z.enum(['active', 'paused', 'stopped', 'archived']).optional()
    .describe('Filter by thread status'),
  limit: z.number().optional().default(10)
    .describe('Max threads to return (default 10)'),
})

const SwitchThreadSchema = z.object({
  thread_id: z.string().optional()
    .describe('Thread ID to switch to (use this OR ref)'),
  ref: z.string().optional()
    .describe('Reference like "gigi#234" to find thread by linked issue/PR'),
})

const CreateThreadSchema = z.object({
  topic: z.string().describe('Thread topic/name'),
  parent_thread_id: z.string().optional()
    .describe('Parent thread ID to create a sub-thread'),
})

const GetThreadSchema = z.object({
  thread_id: z.string().optional()
    .describe('Thread ID to inspect (defaults to current thread)'),
})

// ── Handlers ─────────────────────────────────────────────────────────

const listThreads = async (input: z.infer<typeof ListThreadsSchema>): Promise<unknown> => {
  try {
    const params = new URLSearchParams()
    if (input.status) params.set('status', input.status)
    if (input.limit) params.set('limit', String(input.limit))
    const qs = params.toString()
    const result = await internalFetch(`/api/threads${qs ? '?' + qs : ''}`)
    return result
  } catch (err) {
    return `Error listing threads: ${(err as Error).message}`
  }
}

const switchThread = async (input: z.infer<typeof SwitchThreadSchema>): Promise<unknown> => {
  try {
    if (!input.thread_id && !input.ref) {
      return 'Provide either thread_id or ref (e.g., "gigi#234")'
    }

    if (input.ref) {
      const refMatch = input.ref.match(/^([a-z0-9._-]+)#(\d+)$/i)
      if (refMatch) {
        const [, repo, num] = refMatch
        const result = await internalFetch(`/api/threads/by-ref/${repo}/issue/${num}`)
        if (result && typeof result === 'object' && 'id' in (result as Record<string, unknown>)) {
          return { switched: true, thread: result }
        }
        // Try PR ref
        const prResult = await internalFetch(`/api/threads/by-ref/${repo}/pr/${num}`)
        if (prResult && typeof prResult === 'object' && 'id' in (prResult as Record<string, unknown>)) {
          return { switched: true, thread: prResult }
        }
        return `No thread found for ref ${input.ref}`
      }
      return `Invalid ref format: ${input.ref}. Use "repo#number" format.`
    }

    const thread = await internalFetch(`/api/threads/${input.thread_id}`)
    return { switched: true, thread }
  } catch (err) {
    return `Error switching thread: ${(err as Error).message}`
  }
}

const createThread = async (input: z.infer<typeof CreateThreadSchema>): Promise<unknown> => {
  try {
    // Use the fork endpoint if parent is specified, otherwise create via spawn
    if (input.parent_thread_id) {
      const result = await internalFetch(
        `/api/threads/${input.parent_thread_id}/fork`,
        'POST',
        { topic: input.topic, compact: true }
      )
      return result
    }

    // For top-level threads, we need to create a conversation + thread
    // This is handled implicitly when the next message is sent
    return {
      note: `Thread "${input.topic}" will be created when the next message is sent in this context.`,
      topic: input.topic,
    }
  } catch (err) {
    return `Error creating thread: ${(err as Error).message}`
  }
}

const getThread = async (input: z.infer<typeof GetThreadSchema>): Promise<unknown> => {
  try {
    if (!input.thread_id) {
      return 'No thread_id provided. Use /thread in Telegram or provide a thread_id.'
    }

    const thread = await internalFetch(`/api/threads/${input.thread_id}`)
    const lineage = await internalFetch(`/api/threads/${input.thread_id}/lineage`)
    return { thread, lineage }
  } catch (err) {
    return `Error getting thread: ${(err as Error).message}`
  }
}

// ── Exports ──────────────────────────────────────────────────────────

export const agentTools: AgentTool[] = [
  {
    name: 'list_threads',
    description: 'List active threads with status, topic, and linked refs (issues/PRs). Use to understand the current thread landscape.',
    schema: ListThreadsSchema,
    handler: listThreads,
    context: 'server',
    permission: 'threads.read',
  },
  {
    name: 'switch_thread',
    description: 'Switch the current channel to a different thread. Use thread_id directly or provide a ref like "gigi#234" to find the thread by linked issue/PR.',
    schema: SwitchThreadSchema,
    handler: switchThread,
    context: 'server',
    permission: 'threads.write',
  },
  {
    name: 'create_thread',
    description: 'Create a new thread, optionally as a sub-thread of a parent. Use for forking work into focused sub-threads.',
    schema: CreateThreadSchema,
    handler: createThread,
    context: 'server',
    permission: 'threads.write',
  },
  {
    name: 'get_thread',
    description: 'Get detailed info about a thread including its lineage (parent, children, fork point).',
    schema: GetThreadSchema,
    handler: getThread,
    context: 'server',
    permission: 'threads.read',
  },
]
