/**
 * Core Store — PostgreSQL persistence layer
 *
 * Manages config, conversations, messages, action logs, and sessions.
 */

import pg from 'pg'

const { Pool } = pg

// ─── Types ──────────────────────────────────────────────────────────

export interface Conversation {
  id: string
  channel: string
  topic: string | null
  status: string
  tags: string[]
  repo: string | null
  session_id: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
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
    'INSERT INTO conversations (channel, topic) VALUES ($1, $2) RETURNING *',
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit)
  const { rows } = await pool.query(
    `SELECT c.*,
       lm.preview AS last_message_preview,
       u.total_cost AS usage_cost,
       u.input_tokens AS usage_input_tokens,
       u.output_tokens AS usage_output_tokens
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
    `UPDATE conversations SET session_id = NULL, status = 'open', updated_at = now() WHERE id = $1`,
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

export const closeConversation = async (id: string): Promise<void> => {
  await pool.query(
    `UPDATE conversations SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`,
    [id]
  )
}

export const deleteConversation = async (id: string): Promise<void> => {
  await pool.query('DELETE FROM conversations WHERE id = $1', [id])
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

export const findLatest = async (channel: string): Promise<Conversation | null> => {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE channel = $1 AND status IN ('active', 'open') ORDER BY updated_at DESC LIMIT 1`,
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
