/**
 * Health Endpoint Tests
 *
 * Demonstrates the createTestApp() pattern for HTTP integration tests.
 * Tests the GET /health endpoint via Hono's app.request() — no real server needed.
 */

import assert from 'node:assert/strict'
import { createTestApp, type TestAppContext } from '../helpers/test-app'

describe('GET /health', () => {
  let ctx: TestAppContext

  beforeAll(async () => {
    ctx = await createTestApp()
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  it('returns 200 with ok true', async () => {
    const res = await ctx.app.request('/health')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
  })

  it('includes uptime in response', async () => {
    const res = await ctx.app.request('/health')
    const body = await res.json()
    assert.ok('uptime' in body, 'health response should include uptime')
    assert.equal(typeof body.uptime, 'number')
  })

  it('includes memory stats', async () => {
    const res = await ctx.app.request('/health')
    const body = await res.json()
    assert.ok(body.memory, 'health response should include memory')
    assert.ok('rss' in body.memory, 'memory should include rss')
    assert.ok('heapUsed' in body.memory, 'memory should include heapUsed')
    assert.ok('heapTotal' in body.memory, 'memory should include heapTotal')
  })

  it('includes checks object', async () => {
    const res = await ctx.app.request('/health')
    const body = await res.json()
    assert.ok(body.checks, 'health response should include checks')
    assert.equal(body.checks.database, 'ok', 'database check should be ok when connected')
  })

  it('includes phase field', async () => {
    const res = await ctx.app.request('/health')
    const body = await res.json()
    assert.ok('phase' in body, 'health response should include phase')
    assert.ok(
      ['setup', 'partial', 'ready'].includes(body.phase),
      `phase should be setup, partial, or ready — got "${body.phase}"`
    )
  })
})
