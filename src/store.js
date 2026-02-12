import pg from 'pg'

const { Pool } = pg

let pool

export const connect = async (databaseUrl) => {
  pool = new Pool({ connectionString: databaseUrl })
  await pool.query('SELECT 1')
  await migrate()
  return pool
}

export const getPool = () => pool

export const disconnect = () => pool?.end()

const migrate = async () => {
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

    CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id) WHERE session_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_conversations_tags ON conversations USING GIN(tags);
  `)
}

// Config store

export const getConfig = async (key) => {
  const { rows } = await pool.query(
    'SELECT value FROM config WHERE key = $1', [key]
  )
  return rows[0]?.value ?? null
}

export const setConfig = async (key, value) => {
  await pool.query(`
    INSERT INTO config (key, value, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
  `, [key, value])
}

export const getAllConfig = async () => {
  const { rows } = await pool.query('SELECT key, value FROM config')
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

export const deleteConfig = async (key) => {
  await pool.query('DELETE FROM config WHERE key = $1', [key])
}

// Conversations

export const createConversation = async (channel, topic = null) => {
  const { rows } = await pool.query(
    'INSERT INTO conversations (channel, topic) VALUES ($1, $2) RETURNING *',
    [channel, topic]
  )
  return rows[0]
}

export const getConversation = async (id) => {
  const { rows } = await pool.query(
    'SELECT * FROM conversations WHERE id = $1', [id]
  )
  return rows[0] ?? null
}

export const listConversations = async (channel = null, limit = 20, filters = {}) => {
  const conditions = []
  const params = []
  let i = 1

  if (channel) {
    conditions.push(`channel = $${i}`)
    params.push(channel)
    i++
  }
  if (filters.status) {
    conditions.push(`status = $${i}`)
    params.push(filters.status)
    i++
  }
  if (filters.tag) {
    conditions.push(`$${i} = ANY(tags)`)
    params.push(filters.tag)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit)
  const { rows } = await pool.query(
    `SELECT * FROM conversations ${where} ORDER BY updated_at DESC LIMIT $${i}`,
    params
  )
  return rows
}

// Messages

export const addMessage = async (conversationId, role, content, extras = {}) => {
  await pool.query(
    'UPDATE conversations SET updated_at = now() WHERE id = $1',
    [conversationId]
  )
  const { rows } = await pool.query(
    'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_outputs, message_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [conversationId, role, JSON.stringify(content), extras.tool_calls ? JSON.stringify(extras.tool_calls) : null, extras.tool_outputs ? JSON.stringify(extras.tool_outputs) : null, extras.message_type || 'text']
  )
  return rows[0]
}

export const getMessages = async (conversationId, limit = 100) => {
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2',
    [conversationId, limit]
  )
  return rows.map(r => ({ ...r, content: r.content }))
}

// Action Log - Track self-generated actions to filter webhooks

export const logAction = async (actionType, repo, refId = null, metadata = null) => {
  await pool.query(
    'INSERT INTO action_log (action_type, repo, ref_id, metadata) VALUES ($1, $2, $3, $4)',
    [actionType, repo, refId, metadata ? JSON.stringify(metadata) : null]
  )
}

export const checkRecentAction = async (actionType, repo, refId, minutesAgo = 5) => {
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

export const cleanupOldActions = async (hoursAgo = 1) => {
  const { rowCount } = await pool.query(
    `DELETE FROM action_log WHERE created_at < now() - interval '${hoursAgo} hours'`
  )
  return rowCount
}

// Session management

export const setSessionId = async (convId, sessionId) => {
  await pool.query(
    `UPDATE conversations SET session_id = $2, status = 'active', updated_at = now() WHERE id = $1`,
    [convId, sessionId]
  )
}

export const getSessionId = async (convId) => {
  const { rows } = await pool.query(
    'SELECT session_id FROM conversations WHERE id = $1', [convId]
  )
  return rows[0]?.session_id ?? null
}

export const clearSessionId = async (convId) => {
  await pool.query(
    `UPDATE conversations SET session_id = NULL, status = 'open', updated_at = now() WHERE id = $1`,
    [convId]
  )
}

export const updateConversation = async (id, fields) => {
  const allowed = ['topic', 'status', 'tags', 'repo', 'closed_at']
  const sets = []
  const values = [id]
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

export const closeConversation = async (id) => {
  await pool.query(
    `UPDATE conversations SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`,
    [id]
  )
}

export const deleteConversation = async (id) => {
  await pool.query('DELETE FROM conversations WHERE id = $1', [id])
}

export const addTags = async (convId, tags) => {
  await pool.query(
    `UPDATE conversations SET tags = (
      SELECT array_agg(DISTINCT t) FROM unnest(tags || $2::text[]) t
    ), updated_at = now() WHERE id = $1`,
    [convId, tags]
  )
}

export const findByTag = async (tag) => {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE $1 = ANY(tags) ORDER BY updated_at DESC`,
    [tag]
  )
  return rows
}

export const findLatest = async (channel) => {
  const { rows } = await pool.query(
    `SELECT * FROM conversations WHERE channel = $1 AND status IN ('active', 'open') ORDER BY updated_at DESC LIMIT 1`,
    [channel]
  )
  return rows[0] ?? null
}
