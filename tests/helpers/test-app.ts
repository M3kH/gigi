/**
 * Test App Factory — creates a Hono app for HTTP-level integration tests
 *
 * Connects to the test database, creates the app via createApp(),
 * and returns the app instance for use with app.request().
 *
 * Does NOT start Telegram, backup scheduler, or AWM.
 *
 * Usage:
 *   import { createTestApp, truncateAll, type TestAppContext } from './helpers/test-app'
 *
 *   let ctx: TestAppContext
 *   beforeAll(async () => { ctx = await createTestApp() })
 *   afterAll(async () => { await ctx.cleanup() })
 *   beforeEach(async () => { await truncateAll() })
 *
 *   it('should return 200', async () => {
 *     const res = await ctx.app.request('/health')
 *     expect(res.status).toBe(200)
 *   })
 */
import type { Hono } from 'hono'
import { connectTestDB, disconnectTestDB, truncateAll } from '../integration/setup'

export interface TestAppContext {
  app: Hono
  cleanup: () => Promise<void>
}

export const createTestApp = async (): Promise<TestAppContext> => {
  await connectTestDB()

  // Dynamic import after DB is connected (createApp uses store)
  const { createApp } = await import('../../lib/api/web')
  const app = createApp()

  return {
    app,
    cleanup: async () => {
      await disconnectTestDB()
    },
  }
}

export { truncateAll }
