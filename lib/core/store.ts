/**
 * Core Store — PostgreSQL persistence layer
 *
 * Manages config, conversations, messages, action logs, and sessions.
 */

import pg from 'pg'

const { Pool } = pg

// ─── Types ──────────────────────────────────────────────────────────

// Thread lifecycle states
export type ThreadStatus = 'active' | 'paused' | 'stopped' | 'archived'

export interface Conversation {
  id: string
  channel: string
  topic: string | null
  status: ThreadStatus
  tags: string[]
  repo: string | null
  session_id: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  archived_at: string | null
}

export interface ConversationWithPreview extends Conversation {
  last_message_preview: string | null
  usage_cost: number | null
  usage_input_tokens: number | null
  usage_output_tokens: number | null
}

export interface Message {
  id: string
  conversation_id: string
  role: string
  content: unknown
  tool_calls: unknown | null
  tool_outputs: unknown | null
  message_type: string
  usage: unknown | null
  created_at: string
}

export interface MessageContent {
  type: string
  text?: string
  [key: string]: unknown
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_cost: number
  messages_with_usage: number
}

export interface MessageExtras {
  tool_calls?: unknown
  tool_outputs?: unknown
  message_type?: string
  usage?: unknown
  github_user?: string
  triggered_by?: string
}

export interface ListFilters {
  status?: string
  tag?: string
  archived?: boolean  // true = only archived, false = only non-archived, undefined = all
}

export interface ConversationUpdate {
  topic?: string
  status?: string
  tags?: string[]
  repo?: string
  closed_at?: string
}

// ─── Connection ─────────────────────────────────────────────────────

let pool: InstanceType<typeof Pool>

export const connect = async (databaseUrl: string): Promise<InstanceType<typeof Pool>> => {
  pool = new Pool({ connectionString: databaseUrl })
  await pool.query('SELECT 1')
  await migrate()
  return pool
}

export const getPool = (): InstanceType<typeof Pool> => pool

export const disconnect = (): Promise<void> | undefined => pool?.end()

// ─── Migrations ─────────────────────────────────────────────────────

const migrate = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel TEXT NOT NULL,
      topic TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id SERIAL PRIMARY KEY,
      action_type VARCHAR(50) NOT NULL,
      repo VARCHAR(100) NOT NULL,
      ref_id VARCHAR(100),
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_channel
      ON conversations(channel, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_action_log_timestamp
      ON action_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_action_log_lookup
      ON action_log(action_type, repo, ref_id, created_at);

    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_id TEXT;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS repo TEXT;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls JSONB;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_outputs JSONB;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS usage JSONB;

    CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id) WHERE session_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_conversations_tags ON conversations USING GIN(tags);

    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(archived_at) WHERE archived_at IS NOT NULL;

    -- Migrate old status values to new lifecycle states
    UPDATE conversations SET status = 'paused' WHERE status = 'open';
    UPDATE conversations SET status = 'stopped' WHERE status = 'closed';
    -- 'active' stays as 'active' (same meaning)

    -- ─── Thread tables (cross-channel unified model) ───────────────

    CREATE TABLE IF NOT EXISTS threads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      topic TEXT,
      status TEXT NOT NULL DEFAULT 'paused',
      session_id TEXT,
      summary TEXT,
      parent_thread_id UUID REFERENCES threads(id),
      fork_point_event_id UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      closed_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS thread_refs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      ref_type TEXT NOT NULL,
      repo TEXT NOT NULL,
      number INT,
      ref TEXT,
      url TEXT,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS thread_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      direction TEXT NOT NULL,
      actor TEXT NOT NULL,
      content JSONB NOT NULL,
      message_type TEXT DEFAULT 'text',
      usage JSONB,
      metadata JSONB DEFAULT '{}',
      is_compacted BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_thread_events_thread ON thread_events(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_thread_refs_lookup ON thread_refs(repo, ref_type, number);
    CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
    CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);

    -- Unique constraint for thread_refs to prevent duplicate links
    DO $$ BEGIN
      ALTER TABLE thread_refs ADD CONSTRAINT uq_thread_refs_link
        UNIQUE(thread_id, ref_type, repo, number);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$;

    -- Add conversation_id to threads for migration backward-compat
    ALTER TABLE threads ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id);
    CREATE INDEX IF NOT EXISTS idx_threads_conversation ON threads(conversation_id) WHERE conversation_id IS NOT NULL;
  `)
}

// ─── Config store ───────────────────────────────────────────────────

export const getConfig = async (key: string): Promise<string | null> => {
  if (!pool) return null // No DB connection (e.g. in tests)
  const { rows } = await pool.query(
    'SELECT value FROM config WHERE key = $1', [key]
  )
  return rows[0]?.value ?? null
}

export const setConfig = async (key: string, value: string): Promise<void> => {
  await pool.query(`
    INSERT INTO config (key, value, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
  `, [key, value])
}

export const getAllConfig = async (): Promise<Record<string, string>> => {
  const { rows } = await pool.query('SELECT key, value FROM config')
  return Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]))
}

export const deleteConfig = async (key: string): Promise<void> => {
  await pool.query('DELETE FROM config WHERE key = $1', [key])
}

// ─── Conversations ──────────────────────────────────────────────────

export const createConversation = async (channel: string, topic: string | null = null): Promise<Conversation> => {
  const { rows } = await pool.query(
    `INSERT INTO conversations (channel, topic, status) VALUES ($1, $2, 'paused') RETURNING *`,
    [channel, topic]
  )
  return rows[0]
}

export const getConversation = async (id: string): Promise<Conversation | null> => {
  const { rows } = await pool.query(
    'SELECT * FROM conversations WHERE id = $1', [id]
  )
  return rows[0] ?? null
}

export const listConversations = async (
  channel: string | null = null,
  limit: number = 20,
  filters: ListFilters = {}
): Promise<ConversationWithPreview[]> => {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (channel) {
    conditions.push(`c.channel = $${i}`)
    params.push(channel)
    i++
  }
  if (filters.status) {
    conditions.push(`c.status = $${i}`)
    params.push(filters.status)
    i++
  }
  if (filters.tag) {
    conditions.push(`$${i} = ANY(c.tags)`)
    params.push(filters.tag)
    i++
  }
  if (filters.archived === true) {
    conditions.push(`c.archived_at IS NOT NULL`)
  } else if (filters.archived === false) {
    conditions.push(`c.archived_at IS NULL`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit)
  const { rows } = await pool.query(
    `SELECT c.*,
       lm.preview AS last_message_preview,
       u.total_cost AS usage_cost,
       u.input_tokens AS usage_input_tokens,
       u.output_tokens AS usage_output_tokens,
       COALESCE(rc.ref_count, 0)::int AS ref_count
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT LEFT(
         CASE
           WHEN jsonb_typeof(m.content) = 'string' THEN m.content #>> '{}'
           WHEN jsonb_typeof(m.content) = 'array' THEN (
             SELECT string_agg(elem->>'text', '')
             FROM jsonb_array_elements(m.content) elem
             WHERE elem->>'type' = 'text'
           )
           ELSE ''
         END, 120
       ) AS preview
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM((usage->>'inputTokens')::int), 0) AS input_tokens,
         COALESCE(SUM((usage->>'outputTokens')::int), 0) AS output_tokens,
         COALESCE(SUM((usage->>'costUSD')::numeric), 0) AS total_cost
       FROM messages
       WHERE conversation_id = c.id AND usage IS NOT NULL
     ) u ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS ref_count
       FROM thread_refs tr
       JOIN threads t ON t.id = tr.thread_id
       WHERE t.conversation_id = c.id
     ) rc ON true
     ${where}
     ORDER BY c.updated_at DESC
     LIMIT $${i}`,
    params
  )
  return rows
}

// ─── Messages ───────────────────────────────────────────────────────

export const addMessage = async (
  conversationId: string,
  role: string,
  content: unknown,
  extras: MessageExtras = {}
): Promise<Message> => {
  await pool.query(
    'UPDATE conversations SET updated_at = now() WHERE id = $1',
    [conversationId]
  )
  const { rows } = await pool.query(
    'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_outputs, message_type, usage) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [
      conversationId, role, JSON.stringify(content),
      extras.tool_calls ? JSON.stringify(extras.tool_calls) : null,
      extras.tool_outputs ? JSON.stringify(extras.tool_outputs) : null,
      extras.message_type || 'text',
      extras.usage ? JSON.stringify(extras.usage) : null
    ]
  )
  return rows[0]
}

export const getMessages = async (conversationId: string, limit: number = 100): Promise<Message[]> => {
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2',
    [conversationId, limit]
  )
  return rows.map((r: Message) => ({ ...r, content: r.content }))
}

// ─── Action Log ─────────────────────────────────────────────────────

export const logAction = async (
  actionType: string,
  repo: string,
  refId: string | null = null,
  metadata: unknown = null
): Promise<void> => {
  if (!pool) return // No DB connection (e.g. in tests)
  await pool.query(
    'INSERT INTO action_log (action_type, repo, ref_id, metadata) VALUES ($1, $2, $3, $4)',
    [actionType, repo, refId, metadata ? JSON.stringify(metadata) : null]
  )
}

export const checkRecentAction = async (
  actionType: string,
  repo: string,
  refId: string,
  minutesAgo: number = 5
): Promise<boolean> => {
  const { rows } = await pool.query(
    `SELECT * FROM action_log
     WHERE action_type = $1
       AND repo = $2
       AND ref_id = $3
       AND created_at > now() - interval '${minutesAgo} minutes'
     LIMIT 1`,
    [actionType, repo, refId]
  )
  return rows.length > 0
}

export const cleanupOldActions = async (hoursAgo: number = 1): Promise<number> => {
  const { rowCount } = await pool.query(
    `DELETE FROM action_log WHERE created_at < now() - interval '${hoursAgo} hours'`
  )
  return rowCount ?? 0
}

// ─── Session management ─────────────────────────────────────────────

export const setSessionId = async (convId: string, sessionId: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET session_id = $2, status = 'active', updated_at = now() WHERE id = $1`,
    [convId, sessionId]
  )
}

export const getSessionId = async (convId: string): Promise<string | null> => {
  const { rows } = await pool.query(
    'SELECT session_id FROM conversations WHERE id = $1', [convId]
  )
  return rows[0]?.session_id ?? null
}

export const clearSessionId = async (convId: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET session_id = NULL, updated_at = now() WHERE id = $1`,
    [convId]
  )
}

// ─── Thread lifecycle transitions ────────────────────────────────

/** Transition to active (agent starting). Valid from paused/stopped. */
export const activateThread = async (convId: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'active', updated_at = now() WHERE id = $1 AND status IN ('paused', 'stopped')`,
    [convId]
  )
}

/** Transition to paused (agent done with turn). Valid from active. */
export const pauseThread = async (convId: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'paused', updated_at = now() WHERE id = $1 AND status = 'active'`,
    [convId]
  )
}

/** Transition to stopped (purpose fulfilled / manual). Valid from any non-archived state. */
export const stopThread = async (convId: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'stopped', closed_at = now(), updated_at = now() WHERE id = $1 AND status != 'archived'`,
    [convId]
  )
}

/** Transition to archived (manual). Valid from stopped. */
export const archiveThread = async (convId: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1 AND status = 'stopped'`,
    [convId]
  )
}

/** Reopen a stopped or archived thread → paused. */
export const reopenThread = async (convId: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'paused', closed_at = NULL, archived_at = NULL, updated_at = now() WHERE id = $1 AND status IN ('stopped', 'archived')`,
    [convId]
  )
}

export const updateConversation = async (id: string, fields: ConversationUpdate): Promise<void> => {
  const allowed = ['topic', 'status', 'tags', 'repo', 'closed_at'] as const
  const sets: string[] = []
  const values: unknown[] = [id]
  let i = 2
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${i}`)
      values.push(fields[key])
      i++
    }
  }
  if (sets.length === 0) return
  sets.push('updated_at = now()')
  await pool.query(`UPDATE conversations SET ${sets.join(', ')} WHERE id = $1`, values)
}

/** @deprecated Use stopThread() instead. Kept for backward compat — maps to 'stopped'. */
export const closeConversation = async (id: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'stopped', closed_at = now(), updated_at = now() WHERE id = $1`,
    [id]
  )
}

export const deleteConversation = async (id: string): Promise<void> => {
  await pool.query('DELETE FROM conversations WHERE id = $1', [id])
}

export const archiveConversation = async (id: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1`,
    [id]
  )
}

export const unarchiveConversation = async (id: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'paused', archived_at = NULL, updated_at = now() WHERE id = $1`,
    [id]
  )
}

/**
 * Auto-archive conversations that have been inactive for the given number of days.
 * Only archives non-archived, non-active conversations.
 * Returns the number of conversations archived.
 */
export const autoArchiveStale = async (staleDays: number = 7): Promise<number> => {
  const { rowCount } = await pool.query(
    `UPDATE conversations
     SET status = 'archived', archived_at = now(), updated_at = now()
     WHERE status IN ('paused', 'stopped')
       AND updated_at < now() - make_interval(days => $1)`,
    [staleDays]
  )
  return rowCount ?? 0
}

export const addTags = async (convId: string, tags: string[]): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET tags = (
      SELECT array_agg(DISTINCT t) FROM unnest(tags || $2::text[]) t
    ), updated_at = now() WHERE id = $1`,
    [convId, tags]
  )
}

export const findByTag = async (tag: string): Promise<Conversation[]> => {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE $1 = ANY(tags) ORDER BY updated_at DESC`,
    [tag]
  )
  return rows
}

export interface SearchResult {
  conversationId: string
  topic: string | null
  channel: string
  status: string
  createdAt: string
  updatedAt: string
  matchType: 'topic' | 'message'
  matchPreview: string
  messageRole?: string
}

/**
 * Search across conversation topics and message content.
 * Uses case-insensitive LIKE matching.
 * Returns deduplicated results: one per conversation, prioritizing topic matches.
 */
export const searchConversations = async (
  query: string,
  limit: number = 20,
): Promise<SearchResult[]> => {
  const pattern = `%${query}%`

  // Search conversation topics
  const { rows: topicMatches } = await pool.query(`
    SELECT
      c.id AS conversation_id,
      c.topic,
      c.channel,
      c.status,
      c.created_at,
      c.updated_at,
      'topic' AS match_type,
      c.topic AS match_preview,
      NULL AS message_role
    FROM conversations c
    WHERE c.topic ILIKE $1
    ORDER BY c.updated_at DESC
    LIMIT $2
  `, [pattern, limit])

  // Search message content (text blocks within JSONB)
  const { rows: messageMatches } = await pool.query(`
    SELECT DISTINCT ON (c.id)
      c.id AS conversation_id,
      c.topic,
      c.channel,
      c.status,
      c.created_at,
      c.updated_at,
      'message' AS match_type,
      LEFT(
        CASE
          WHEN jsonb_typeof(m.content) = 'string' THEN m.content #>> '{}'
          WHEN jsonb_typeof(m.content) = 'array' THEN (
            SELECT string_agg(elem->>'text', ' ')
            FROM jsonb_array_elements(m.content) elem
            WHERE elem->>'type' = 'text'
          )
          ELSE ''
        END, 150
      ) AS match_preview,
      m.role AS message_role
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE (
      (jsonb_typeof(m.content) = 'string' AND m.content #>> '{}' ILIKE $1)
      OR
      (jsonb_typeof(m.content) = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(m.content) elem
        WHERE elem->>'type' = 'text' AND elem->>'text' ILIKE $1
      ))
    )
    AND m.role IN ('user', 'assistant')
    ORDER BY c.id, c.updated_at DESC
    LIMIT $2
  `, [pattern, limit])

  // Merge and deduplicate: topic matches first, then message matches (skip dupes)
  const seen = new Set<string>()
  const results: SearchResult[] = []

  for (const row of topicMatches) {
    seen.add(row.conversation_id)
    results.push({
      conversationId: row.conversation_id,
      topic: row.topic,
      channel: row.channel,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      matchType: 'topic',
      matchPreview: row.match_preview || '',
    })
  }

  for (const row of messageMatches) {
    if (seen.has(row.conversation_id)) continue
    seen.add(row.conversation_id)
    results.push({
      conversationId: row.conversation_id,
      topic: row.topic,
      channel: row.channel,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      matchType: 'message',
      matchPreview: row.match_preview || '',
      messageRole: row.message_role,
    })
  }

  return results.slice(0, limit)
}

export const findLatest = async (channel: string): Promise<Conversation | null> => {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE channel = $1 AND status IN ('active', 'paused') ORDER BY updated_at DESC LIMIT 1`,
    [channel]
  )
  return rows[0] ?? null
}

// ─── Token usage aggregation ────────────────────────────────────────

export const getConversationUsage = async (conversationId: string): Promise<TokenUsage> => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM((usage->>'inputTokens')::int), 0) AS input_tokens,
      COALESCE(SUM((usage->>'outputTokens')::int), 0) AS output_tokens,
      COALESCE(SUM((usage->>'cacheReadInputTokens')::int), 0) AS cache_read_tokens,
      COALESCE(SUM((usage->>'cacheCreationInputTokens')::int), 0) AS cache_creation_tokens,
      COALESCE(SUM((usage->>'costUSD')::numeric), 0) AS total_cost,
      COUNT(*) FILTER (WHERE usage IS NOT NULL) AS messages_with_usage
    FROM messages
    WHERE conversation_id = $1 AND usage IS NOT NULL
  `, [conversationId])
  return rows[0]
}

// ─── Global Usage Analytics ─────────────────────────────────────────

export interface GlobalUsageStats {
  total_cost: number
  total_conversations: number
  total_messages: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  avg_cost_per_conversation: number
  top_conversations: Array<{
    id: string
    topic: string | null
    cost: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    message_count: number
  }>
  daily_costs: Array<{
    date: string
    cost: number
    conversations: number
    messages: number
  }>
}

/**
 * Get global usage statistics across all conversations.
 * Supports date range filtering for cost monitoring dashboards.
 */
export const getGlobalUsage = async (daysBack: number = 30): Promise<GlobalUsageStats> => {
  // Overall totals
  const { rows: totals } = await pool.query(`
    SELECT
      COALESCE(SUM((usage->>'costUSD')::numeric), 0) AS total_cost,
      COALESCE(SUM((usage->>'inputTokens')::int), 0) AS total_input_tokens,
      COALESCE(SUM((usage->>'outputTokens')::int), 0) AS total_output_tokens,
      COALESCE(SUM((usage->>'cacheReadInputTokens')::int), 0) AS total_cache_read_tokens,
      COUNT(*) AS total_messages
    FROM messages
    WHERE usage IS NOT NULL
      AND created_at > now() - make_interval(days => $1)
  `, [daysBack])

  const { rows: convCount } = await pool.query(`
    SELECT COUNT(DISTINCT conversation_id) AS total_conversations
    FROM messages
    WHERE usage IS NOT NULL
      AND created_at > now() - make_interval(days => $1)
  `, [daysBack])

  // Top conversations by cost
  const { rows: topConvs } = await pool.query(`
    SELECT
      c.id,
      c.topic,
      COALESCE(SUM((m.usage->>'costUSD')::numeric), 0) AS cost,
      COALESCE(SUM((m.usage->>'inputTokens')::int), 0) AS input_tokens,
      COALESCE(SUM((m.usage->>'outputTokens')::int), 0) AS output_tokens,
      COALESCE(SUM((m.usage->>'cacheReadInputTokens')::int), 0) AS cache_read_tokens,
      COUNT(*) AS message_count
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.usage IS NOT NULL
      AND m.created_at > now() - make_interval(days => $1)
    GROUP BY c.id, c.topic
    ORDER BY cost DESC
    LIMIT 10
  `, [daysBack])

  // Daily cost breakdown
  const { rows: daily } = await pool.query(`
    SELECT
      DATE(created_at) AS date,
      COALESCE(SUM((usage->>'costUSD')::numeric), 0) AS cost,
      COUNT(DISTINCT conversation_id) AS conversations,
      COUNT(*) AS messages
    FROM messages
    WHERE usage IS NOT NULL
      AND created_at > now() - make_interval(days => $1)
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `, [daysBack])

  const totalCost = parseFloat(totals[0]?.total_cost || '0')
  const totalConversations = parseInt(convCount[0]?.total_conversations || '0')

  return {
    total_cost: totalCost,
    total_conversations: totalConversations,
    total_messages: parseInt(totals[0]?.total_messages || '0'),
    total_input_tokens: parseInt(totals[0]?.total_input_tokens || '0'),
    total_output_tokens: parseInt(totals[0]?.total_output_tokens || '0'),
    total_cache_read_tokens: parseInt(totals[0]?.total_cache_read_tokens || '0'),
    avg_cost_per_conversation: totalConversations > 0 ? totalCost / totalConversations : 0,
    top_conversations: topConvs.map(r => ({
      id: r.id,
      topic: r.topic,
      cost: parseFloat(r.cost),
      input_tokens: parseInt(r.input_tokens),
      output_tokens: parseInt(r.output_tokens),
      cache_read_tokens: parseInt(r.cache_read_tokens),
      message_count: parseInt(r.message_count),
    })),
    daily_costs: daily.map(r => ({
      date: r.date,
      cost: parseFloat(r.cost),
      conversations: parseInt(r.conversations),
      messages: parseInt(r.messages),
    })),
  }
}

/**
 * Check if spending exceeds a budget threshold.
 * Returns the current period spend and whether it's over budget.
 */
export const checkBudget = async (budgetUSD: number, periodDays: number = 7): Promise<{
  periodSpend: number
  budgetUSD: number
  overBudget: boolean
  percentUsed: number
}> => {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM((usage->>'costUSD')::numeric), 0) AS period_spend
    FROM messages
    WHERE usage IS NOT NULL
      AND created_at > now() - make_interval(days => $1)
  `, [periodDays])

  const periodSpend = parseFloat(rows[0]?.period_spend || '0')
  return {
    periodSpend,
    budgetUSD,
    overBudget: periodSpend > budgetUSD,
    percentUsed: budgetUSD > 0 ? (periodSpend / budgetUSD) * 100 : 0,
  }
}

// ─── Conversation Analysis (Strategy 5) ─────────────────────────────

export interface ConversationAnalysis {
  conversationId: string
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  messageCount: number
  toolBreakdown: Array<{
    toolName: string
    callCount: number
    /** Estimated cost contribution based on proportion of messages */
    estimatedCost: number
  }>
  messageTimeline: Array<{
    role: string
    costUSD: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    createdAt: string
    toolsUsed: string[]
  }>
  optimization_hints: string[]
}

/**
 * Analyze a conversation's token usage patterns and identify optimization opportunities.
 * Strategy 5: Conversation Analysis & Pattern Mining.
 */
export const getConversationAnalysis = async (conversationId: string): Promise<ConversationAnalysis> => {
  // Get all messages with usage data
  const { rows: messages } = await pool.query(`
    SELECT role, content, tool_calls, usage, created_at
    FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC
  `, [conversationId])

  let totalCost = 0, totalInput = 0, totalOutput = 0, totalCacheRead = 0
  const toolCounts = new Map<string, number>()
  const timeline: ConversationAnalysis['messageTimeline'] = []

  for (const msg of messages) {
    const usage = msg.usage as Record<string, number> | null
    const cost = parseFloat(String(usage?.costUSD || 0))
    const input = parseInt(String(usage?.inputTokens || 0))
    const output = parseInt(String(usage?.outputTokens || 0))
    const cacheRead = parseInt(String(usage?.cacheReadInputTokens || 0))

    totalCost += cost
    totalInput += input
    totalOutput += output
    totalCacheRead += cacheRead

    // Track tool usage
    const toolsUsed: string[] = []
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<{ name: string }>) {
        toolsUsed.push(tc.name)
        toolCounts.set(tc.name, (toolCounts.get(tc.name) || 0) + 1)
      }
    }

    if (msg.role === 'assistant' && usage) {
      timeline.push({
        role: msg.role,
        costUSD: cost,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        createdAt: msg.created_at,
        toolsUsed,
      })
    }
  }

  // Build tool breakdown with estimated cost proportions
  const toolBreakdown = Array.from(toolCounts.entries())
    .map(([toolName, callCount]) => ({
      toolName,
      callCount,
      estimatedCost: totalCost * (callCount / Math.max(1, timeline.length)),
    }))
    .sort((a, b) => b.callCount - a.callCount)

  // Generate optimization hints
  const hints: string[] = []
  if (totalCacheRead > 5_000_000) {
    hints.push(`High cache read tokens (${(totalCacheRead / 1_000_000).toFixed(1)}M) — knowledge base could reduce exploratory reads`)
  }
  const grepGlobCalls = (toolCounts.get('Grep') || 0) + (toolCounts.get('Glob') || 0)
  if (grepGlobCalls > 10) {
    hints.push(`${grepGlobCalls} search tool calls — better knowledge base would reduce codebase exploration`)
  }
  const readCalls = toolCounts.get('Read') || 0
  if (readCalls > 15) {
    hints.push(`${readCalls} file reads — codebase map in knowledge would help`)
  }
  if (timeline.length > 0) {
    const avgCostPerTurn = totalCost / timeline.length
    if (avgCostPerTurn > 2) {
      hints.push(`High avg cost per turn ($${avgCostPerTurn.toFixed(2)}) — consider if task could use Haiku for some steps`)
    }
  }
  if (messages.length > 20) {
    hints.push(`Long conversation (${messages.length} messages) — sliding window would help reduce context`)
  }

  return {
    conversationId,
    totalCost,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    messageCount: messages.length,
    toolBreakdown,
    messageTimeline: timeline,
    optimization_hints: hints,
  }
}
