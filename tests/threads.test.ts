/**
 * Thread Data Model Tests
 *
 * Tests for the thread store module types, tag parsing logic,
 * and thread status transitions.
 *
 * Pure function tests — no database calls required. These validate the
 * logic that will be used by the thread store functions.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ─── Tag Parsing Logic ─────────────────────────────────────────────

interface ParsedRef {
  ref_type: 'issue' | 'pr'
  repo: string
  number: number
}

/**
 * Parse conversation tags into thread refs.
 * Parses conversation tags into thread ref structures.
 */
function parseTagsToRefs(tags: string[], convRepo: string | null): ParsedRef[] {
  const refs: ParsedRef[] = []
  for (const tag of tags) {
    // Match repo#number (issue refs) — but not pr#number
    const issueMatch = tag.match(/^(.+)#(\d+)$/)
    if (issueMatch && !tag.startsWith('pr#')) {
      const [, repo, num] = issueMatch
      refs.push({ ref_type: 'issue', repo, number: parseInt(num) })
    }
    // Match pr#number (PR refs) — needs convRepo to know which repo
    const prMatch = tag.match(/^pr#(\d+)$/)
    if (prMatch && convRepo) {
      refs.push({ ref_type: 'pr', repo: convRepo, number: parseInt(prMatch[1]) })
    }
  }
  return refs
}

describe('Tag to ThreadRef parsing', () => {
  it('parses issue tags correctly', () => {
    const refs = parseTagsToRefs(['gigi#39', 'gigi'], null)
    assert.deepEqual(refs, [
      { ref_type: 'issue', repo: 'gigi', number: 39 }
    ])
  })

  it('parses PR tags with repo context', () => {
    const refs = parseTagsToRefs(['gigi', 'gigi#10', 'pr#10'], 'gigi')
    assert.deepEqual(refs, [
      { ref_type: 'issue', repo: 'gigi', number: 10 },
      { ref_type: 'pr', repo: 'gigi', number: 10 },
    ])
  })

  it('ignores PR tags without repo context', () => {
    const refs = parseTagsToRefs(['pr#10'], null)
    assert.deepEqual(refs, [])
  })

  it('handles empty tags', () => {
    const refs = parseTagsToRefs([], null)
    assert.deepEqual(refs, [])
  })

  it('handles multiple issue refs from different repos', () => {
    const refs = parseTagsToRefs(['gigi#39', 'website#5', 'org-press#12'], null)
    assert.deepEqual(refs, [
      { ref_type: 'issue', repo: 'gigi', number: 39 },
      { ref_type: 'issue', repo: 'website', number: 5 },
      { ref_type: 'issue', repo: 'org-press', number: 12 },
    ])
  })

  it('handles repo-only tags (no refs created)', () => {
    const refs = parseTagsToRefs(['gigi', 'website'], null)
    assert.deepEqual(refs, [])
  })
})

// ─── Thread Status Transitions ──────────────────────────────────────

type ThreadStatus = 'active' | 'paused' | 'stopped' | 'archived'

/** Valid status transitions */
const VALID_TRANSITIONS: Record<ThreadStatus, ThreadStatus[]> = {
  active: ['paused'],              // agent finishes turn
  paused: ['active', 'stopped'],   // agent starts or manual stop
  stopped: ['paused', 'archived'], // reopen or archive
  archived: ['paused'],            // unarchive → reopens as paused
}

function isValidTransition(from: ThreadStatus, to: ThreadStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

describe('Thread status transitions', () => {
  it('allows active → paused (agent finishes)', () => {
    assert.ok(isValidTransition('active', 'paused'))
  })

  it('allows paused → active (agent starts)', () => {
    assert.ok(isValidTransition('paused', 'active'))
  })

  it('allows paused → stopped (manual stop)', () => {
    assert.ok(isValidTransition('paused', 'stopped'))
  })

  it('allows stopped → paused (reopen)', () => {
    assert.ok(isValidTransition('stopped', 'paused'))
  })

  it('allows stopped → archived', () => {
    assert.ok(isValidTransition('stopped', 'archived'))
  })

  it('allows archived → paused (unarchive)', () => {
    assert.ok(isValidTransition('archived', 'paused'))
  })

  it('rejects active → stopped (must pause first)', () => {
    assert.ok(!isValidTransition('active', 'stopped'))
  })

  it('rejects active → archived', () => {
    assert.ok(!isValidTransition('active', 'archived'))
  })

  it('rejects paused → archived (must stop first)', () => {
    assert.ok(!isValidTransition('paused', 'archived'))
  })
})

// ─── Conversation → Thread Status Mapping ───────────────────────────

function mapConversationStatus(
  convStatus: string,
  archivedAt: string | null
): ThreadStatus {
  if (archivedAt) return 'archived'
  if (convStatus === 'active') return 'active'
  if (convStatus === 'closed') return 'stopped'
  return 'paused' // 'open' → paused
}

describe('Conversation to thread status mapping', () => {
  it('maps open → paused', () => {
    assert.equal(mapConversationStatus('open', null), 'paused')
  })

  it('maps active → active', () => {
    assert.equal(mapConversationStatus('active', null), 'active')
  })

  it('maps closed → stopped', () => {
    assert.equal(mapConversationStatus('closed', null), 'stopped')
  })

  it('maps any + archived_at → archived', () => {
    assert.equal(mapConversationStatus('open', '2026-01-01T00:00:00Z'), 'archived')
    assert.equal(mapConversationStatus('active', '2026-01-01T00:00:00Z'), 'archived')
    assert.equal(mapConversationStatus('closed', '2026-01-01T00:00:00Z'), 'archived')
  })
})

// ─── Message → ThreadEvent Direction Mapping ─────────────────────────

function mapMessageDirection(role: string): 'inbound' | 'outbound' {
  return role === 'user' ? 'inbound' : 'outbound'
}

function mapMessageActor(role: string): string {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'gigi'
  return 'system'
}

function mapChannelFromConversation(channel: string): string {
  if (channel === 'webhook') return 'webhook'
  if (channel === 'telegram') return 'telegram'
  return 'web'
}

describe('Message to ThreadEvent mapping', () => {
  it('maps user role to inbound direction', () => {
    assert.equal(mapMessageDirection('user'), 'inbound')
  })

  it('maps assistant role to outbound direction', () => {
    assert.equal(mapMessageDirection('assistant'), 'outbound')
  })

  it('maps system role to outbound direction', () => {
    assert.equal(mapMessageDirection('system'), 'outbound')
  })

  it('maps roles to correct actors', () => {
    assert.equal(mapMessageActor('user'), 'user')
    assert.equal(mapMessageActor('assistant'), 'gigi')
    assert.equal(mapMessageActor('system'), 'system')
  })

  it('maps conversation channels correctly', () => {
    assert.equal(mapChannelFromConversation('web'), 'web')
    assert.equal(mapChannelFromConversation('telegram'), 'telegram')
    assert.equal(mapChannelFromConversation('webhook'), 'webhook')
    assert.equal(mapChannelFromConversation('anything_else'), 'web')
  })
})

// ─── ThreadRef Resolution Check ─────────────────────────────────────

interface MockRef {
  status: string | null
}

function areAllRefsResolved(refs: MockRef[]): boolean {
  if (refs.length === 0) return false
  return refs.every(r => r.status === 'closed' || r.status === 'merged')
}

describe('Thread ref resolution check', () => {
  it('returns true when all refs are closed', () => {
    assert.ok(areAllRefsResolved([
      { status: 'closed' },
      { status: 'closed' },
    ]))
  })

  it('returns true when all refs are merged', () => {
    assert.ok(areAllRefsResolved([
      { status: 'merged' },
    ]))
  })

  it('returns true with mixed closed and merged', () => {
    assert.ok(areAllRefsResolved([
      { status: 'closed' },
      { status: 'merged' },
    ]))
  })

  it('returns false when some refs are still open', () => {
    assert.ok(!areAllRefsResolved([
      { status: 'closed' },
      { status: 'open' },
    ]))
  })

  it('returns false when refs have null status', () => {
    assert.ok(!areAllRefsResolved([
      { status: null },
    ]))
  })

  it('returns false for empty refs (no refs = not resolved)', () => {
    assert.ok(!areAllRefsResolved([]))
  })
})
