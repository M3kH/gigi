/**
 * Conversations API Tests
 *
 * Tests conversation CRUD endpoints via createTestApp().
 * Demonstrates test isolation with truncateAll() between tests.
 */

import assert from 'node:assert/strict'
import { createTestApp, truncateAll, type TestAppContext } from '../helpers/test-app'

describe('Conversations API', () => {
  let ctx: TestAppContext

  beforeAll(async () => {
    ctx = await createTestApp()
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  it('GET /api/conversations returns empty list initially', async () => {
    const res = await ctx.app.request('/api/conversations')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body), 'should return an array')
    assert.equal(body.length, 0)
  })

  it('GET /api/conversations returns seeded conversations', async () => {
    // Seed a conversation via the store directly
    const store = await import('../../lib/core/store')
    await store.createConversation('web', 'Test conversation')

    const res = await ctx.app.request('/api/conversations')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body), 'should return an array')
    assert.equal(body.length, 1)
    assert.equal(body[0].topic, 'Test conversation')
    assert.equal(body[0].channel, 'web')
    assert.ok(body[0].id, 'conversation should have an id')
  })

  it('GET /api/conversations/:id returns a single conversation', async () => {
    const store = await import('../../lib/core/store')
    const created = await store.createConversation('web', 'Single lookup')

    const res = await ctx.app.request(`/api/conversations/${created.id}`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.id, created.id)
    assert.equal(body.topic, 'Single lookup')
  })

  it('GET /api/conversations/:id returns 404 for missing conversation', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await ctx.app.request(`/api/conversations/${fakeId}`)
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.equal(body.error, 'not found')
  })

  it('DELETE /api/conversations/:id removes a conversation', async () => {
    const store = await import('../../lib/core/store')
    const created = await store.createConversation('web', 'To be deleted')

    const deleteRes = await ctx.app.request(`/api/conversations/${created.id}`, {
      method: 'DELETE',
    })
    assert.equal(deleteRes.status, 200)
    const deleteBody = await deleteRes.json()
    assert.equal(deleteBody.ok, true)

    // Verify it's gone
    const getRes = await ctx.app.request(`/api/conversations/${created.id}`)
    assert.equal(getRes.status, 404)
  })
})
