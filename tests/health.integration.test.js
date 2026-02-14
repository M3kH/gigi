import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('Health endpoint integration', () => {
  it('GET /health returns valid JSON with health status fields', async () => {
    const { createApp } = await import('../src/web.js')
    const app = createApp()

    const res = await app.fetch(new Request('http://localhost/health'))

    // Without a database, health check returns 503 but the endpoint works
    assert.ok(
      res.status === 200 || res.status === 503,
      `Expected 200 or 503, got ${res.status}`
    )

    const body = await res.json()

    assert.equal(typeof body.ok, 'boolean', 'ok should be boolean')
    assert.equal(typeof body.uptime, 'number', 'uptime should be a number')
    assert.ok(body.memory, 'memory should be present')
    assert.ok(body.checks, 'checks should be present')
    assert.ok(body.phase, 'phase should be present')
    assert.ok(
      ['setup', 'partial', 'ready'].includes(body.phase),
      `phase should be setup/partial/ready, got ${body.phase}`
    )
  })
})
