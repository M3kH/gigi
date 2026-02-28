/**
 * Mock pg.Pool — configurable DB mock for unit tests
 *
 * Provides a mock `pg.Pool` with:
 * - Configurable query results per SQL pattern
 * - Transaction support tracking (BEGIN/COMMIT/ROLLBACK)
 * - Call recording for assertions (pool.query.mock.calls)
 *
 * Usage:
 *   const { pool, mockQuery, getQueryLog } = createMockPool()
 *   mockQuery(/SELECT.*FROM config/, { rows: [{ key: 'k', value: 'v' }] })
 *   // ... pass pool into module under test
 *   assert.equal(getQueryLog().length, 1)
 */

import { vi } from 'vitest'

export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount?: number | null
}

interface QueryMatcher {
  pattern: RegExp
  result: QueryResult | ((sql: string, params?: unknown[]) => QueryResult)
}

interface QueryLogEntry {
  sql: string
  params: unknown[] | undefined
}

/**
 * Create a mock pg.Pool with configurable query results.
 *
 * @returns An object with:
 *   - pool: A mock Pool object to inject into modules
 *   - mockQuery: Register a pattern → result mapping
 *   - getQueryLog: Get all queries executed
 *   - resetQueryLog: Clear the query log
 *   - resetMatchers: Clear all registered matchers
 */
export function createMockPool() {
  const matchers: QueryMatcher[] = []
  const queryLog: QueryLogEntry[] = []

  // Default fallback result
  const defaultResult: QueryResult = { rows: [], rowCount: 0 }

  // Normalize SQL for matching: collapse whitespace to single spaces.
  // This ensures multi-line SQL queries match regex patterns that use `.*`.
  const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

  const queryFn = vi.fn(async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    const normalized = normalizeSql(sql)
    queryLog.push({ sql: normalized, params })

    // Check matchers in order (last registered wins for overlapping patterns)
    for (let i = matchers.length - 1; i >= 0; i--) {
      const matcher = matchers[i]
      if (matcher.pattern.test(normalized)) {
        if (typeof matcher.result === 'function') {
          return matcher.result(normalized, params)
        }
        return matcher.result
      }
    }

    return defaultResult
  })

  const pool = {
    query: queryFn,
    end: vi.fn(async () => {}),
    connect: vi.fn(async () => ({
      query: queryFn,
      release: vi.fn(),
    })),
  }

  return {
    pool: pool as unknown as import('pg').Pool,

    /**
     * Register a query pattern → result mapping.
     * Later registrations take priority for overlapping patterns.
     */
    mockQuery(
      pattern: RegExp,
      result: QueryResult | ((sql: string, params?: unknown[]) => QueryResult),
    ) {
      matchers.push({ pattern, result })
    },

    /** Get all queries that were executed, in order. */
    getQueryLog(): QueryLogEntry[] {
      return [...queryLog]
    },

    /** Clear the query log (not the matchers). */
    resetQueryLog() {
      queryLog.length = 0
      queryFn.mockClear()
    },

    /** Clear all registered matchers. */
    resetMatchers() {
      matchers.length = 0
    },

    /** Reset everything — log, matchers, mock state. */
    reset() {
      queryLog.length = 0
      matchers.length = 0
      queryFn.mockClear()
    },
  }
}
