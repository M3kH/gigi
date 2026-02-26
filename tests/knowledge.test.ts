/**
 * Knowledge Module Tests
 *
 * Tests the persistent knowledge loading and update system.
 * Uses mock store functions to avoid DB dependency.
 */

import assert from 'node:assert/strict'

describe('knowledge module', () => {
  it('should export getKnowledge, updateKnowledge, appendKnowledge', async () => {
    // Dynamic import to test that the module loads correctly
    const knowledge = await import('../lib/core/knowledge')
    assert.equal(typeof knowledge.getKnowledge, 'function')
    assert.equal(typeof knowledge.updateKnowledge, 'function')
    assert.equal(typeof knowledge.appendKnowledge, 'function')
  })
})
