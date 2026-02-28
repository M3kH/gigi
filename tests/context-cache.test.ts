/**
 * Context Cache — Unit Tests (Issue #304)
 *
 * Tests the cache operations, session tracking, change detection,
 * fork-from-cache, webhook invalidation, and garbage collection.
 */

import { describe, it, beforeEach, expect } from 'vitest'
import {
  getCached,
  getCachedWithChecksum,
  setCache,
  computeChecksum,
  estimateTokens,
  invalidateByPrefix,
  invalidateKey,
  clearAll,
  clearDataCache,
  recordInjection,
  getLastInjection,
  detectChanges,
  removeSession,
  cacheContextStack,
  getCachedContextStack,
  forkContextStack,
  invalidateForWebhook,
  gc,
  getStats,
  CLAUDE_MD_TTL,
  TICKET_TTL,
  LINEAGE_TTL,
  CONTEXT_STACK_TTL,
  SESSION_TTL,
  type LayerChecksums,
  type CachedContextStack,
} from '../lib/core/context-cache'

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  clearAll()
})

// ─── Utility Functions ──────────────────────────────────────────────

describe('computeChecksum', () => {
  it('returns consistent 16-char hex string', () => {
    const cs = computeChecksum('hello world')
    expect(cs).toHaveLength(16)
    expect(cs).toMatch(/^[0-9a-f]{16}$/)
    // Same input → same output
    expect(computeChecksum('hello world')).toBe(cs)
  })

  it('returns different checksums for different inputs', () => {
    expect(computeChecksum('abc')).not.toBe(computeChecksum('def'))
  })

  it('handles empty string', () => {
    const cs = computeChecksum('')
    expect(cs).toHaveLength(16)
  })
})

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('hello')).toBe(2) // ceil(5/4) = 2
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a'.repeat(100))).toBe(25)
    expect(estimateTokens('a'.repeat(401))).toBe(101) // ceil(401/4) = 101
  })
})

// ─── Core Cache Operations ──────────────────────────────────────────

describe('getCached / setCache', () => {
  it('stores and retrieves values', () => {
    setCache('key1', 'value1', 60_000)
    expect(getCached('key1')).toBe('value1')
  })

  it('returns null for missing keys', () => {
    expect(getCached('nonexistent')).toBeNull()
  })

  it('returns null for expired entries', () => {
    setCache('expired', 'val', 1) // 1ms TTL
    // Force expiration by waiting
    const start = Date.now()
    while (Date.now() - start < 5) { /* busy wait */ }
    expect(getCached('expired')).toBeNull()
  })

  it('setCache returns a checksum', () => {
    const checksum = setCache('k', 'v', 60_000)
    expect(checksum).toHaveLength(16)
    expect(checksum).toBe(computeChecksum('v'))
  })
})

describe('getCachedWithChecksum', () => {
  it('returns value and checksum together', () => {
    setCache('k', 'my-value', 60_000)
    const result = getCachedWithChecksum('k')
    expect(result).not.toBeNull()
    expect(result!.value).toBe('my-value')
    expect(result!.checksum).toBe(computeChecksum('my-value'))
  })

  it('returns null for missing keys', () => {
    expect(getCachedWithChecksum('missing')).toBeNull()
  })
})

// ─── Invalidation ───────────────────────────────────────────────────

describe('invalidateByPrefix', () => {
  it('removes entries matching prefix', () => {
    setCache('claude_md:idea/gigi', 'content1', 60_000)
    setCache('claude_md:idea/other', 'content2', 60_000)
    setCache('issue:gigi#1', 'issue-data', 60_000)

    const removed = invalidateByPrefix('claude_md:')
    expect(removed).toBe(2)
    expect(getCached('claude_md:idea/gigi')).toBeNull()
    expect(getCached('claude_md:idea/other')).toBeNull()
    expect(getCached('issue:gigi#1')).toBe('issue-data')
  })

  it('returns 0 when no matches', () => {
    setCache('key1', 'val', 60_000)
    expect(invalidateByPrefix('nonexistent:')).toBe(0)
  })
})

describe('invalidateKey', () => {
  it('removes a specific key', () => {
    setCache('key1', 'val1', 60_000)
    setCache('key2', 'val2', 60_000)

    expect(invalidateKey('key1')).toBe(true)
    expect(getCached('key1')).toBeNull()
    expect(getCached('key2')).toBe('val2')
  })

  it('returns false for missing key', () => {
    expect(invalidateKey('missing')).toBe(false)
  })
})

describe('clearAll', () => {
  it('clears cache and session records', () => {
    setCache('k', 'v', 60_000)
    recordInjection('session1', 'thread1', { repoContext: 'abc' })

    clearAll()

    expect(getCached('k')).toBeNull()
    expect(getLastInjection('session1')).toBeNull()
  })
})

describe('clearDataCache', () => {
  it('clears cache but keeps session records', () => {
    setCache('k', 'v', 60_000)
    recordInjection('session1', 'thread1', { repoContext: 'abc' })

    clearDataCache()

    expect(getCached('k')).toBeNull()
    expect(getLastInjection('session1')).not.toBeNull()
  })
})

// ─── Session Tracking ───────────────────────────────────────────────

describe('recordInjection / getLastInjection', () => {
  it('records and retrieves injection', () => {
    const checksums: LayerChecksums = {
      repoContext: 'checksum1',
      ticketChain: 'checksum2',
    }
    recordInjection('session-abc', 'thread-xyz', checksums)

    const record = getLastInjection('session-abc')
    expect(record).not.toBeNull()
    expect(record!.sessionId).toBe('session-abc')
    expect(record!.threadId).toBe('thread-xyz')
    expect(record!.checksums).toEqual(checksums)
    expect(record!.injectedAt).toBeGreaterThan(0)
  })

  it('returns null for missing session', () => {
    expect(getLastInjection('nonexistent')).toBeNull()
  })

  it('overwrites previous injection for same session', () => {
    recordInjection('s1', 't1', { repoContext: 'old' })
    recordInjection('s1', 't2', { repoContext: 'new' })

    const record = getLastInjection('s1')
    expect(record!.threadId).toBe('t2')
    expect(record!.checksums.repoContext).toBe('new')
  })
})

describe('removeSession', () => {
  it('removes session injection record', () => {
    recordInjection('s1', 't1', { repoContext: 'abc' })
    expect(removeSession('s1')).toBe(true)
    expect(getLastInjection('s1')).toBeNull()
  })

  it('returns false for missing session', () => {
    expect(removeSession('missing')).toBe(false)
  })
})

// ─── Change Detection ───────────────────────────────────────────────

describe('detectChanges', () => {
  it('reports all layers as changed when no previous injection', () => {
    const current: LayerChecksums = {
      repoContext: 'abc',
      ticketChain: 'def',
    }

    const result = detectChanges('new-session', current)
    expect(result.hasChanges).toBe(true)
    expect(result.changedLayers).toContain('repoContext')
    expect(result.changedLayers).toContain('ticketChain')
    expect(result.previousChecksums).toBeNull()
  })

  it('reports no changes when checksums match', () => {
    const checksums: LayerChecksums = {
      repoContext: 'abc',
      ticketChain: 'def',
    }
    recordInjection('s1', 't1', checksums)

    const result = detectChanges('s1', checksums)
    expect(result.hasChanges).toBe(false)
    expect(result.changedLayers).toHaveLength(0)
  })

  it('detects changed layers', () => {
    recordInjection('s1', 't1', {
      repoContext: 'old-repo',
      ticketChain: 'old-ticket',
    })

    const result = detectChanges('s1', {
      repoContext: 'old-repo',   // unchanged
      ticketChain: 'new-ticket', // changed!
    })

    expect(result.hasChanges).toBe(true)
    expect(result.changedLayers).toEqual(['ticketChain'])
  })

  it('detects new layers added', () => {
    recordInjection('s1', 't1', {
      repoContext: 'abc',
    })

    const result = detectChanges('s1', {
      repoContext: 'abc',
      ticketChain: 'new-layer', // newly added
    })

    expect(result.hasChanges).toBe(true)
    expect(result.changedLayers).toContain('ticketChain')
  })

  it('detects removed layers', () => {
    recordInjection('s1', 't1', {
      repoContext: 'abc',
      ticketChain: 'def',
    })

    const result = detectChanges('s1', {
      repoContext: 'abc',
      // ticketChain removed
    })

    expect(result.hasChanges).toBe(true)
    expect(result.changedLayers).toContain('ticketChain')
  })

  it('reports no changes for empty checksums when none existed before', () => {
    recordInjection('s1', 't1', {})

    const result = detectChanges('s1', {})
    expect(result.hasChanges).toBe(false)
    expect(result.changedLayers).toHaveLength(0)
  })
})

// ─── Context Stack Caching ──────────────────────────────────────────

describe('cacheContextStack / getCachedContextStack', () => {
  const makeStack = (threadId: string): CachedContextStack => ({
    threadId,
    layers: [
      { name: 'repoContext', content: '## Repo\nContent here', checksum: 'abc', estimatedTokens: 10 },
      { name: 'ticketChain', content: '## Tickets\nIssue info', checksum: 'def', estimatedTokens: 8 },
    ],
    totalTokens: 18,
    formatted: '## Repo\nContent here\n\n---\n\n## Tickets\nIssue info',
    checksums: { repoContext: 'abc', ticketChain: 'def' },
  })

  it('caches and retrieves a context stack', () => {
    const stack = makeStack('thread-1')
    cacheContextStack(stack)

    const retrieved = getCachedContextStack('thread-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.threadId).toBe('thread-1')
    expect(retrieved!.layers).toHaveLength(2)
    expect(retrieved!.totalTokens).toBe(18)
  })

  it('returns null for uncached thread', () => {
    expect(getCachedContextStack('nonexistent')).toBeNull()
  })
})

// ─── Fork-from-Cache ────────────────────────────────────────────────

describe('forkContextStack', () => {
  const parentStack: CachedContextStack = {
    threadId: 'parent-thread',
    layers: [
      { name: 'repoContext', content: '## Repo\nParent docs', checksum: 'repo-cs', estimatedTokens: 10 },
      { name: 'ticketChain', content: '## Tickets\nParent issue', checksum: 'ticket-cs', estimatedTokens: 8 },
    ],
    totalTokens: 18,
    formatted: '## Repo\nParent docs\n\n---\n\n## Tickets\nParent issue',
    checksums: { repoContext: 'repo-cs', ticketChain: 'ticket-cs' },
  }

  it('forks parent context with overrides', () => {
    cacheContextStack(parentStack)

    const child = forkContextStack('parent-thread', 'child-thread', {
      ticketChain: {
        content: '## Tickets\nChild issue',
        checksum: 'child-ticket-cs',
        estimatedTokens: 9,
      },
    })

    expect(child).not.toBeNull()
    expect(child!.threadId).toBe('child-thread')
    expect(child!.layers).toHaveLength(2)

    // Repo context inherited from parent
    const repoLayer = child!.layers.find(l => l.name === 'repoContext')
    expect(repoLayer!.content).toBe('## Repo\nParent docs')
    expect(repoLayer!.checksum).toBe('repo-cs')

    // Ticket chain overridden for child
    const ticketLayer = child!.layers.find(l => l.name === 'ticketChain')
    expect(ticketLayer!.content).toBe('## Tickets\nChild issue')
    expect(ticketLayer!.checksum).toBe('child-ticket-cs')
  })

  it('adds new layers that parent did not have', () => {
    cacheContextStack(parentStack)

    const child = forkContextStack('parent-thread', 'child-thread', {
      executionState: {
        content: '## Exec Plan',
        checksum: 'exec-cs',
        estimatedTokens: 5,
      },
    })

    expect(child).not.toBeNull()
    expect(child!.layers).toHaveLength(3) // repo + ticket + exec
  })

  it('returns null when parent is not cached', () => {
    expect(forkContextStack('missing', 'child', {})).toBeNull()
  })

  it('caches the forked stack', () => {
    cacheContextStack(parentStack)

    forkContextStack('parent-thread', 'child-thread', {})
    expect(getCachedContextStack('child-thread')).not.toBeNull()
  })
})

// ─── Webhook Invalidation ───────────────────────────────────────────

describe('invalidateForWebhook', () => {
  beforeEach(() => {
    setCache('issue:gigi#42', 'data', 60_000)
    setCache('issue:gigi#43', 'data', 60_000)
    setCache('claude_md:idea/gigi', 'docs', 60_000)
    setCache('context_stack:thread-1', '{}', 60_000)
  })

  it('invalidates issue caches on issue_update', () => {
    const count = invalidateForWebhook('issue_update', 'gigi', { number: 42 })
    expect(count).toBeGreaterThan(0)
    expect(getCached('issue:gigi#42')).toBeNull()
    expect(getCached('issue:gigi#43')).toBe('data') // other issue untouched
    expect(getCached('context_stack:thread-1')).toBeNull() // stacks invalidated
  })

  it('invalidates issue caches on issue_close', () => {
    const count = invalidateForWebhook('issue_close', 'gigi', { number: 42 })
    expect(count).toBeGreaterThan(0)
    expect(getCached('issue:gigi#42')).toBeNull()
  })

  it('invalidates on pr_merge', () => {
    const count = invalidateForWebhook('pr_merge', 'gigi', { number: 42 })
    expect(count).toBeGreaterThan(0)
    expect(getCached('issue:gigi#42')).toBeNull()
    expect(getCached('context_stack:thread-1')).toBeNull()
  })

  it('invalidates CLAUDE.md cache on push with CLAUDE.md file', () => {
    const count = invalidateForWebhook('push', 'idea/gigi', { files: ['CLAUDE.md', 'src/index.ts'] })
    expect(count).toBeGreaterThan(0)
    expect(getCached('claude_md:idea/gigi')).toBeNull()
  })

  it('does nothing on push without CLAUDE.md', () => {
    const count = invalidateForWebhook('push', 'idea/gigi', { files: ['src/index.ts'] })
    expect(count).toBe(0)
    expect(getCached('claude_md:idea/gigi')).toBe('docs')
  })
})

// ─── Garbage Collection ─────────────────────────────────────────────

describe('gc', () => {
  it('removes expired cache entries', () => {
    setCache('fresh', 'val', 60_000) // 60s TTL
    setCache('expired', 'val', 1) // 1ms TTL

    // Wait for expiry
    const start = Date.now()
    while (Date.now() - start < 5) { /* busy wait */ }

    const removed = gc()
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(getCached('fresh')).toBe('val')
  })
})

// ─── Stats ──────────────────────────────────────────────────────────

describe('getStats', () => {
  it('tracks cache hits and misses', () => {
    setCache('k', 'v', 60_000)
    getCached('k')       // hit
    getCached('k')       // hit
    getCached('missing') // miss

    const stats = getStats()
    expect(stats.size).toBe(1)
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBeCloseTo(66.67, 0)
  })

  it('tracks active sessions', () => {
    recordInjection('s1', 't1', {})
    recordInjection('s2', 't2', {})

    const stats = getStats()
    expect(stats.activeSessions).toBe(2)
  })
})

// ─── TTL Constants ──────────────────────────────────────────────────

describe('TTL constants', () => {
  it('has reasonable TTL values', () => {
    expect(CLAUDE_MD_TTL).toBe(5 * 60 * 1000)     // 5 min
    expect(TICKET_TTL).toBe(10 * 60 * 1000)        // 10 min
    expect(LINEAGE_TTL).toBe(30 * 60 * 1000)       // 30 min
    expect(CONTEXT_STACK_TTL).toBe(5 * 60 * 1000)  // 5 min
    expect(SESSION_TTL).toBe(60 * 60 * 1000)        // 1 hour
  })
})
