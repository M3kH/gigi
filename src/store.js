import pg from 'pg'

const { Pool } = pg

let pool

export const connect = async (databaseUrl) => {
  pool = new Pool({ connectionString: databaseUrl })
  await pool.query('SELECT 1')
  await migrate()
  return pool
}

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

export const listConversations = async (channel = null, limit = 20) => {
  const query = channel
    ? 'SELECT * FROM conversations WHERE channel = $1 ORDER BY updated_at DESC LIMIT $2'
    : 'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT $1'
  const params = channel ? [channel, limit] : [limit]
  const { rows } = await pool.query(query, params)
  return rows
}

// Messages

export const addMessage = async (conversationId, role, content) => {
  await pool.query(
    'UPDATE conversations SET updated_at = now() WHERE id = $1',
    [conversationId]
  )
  const { rows } = await pool.query(
    'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING *',
    [conversationId, role, JSON.stringify(content)]
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
