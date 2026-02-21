/**
 * Integration Test Setup — Database connection & per-test isolation
 *
 * Connects the store module to a dedicated test Postgres database (gigi_test)
 * and provides truncation-based isolation between tests.
 *
 * SAFETY: Refuses to run against any database that doesn't contain "test"
 * in its name. This prevents accidental data loss on dev/prod databases.
 *
 * Usage:
 *   import { connectTestDB, disconnectTestDB, truncateAll } from './setup'
 *   import * as store from '../../lib/core/store'
 *
 *   before(async () => { await connectTestDB() })
 *   after(async () => { await disconnectTestDB() })
 *   beforeEach(async () => { await truncateAll() })
 */

import pg from 'pg'

const { Pool } = pg

// ─── Test database configuration ────────────────────────────────────

/**
 * Default test database URL. Only TEST_DATABASE_URL is used — we NEVER
 * fall back to DATABASE_URL to prevent accidentally hitting prod/dev.
 */
const DEFAULT_TEST_URL = 'postgresql://gigi_test:gigi_test@postgres:5432/gigi_test'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_URL

// ─── Safety checks ──────────────────────────────────────────────────

/**
 * Extract the database name from a PostgreSQL connection string.
 * Handles both simple URLs and URLs with query parameters.
 */
const extractDbName = (url: string): string => {
  try {
    const withoutQuery = url.split('?')[0]
    const lastSlash = withoutQuery.lastIndexOf('/')
    return lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : ''
  } catch {
    return ''
  }
}

/**
 * CRITICAL SAFETY CHECK: Verify we're connecting to a test database.
 * Refuses to proceed if the database name doesn't contain "test".
 * This is the main guard against nuking production data.
 */
const assertTestDatabase = (url: string): void => {
  const dbName = extractDbName(url)
  if (!dbName.toLowerCase().includes('test')) {
    throw new Error(
      `🛑 SAFETY: Refusing to run integration tests against database "${dbName}".\n` +
      `   The database name must contain "test" (e.g. gigi_test).\n` +
      `   Set TEST_DATABASE_URL to a dedicated test database.\n` +
      `   Current URL: ${url.replace(/\/\/[^@]+@/, '//***@')}`  // redact credentials
    )
  }
}

// ─── Module state ───────────────────────────────────────────────────

let connected = false
let testPool: InstanceType<typeof Pool> | null = null

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Connect the store module to the test database.
 * This calls store.connect() which applies all migrations.
 * Call once per test file in the `before()` hook.
 *
 * Throws if the database name doesn't contain "test".
 */
export const connectTestDB = async (): Promise<void> => {
  if (connected) return

  // Safety first — refuse to touch non-test databases
  assertTestDatabase(TEST_DATABASE_URL)

  const { connect } = await import('../../lib/core/store')
  testPool = await connect(TEST_DATABASE_URL)
  connected = true

  const dbName = extractDbName(TEST_DATABASE_URL)
  console.log(`[test-setup] ✅ Connected to test database: ${dbName}`)
}

/**
 * Disconnect from the test database.
 * Call once per test file in the `after()` hook.
 */
export const disconnectTestDB = async (): Promise<void> => {
  if (!connected) return

  const { disconnect } = await import('../../lib/core/store')
  await disconnect()
  connected = false
  testPool = null
}

/**
 * Get the test pool (for direct queries in tests).
 */
export const getTestPool = (): InstanceType<typeof Pool> => {
  if (!testPool) throw new Error('Test database not connected. Call connectTestDB() first.')
  return testPool
}

/**
 * Truncate all tables for test isolation.
 * Call in beforeEach() to ensure each test starts clean.
 *
 * Also runs the safety check again, because paranoia is a feature.
 */
export const truncateAll = async (): Promise<void> => {
  assertTestDatabase(TEST_DATABASE_URL)

  const { getPool } = await import('../../lib/core/store')
  const pool = getPool()
  await pool.query(`
    TRUNCATE action_log, messages, conversations, config CASCADE
  `)
}

export { TEST_DATABASE_URL }
