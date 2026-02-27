/**
 * Tests for lib/core/knowledge.ts — Knowledge prompt system
 *
 * Tests the knowledge module's getKnowledge, updateKnowledge, and
 * appendKnowledge functions with mocked store dependencies.
 */

import assert from 'node:assert/strict'
import { vi } from 'vitest'

// Mock the store module
vi.mock('../lib/core/store', () => {
  const configStore = new Map<string, string>()
  return {
    getConfig: vi.fn(async (key: string) => configStore.get(key) ?? null),
    setConfig: vi.fn(async (key: string, value: string) => { configStore.set(key, value) }),
    __configStore: configStore, // expose for test cleanup
  }
})

describe('knowledge module', () => {
  let getKnowledge: () => Promise<string>
  let updateKnowledge: (content: string) => Promise<void>
  let appendKnowledge: (learning: string) => Promise<void>
  let mockStore: { getConfig: ReturnType<typeof vi.fn>; setConfig: ReturnType<typeof vi.fn>; __configStore: Map<string, string> }

  beforeEach(async () => {
    // Re-import to get fresh module
    vi.resetModules()
    vi.mock('../lib/core/store', () => {
      const configStore = new Map<string, string>()
      return {
        getConfig: vi.fn(async (key: string) => configStore.get(key) ?? null),
        setConfig: vi.fn(async (key: string, value: string) => { configStore.set(key, value) }),
        __configStore: configStore,
      }
    })

    const knowledge = await import('../lib/core/knowledge')
    getKnowledge = knowledge.getKnowledge
    updateKnowledge = knowledge.updateKnowledge
    appendKnowledge = knowledge.appendKnowledge
    mockStore = await import('../lib/core/store') as unknown as typeof mockStore
    mockStore.__configStore.clear()
  })

  it('should export getKnowledge, updateKnowledge, appendKnowledge', async () => {
    const knowledge = await import('../lib/core/knowledge')
    assert.equal(typeof knowledge.getKnowledge, 'function')
    assert.equal(typeof knowledge.updateKnowledge, 'function')
    assert.equal(typeof knowledge.appendKnowledge, 'function')
  })

  it('returns default knowledge when no stored value', async () => {
    const result = await getKnowledge()
    assert.ok(result.includes('Codebase Knowledge'))
    assert.ok(result.includes('Architecture Quick Reference'))
  })

  it('bootstraps default knowledge into store on first load', async () => {
    await getKnowledge()
    assert.ok(mockStore.setConfig.mock.calls.length > 0)
    assert.equal(mockStore.setConfig.mock.calls[0][0], 'knowledge_prompt')
  })

  it('returns stored knowledge when available', async () => {
    mockStore.__configStore.set('knowledge_prompt', 'Custom knowledge content')
    const result = await getKnowledge()
    assert.equal(result, 'Custom knowledge content')
  })

  it('updateKnowledge stores new content', async () => {
    await updateKnowledge('New knowledge base')
    assert.equal(mockStore.__configStore.get('knowledge_prompt'), 'New knowledge base')
  })

  it('appendKnowledge adds to existing knowledge', async () => {
    mockStore.__configStore.set('knowledge_prompt', '## Base Knowledge\nSome content')
    await appendKnowledge('Docker uses port 8080')

    const stored = mockStore.__configStore.get('knowledge_prompt')!
    assert.ok(stored.includes('Base Knowledge'))
    assert.ok(stored.includes('Recent Learning'))
    assert.ok(stored.includes('Docker uses port 8080'))
  })

  it('appendKnowledge bootstraps defaults if no existing knowledge', async () => {
    await appendKnowledge('New learning item')

    const stored = mockStore.__configStore.get('knowledge_prompt')!
    assert.ok(stored.includes('Recent Learning'))
    assert.ok(stored.includes('New learning item'))
  })

  it('getKnowledge returns defaults when store throws', async () => {
    mockStore.getConfig.mockRejectedValueOnce(new Error('DB connection failed'))
    const result = await getKnowledge()
    assert.ok(result.includes('Codebase Knowledge'))
  })
})
