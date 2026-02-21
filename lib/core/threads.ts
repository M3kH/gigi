/**
 * Thread Store — Unified cross-channel thread model
 *
 * Replaces the channel-scoped conversation model with threads that can
 * span web, telegram, gitea comments, webhooks, and system events.
 *
 * Tables: threads, thread_refs, thread_events
 * See issue #39 for full schema documentation.
 */

import { getPool } from './store.js'

// ─── Types ──────────────────────────────────────────────────────────

export type ThreadStatus = 'active' | 'paused' | 'stopped' | 'archived'

export interface Thread {
  id: string
  topic: string | null
  status: ThreadStatus
  session_id: string | null
  summary: string | null
  parent_thread_id: string | null
  fork_point_event_id: string | null
  conversation_id: string | null  // backward-compat link
  created_at: string
  updated_at: string
  closed_at: string | null
  archived_at: string | null
}

export interface ThreadWithRefs extends Thread {
  refs: ThreadRef[]
}

export type ThreadRefType = 'issue' | 'pr' | 'commit' | 'branch'

export interface ThreadRef {
  id: string
  thread_id: string
  ref_type: ThreadRefType
  repo: string
  number: number | null
  ref: string | null
  url: string | null
  status: string | null
  created_at: string
}

export type ThreadEventChannel = 'web' | 'telegram' | 'gitea_comment' | 'gitea_review' | 'webhook' | 'system'
export type ThreadEventDirection = 'inbound' | 'outbound'

export interface ThreadEvent {
  id: string
  thread_id: string
  channel: ThreadEventChannel
  direction: ThreadEventDirection
  actor: string
  content: unknown
  message_type: string
  usage: unknown | null
  metadata: Record<string, unknown>
  is_compacted: boolean
  created_at: string
}

export interface CreateThreadOpts {
  topic?: string
  status?: ThreadStatus
  session_id?: string
  parent_thread_id?: string
  fork_point_event_id?: string
  conversation_id?: string
}

export interface AddThreadEventOpts {
  channel: ThreadEventChannel
  direction: ThreadEventDirection
  actor: string
  content: unknown
  message_type?: string
  usage?: unknown
  metadata?: Record<string, unknown>
}

export interface AddThreadRefOpts {
  ref_type: ThreadRefType
  repo: string
  number?: number
  ref?: string
  url?: string
  status?: string
}

export interface ThreadEventFilters {
  channel?: ThreadEventChannel
  direction?: ThreadEventDirection
  actor?: string
  message_type?: string
  include_compacted?: boolean
  limit?: number
  offset?: number
}

export interface ThreadListFilters {
  status?: ThreadStatus
  archived?: boolean  // true = only archived, false = only non-archived
  limit?: number
}

// ─── Thread CRUD ────────────────────────────────────────────────────

/**
 * Create a new thread.
 */
export const createThread = async (opts: CreateThreadOpts = {}): Promise<Thread> => {
  const pool = getPool()
  const { rows } = await pool.query(
    `INSERT INTO threads (topic, status, session_id, parent_thread_id, fork_point_event_id, conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      opts.topic ?? null,
      opts.status ?? 'paused',
      opts.session_id ?? null,
      opts.parent_thread_id ?? null,
      opts.fork_point_event_id ?? null,
      opts.conversation_id ?? null,
    ]
  )
  return rows[0]
}

/**
 * Get a thread by ID, optionally with its refs.
 */
export const getThread = async (id: string): Promise<ThreadWithRefs | null> => {
  const pool = getPool()
  const { rows } = await pool.query('SELECT * FROM threads WHERE id = $1', [id])
  if (!rows[0]) return null

  const { rows: refs } = await pool.query(
    'SELECT * FROM thread_refs WHERE thread_id = $1 ORDER BY created_at ASC',
    [id]
  )

  return { ...rows[0], refs }
}

/**
 * List threads with optional filters.
 */
export const listThreads = async (filters: ThreadListFilters = {}): Promise<Thread[]> => {
  const pool = getPool()
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (filters.status) {
    conditions.push(`status = $${i}`)
    params.push(filters.status)
    i++
  }
  if (filters.archived === true) {
    conditions.push('archived_at IS NOT NULL')
  } else if (filters.archived === false) {
    conditions.push('archived_at IS NULL')
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit ?? 50
  params.push(limit)

  const { rows } = await pool.query(
    `SELECT * FROM threads ${where} ORDER BY updated_at DESC LIMIT $${i}`,
    params
  )
  return rows
}

/**
 * Update a thread's status with timestamp tracking.
 */
export const updateThreadStatus = async (id: string, status: ThreadStatus): Promise<void> => {
  const pool = getPool()
  const extras: string[] = ['updated_at = now()']

  if (status === 'stopped') {
    extras.push('closed_at = COALESCE(closed_at, now())')
  } else if (status === 'archived') {
    extras.push('archived_at = COALESCE(archived_at, now())')
  } else if (status === 'paused' || status === 'active') {
    // Reopening: clear closed/archived timestamps
    extras.push('closed_at = NULL')
    extras.push('archived_at = NULL')
  }

  await pool.query(
    `UPDATE threads SET status = $2, ${extras.join(', ')} WHERE id = $1`,
    [id, status]
  )
}

/**
 * Set/update the Claude SDK session ID for a thread.
 */
export const setThreadSession = async (id: string, sessionId: string): Promise<void> => {
  const pool = getPool()
  await pool.query(
    `UPDATE threads SET session_id = $2, updated_at = now() WHERE id = $1`,
    [id, sessionId]
  )
}

/**
 * Update thread topic.
 */
export const updateThreadTopic = async (id: string, topic: string): Promise<void> => {
  const pool = getPool()
  await pool.query(
    `UPDATE threads SET topic = $2, updated_at = now() WHERE id = $1`,
    [id, topic]
  )
}

/**
 * Update thread summary (for compaction).
 */
export const updateThreadSummary = async (id: string, summary: string): Promise<void> => {
  const pool = getPool()
  await pool.query(
    `UPDATE threads SET summary = $2, updated_at = now() WHERE id = $1`,
    [id, summary]
  )
}

/**
 * Delete a thread and all its events/refs (cascade).
 */
export const deleteThread = async (id: string): Promise<void> => {
  const pool = getPool()
  await pool.query('DELETE FROM threads WHERE id = $1', [id])
}

// ─── Thread Events ──────────────────────────────────────────────────

/**
 * Add an event to a thread's timeline.
 */
export const addThreadEvent = async (threadId: string, opts: AddThreadEventOpts): Promise<ThreadEvent> => {
  const pool = getPool()
  // Touch the thread's updated_at
  await pool.query('UPDATE threads SET updated_at = now() WHERE id = $1', [threadId])

  const { rows } = await pool.query(
    `INSERT INTO thread_events (thread_id, channel, direction, actor, content, message_type, usage, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      threadId,
      opts.channel,
      opts.direction,
      opts.actor,
      JSON.stringify(opts.content),
      opts.message_type ?? 'text',
      opts.usage ? JSON.stringify(opts.usage) : null,
      JSON.stringify(opts.metadata ?? {}),
    ]
  )
  return rows[0]
}

/**
 * Get events for a thread with optional filtering and pagination.
 */
export const getThreadEvents = async (
  threadId: string,
  filters: ThreadEventFilters = {}
): Promise<ThreadEvent[]> => {
  const pool = getPool()
  const conditions: string[] = ['thread_id = $1']
  const params: unknown[] = [threadId]
  let i = 2

  if (filters.channel) {
    conditions.push(`channel = $${i}`)
    params.push(filters.channel)
    i++
  }
  if (filters.direction) {
    conditions.push(`direction = $${i}`)
    params.push(filters.direction)
    i++
  }
  if (filters.actor) {
    conditions.push(`actor = $${i}`)
    params.push(filters.actor)
    i++
  }
  if (filters.message_type) {
    conditions.push(`message_type = $${i}`)
    params.push(filters.message_type)
    i++
  }
  if (!filters.include_compacted) {
    conditions.push('is_compacted = false')
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const limit = filters.limit ?? 100
  const offset = filters.offset ?? 0
  params.push(limit, offset)

  const { rows } = await pool.query(
    `SELECT * FROM thread_events ${where}
     ORDER BY created_at ASC
     LIMIT $${i} OFFSET $${i + 1}`,
    params
  )
  return rows
}

/**
 * Count events in a thread (for pagination).
 */
export const countThreadEvents = async (threadId: string): Promise<number> => {
  const pool = getPool()
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS count FROM thread_events WHERE thread_id = $1 AND is_compacted = false',
    [threadId]
  )
  return parseInt(rows[0].count)
}

/**
 * Mark events as compacted (rolled into a summary).
 */
export const markEventsCompacted = async (threadId: string, beforeDate: string): Promise<number> => {
  const pool = getPool()
  const { rowCount } = await pool.query(
    `UPDATE thread_events SET is_compacted = true
     WHERE thread_id = $1 AND created_at < $2 AND is_compacted = false`,
    [threadId, beforeDate]
  )
  return rowCount ?? 0
}

// ─── Thread Refs ────────────────────────────────────────────────────

/**
 * Add a reference (issue, PR, branch, commit) to a thread.
 * Uses ON CONFLICT to upsert — if the ref already exists, updates the status.
 */
export const addThreadRef = async (threadId: string, opts: AddThreadRefOpts): Promise<ThreadRef> => {
  const pool = getPool()
  const { rows } = await pool.query(
    `INSERT INTO thread_refs (thread_id, ref_type, repo, number, ref, url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (thread_id, ref_type, repo, number)
     DO UPDATE SET status = COALESCE(EXCLUDED.status, thread_refs.status),
                   url = COALESCE(EXCLUDED.url, thread_refs.url)
     RETURNING *`,
    [
      threadId,
      opts.ref_type,
      opts.repo,
      opts.number ?? null,
      opts.ref ?? null,
      opts.url ?? null,
      opts.status ?? null,
    ]
  )
  return rows[0]
}

/**
 * Get all refs for a thread.
 */
export const getThreadRefs = async (threadId: string): Promise<ThreadRef[]> => {
  const pool = getPool()
  const { rows } = await pool.query(
    'SELECT * FROM thread_refs WHERE thread_id = $1 ORDER BY created_at ASC',
    [threadId]
  )
  return rows
}

/**
 * Find a thread by a linked reference (e.g., find the thread for issue gigi#39).
 */
export const findThreadByRef = async (
  repo: string,
  refType: ThreadRefType,
  number: number
): Promise<ThreadWithRefs | null> => {
  const pool = getPool()
  const { rows } = await pool.query(
    `SELECT t.* FROM threads t
     JOIN thread_refs r ON r.thread_id = t.id
     WHERE r.repo = $1 AND r.ref_type = $2 AND r.number = $3
     ORDER BY t.updated_at DESC
     LIMIT 1`,
    [repo, refType, number]
  )
  if (!rows[0]) return null

  const { rows: refs } = await pool.query(
    'SELECT * FROM thread_refs WHERE thread_id = $1 ORDER BY created_at ASC',
    [rows[0].id]
  )

  return { ...rows[0], refs }
}

/**
 * Update the status of a thread ref (e.g., when an issue is closed or PR merged).
 */
export const updateThreadRefStatus = async (
  repo: string,
  refType: ThreadRefType,
  number: number,
  status: string
): Promise<void> => {
  const pool = getPool()
  await pool.query(
    `UPDATE thread_refs SET status = $4
     WHERE repo = $1 AND ref_type = $2 AND number = $3`,
    [repo, refType, number, status]
  )
}

/**
 * Remove a ref from a thread.
 */
export const removeThreadRef = async (refId: string): Promise<void> => {
  const pool = getPool()
  await pool.query('DELETE FROM thread_refs WHERE id = $1', [refId])
}

// ─── Migration Helper ───────────────────────────────────────────────

/**
 * Migrate existing conversations + messages into the thread model.
 * Creates a thread per conversation and thread_events per message.
 * Parses tags to create thread_refs.
 *
 * This is idempotent — it only migrates conversations that don't already
 * have a linked thread (via threads.conversation_id).
 */
export const migrateConversationsToThreads = async (): Promise<{
  threadsCreated: number
  eventsCreated: number
  refsCreated: number
}> => {
  const pool = getPool()
  let threadsCreated = 0
  let eventsCreated = 0
  let refsCreated = 0

  // Find conversations that haven't been migrated yet
  const { rows: conversations } = await pool.query(`
    SELECT c.* FROM conversations c
    LEFT JOIN threads t ON t.conversation_id = c.id
    WHERE t.id IS NULL
    ORDER BY c.created_at ASC
  `)

  for (const conv of conversations) {
    // Map conversation status to thread status
    let threadStatus: ThreadStatus = 'paused'
    if (conv.status === 'active') threadStatus = 'active'
    else if (conv.status === 'closed') threadStatus = 'stopped'

    if (conv.archived_at) threadStatus = 'archived'

    // Create thread
    const { rows: [thread] } = await pool.query(
      `INSERT INTO threads (topic, status, session_id, conversation_id, created_at, updated_at, closed_at, archived_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        conv.topic,
        threadStatus,
        conv.session_id,
        conv.id,
        conv.created_at,
        conv.updated_at,
        conv.closed_at,
        conv.archived_at,
      ]
    )
    threadsCreated++

    // Migrate messages to thread_events
    const { rows: messages } = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conv.id]
    )

    for (const msg of messages) {
      const direction = msg.role === 'user' ? 'inbound' : 'outbound'
      const actor = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'gigi' : 'system'
      const channel = conv.channel === 'webhook' ? 'webhook' : conv.channel === 'telegram' ? 'telegram' : 'web'

      await pool.query(
        `INSERT INTO thread_events (thread_id, channel, direction, actor, content, message_type, usage, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          thread.id,
          channel,
          direction,
          actor,
          JSON.stringify(msg.content),
          msg.message_type || 'text',
          msg.usage ? JSON.stringify(msg.usage) : null,
          JSON.stringify({
            legacy_message_id: msg.id,
            legacy_conversation_id: conv.id,
            ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
            ...(msg.tool_outputs ? { tool_outputs: msg.tool_outputs } : {}),
          }),
          msg.created_at,
        ]
      )
      eventsCreated++
    }

    // Parse tags into thread_refs
    const tags: string[] = conv.tags || []
    for (const tag of tags) {
      const issueMatch = tag.match(/^(.+)#(\d+)$/)
      if (issueMatch && !tag.startsWith('pr#')) {
        const [, repo, num] = issueMatch
        await pool.query(
          `INSERT INTO thread_refs (thread_id, ref_type, repo, number)
           VALUES ($1, 'issue', $2, $3)
           ON CONFLICT (thread_id, ref_type, repo, number) DO NOTHING`,
          [thread.id, repo, parseInt(num)]
        )
        refsCreated++
      }
      const prMatch = tag.match(/^pr#(\d+)$/)
      if (prMatch && conv.repo) {
        await pool.query(
          `INSERT INTO thread_refs (thread_id, ref_type, repo, number)
           VALUES ($1, 'pr', $2, $3)
           ON CONFLICT (thread_id, ref_type, repo, number) DO NOTHING`,
          [thread.id, conv.repo, parseInt(prMatch[1])]
        )
        refsCreated++
      }
    }
  }

  return { threadsCreated, eventsCreated, refsCreated }
}

// ─── Thread Usage Analytics ─────────────────────────────────────────

/**
 * Get token usage stats for a thread.
 */
export const getThreadUsage = async (threadId: string): Promise<{
  input_tokens: number
  output_tokens: number
  total_cost: number
  event_count: number
}> => {
  const pool = getPool()
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM((usage->>'inputTokens')::int), 0) AS input_tokens,
      COALESCE(SUM((usage->>'outputTokens')::int), 0) AS output_tokens,
      COALESCE(SUM((usage->>'costUSD')::numeric), 0) AS total_cost,
      COUNT(*) AS event_count
    FROM thread_events
    WHERE thread_id = $1 AND usage IS NOT NULL
  `, [threadId])
  return {
    input_tokens: parseInt(rows[0].input_tokens),
    output_tokens: parseInt(rows[0].output_tokens),
    total_cost: parseFloat(rows[0].total_cost),
    event_count: parseInt(rows[0].event_count),
  }
}
