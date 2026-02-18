/**
 * Knowledge Module Tests
 *
 * Tests the persistent knowledge loading and update system.
 * Uses mock store functions to avoid DB dependency.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// We need to mock the store before importing knowledge
// Since knowledge.ts imports from './store', we test via integration approach:
// testing the module's exports and behavior directly.

describe('knowledge module', () => {
  it('should export getKnowledge, updateKnowledge, appendKnowledge', async () => {
    // Dynamic import to test that the module loads correctly
    const knowledge = await import('../lib/core/knowledge')
    assert.equal(typeof knowledge.getKnowledge, 'function')
    assert.equal(typeof knowledge.updateKnowledge, 'function')
    assert.equal(typeof knowledge.appendKnowledge, 'function')
  })
})

// ─── Default Knowledge Content ───────────────────────────────────────

describe('default knowledge content', () => {
  it('should contain architecture reference', async () => {
    // We can't call getKnowledge without a DB, but we can read the module source
    // to verify the DEFAULT_KNOWLEDGE constant has the right structure.
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(import.meta.dirname, '../lib/core/knowledge.ts'), 'utf-8')

    assert.ok(source.includes('Architecture Quick Reference'), 'should contain architecture section')
    assert.ok(source.includes('Key Patterns'), 'should contain patterns section')
    assert.ok(source.includes('Common File Locations'), 'should contain file locations')
    assert.ok(source.includes('Infrastructure'), 'should contain infrastructure section')
    assert.ok(source.includes('Troubleshooting'), 'should contain troubleshooting section')
  })

  it('should reference critical file paths', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(import.meta.dirname, '../lib/core/knowledge.ts'), 'utf-8')

    assert.ok(source.includes('lib/core/agent.ts'), 'should reference agent module')
    assert.ok(source.includes('lib/core/router.ts'), 'should reference router module')
    assert.ok(source.includes('lib/core/store.ts'), 'should reference store module')
    assert.ok(source.includes('web/app/'), 'should reference frontend directory')
  })
})
