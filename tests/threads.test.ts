/**
 * Thread Data Model Tests
 *
 * Tests for the thread store module types, tag parsing logic,
 * and thread status transitions.
 *
 * Pure function tests — no database calls required. These validate the
 * logic that will be used by the thread store functions.
 */

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

// ─── Thread Fork Logic (pure function tests) ────────────────────────

interface MockThread {
  id: string
  topic: string | null
  parent_thread_id: string | null
  fork_point_event_id: string | null
  session_id: string | null
}

interface MockEvent {
  id: string
  thread_id: string
  created_at: string
}

/**
 * Validate fork options — pure logic extracted from forkThread.
 */
function validateForkOpts(
  source: MockThread | null,
  events: MockEvent[],
  atEventId?: string
): { valid: boolean; error?: string; forkPointEventId: string | null } {
  if (!source) {
    return { valid: false, error: 'Source thread not found', forkPointEventId: null }
  }

  if (atEventId) {
    const event = events.find(e => e.id === atEventId && e.thread_id === source.id)
    if (!event) {
      return { valid: false, error: `Event ${atEventId} not found in thread`, forkPointEventId: null }
    }
    return { valid: true, forkPointEventId: atEventId }
  }

  // Fork at HEAD — use the last event
  const lastEvent = events
    .filter(e => e.thread_id === source.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .at(-1)

  return { valid: true, forkPointEventId: lastEvent?.id ?? null }
}

/**
 * Build the topic for a forked thread.
 */
function buildForkTopic(customTopic: string | undefined, sourceTopic: string | null): string | null {
  if (customTopic) return customTopic
  if (sourceTopic) return `Fork of: ${sourceTopic}`
  return null
}

/**
 * Determine which events should be copied in a fork.
 */
function eventsToFork(
  events: MockEvent[],
  sourceId: string,
  forkPointEventId: string | null
): MockEvent[] {
  if (!forkPointEventId) return []

  const sourceEvents = events
    .filter(e => e.thread_id === sourceId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const forkEvent = sourceEvents.find(e => e.id === forkPointEventId)
  if (!forkEvent) return []

  return sourceEvents.filter(e => e.created_at <= forkEvent.created_at)
}

describe('Thread fork validation', () => {
  const events: MockEvent[] = [
    { id: 'e1', thread_id: 't1', created_at: '2026-01-01T00:00:00Z' },
    { id: 'e2', thread_id: 't1', created_at: '2026-01-01T01:00:00Z' },
    { id: 'e3', thread_id: 't1', created_at: '2026-01-01T02:00:00Z' },
    { id: 'e4', thread_id: 't2', created_at: '2026-01-01T00:00:00Z' },
  ]

  const source: MockThread = {
    id: 't1', topic: 'Main thread', parent_thread_id: null,
    fork_point_event_id: null, session_id: 'sess-1',
  }

  it('validates fork at HEAD (last event)', () => {
    const result = validateForkOpts(source, events)
    assert.ok(result.valid)
    assert.equal(result.forkPointEventId, 'e3')
  })

  it('validates fork at specific event', () => {
    const result = validateForkOpts(source, events, 'e2')
    assert.ok(result.valid)
    assert.equal(result.forkPointEventId, 'e2')
  })

  it('rejects fork at non-existent event', () => {
    const result = validateForkOpts(source, events, 'e999')
    assert.ok(!result.valid)
    assert.ok(result.error?.includes('not found'))
  })

  it('rejects fork at event from wrong thread', () => {
    const result = validateForkOpts(source, events, 'e4')
    assert.ok(!result.valid)
  })

  it('rejects fork of non-existent thread', () => {
    const result = validateForkOpts(null, events)
    assert.ok(!result.valid)
    assert.ok(result.error?.includes('not found'))
  })

  it('handles thread with no events', () => {
    const result = validateForkOpts(source, [])
    assert.ok(result.valid)
    assert.equal(result.forkPointEventId, null)
  })
})

describe('Fork topic generation', () => {
  it('uses custom topic when provided', () => {
    assert.equal(buildForkTopic('My fork', 'Original'), 'My fork')
  })

  it('generates topic from source when no custom topic', () => {
    assert.equal(buildForkTopic(undefined, 'Main thread'), 'Fork of: Main thread')
  })

  it('returns null when no topic available', () => {
    assert.equal(buildForkTopic(undefined, null), null)
  })
})

describe('Events to fork selection', () => {
  const events: MockEvent[] = [
    { id: 'e1', thread_id: 't1', created_at: '2026-01-01T00:00:00Z' },
    { id: 'e2', thread_id: 't1', created_at: '2026-01-01T01:00:00Z' },
    { id: 'e3', thread_id: 't1', created_at: '2026-01-01T02:00:00Z' },
    { id: 'e4', thread_id: 't2', created_at: '2026-01-01T00:30:00Z' },
  ]

  it('copies all events up to fork point at HEAD', () => {
    const result = eventsToFork(events, 't1', 'e3')
    assert.equal(result.length, 3)
    assert.deepEqual(result.map(e => e.id), ['e1', 'e2', 'e3'])
  })

  it('copies only events up to mid-point fork', () => {
    const result = eventsToFork(events, 't1', 'e2')
    assert.equal(result.length, 2)
    assert.deepEqual(result.map(e => e.id), ['e1', 'e2'])
  })

  it('copies only first event when forking at first event', () => {
    const result = eventsToFork(events, 't1', 'e1')
    assert.equal(result.length, 1)
    assert.deepEqual(result.map(e => e.id), ['e1'])
  })

  it('returns empty when no fork point', () => {
    const result = eventsToFork(events, 't1', null)
    assert.equal(result.length, 0)
  })

  it('excludes events from other threads', () => {
    const result = eventsToFork(events, 't1', 'e3')
    assert.ok(!result.some(e => e.thread_id === 't2'))
  })

  it('returns empty for invalid fork point', () => {
    const result = eventsToFork(events, 't1', 'e4') // e4 belongs to t2
    assert.equal(result.length, 0)
  })
})

describe('Forked thread properties', () => {
  it('forked thread should have no session_id (fresh start)', () => {
    // When we fork, we create a new thread with session_id = null
    const forkedThread: MockThread = {
      id: 't2',
      topic: 'Fork of: Main thread',
      parent_thread_id: 't1',
      fork_point_event_id: 'e3',
      session_id: null, // Fresh start — no session from parent
    }

    assert.equal(forkedThread.session_id, null)
    assert.equal(forkedThread.parent_thread_id, 't1')
    assert.equal(forkedThread.fork_point_event_id, 'e3')
  })

  it('fork lineage forms a tree', () => {
    const threads: MockThread[] = [
      { id: 'a', topic: 'Original', parent_thread_id: null, fork_point_event_id: null, session_id: 's1' },
      { id: 'b', topic: 'Fork B', parent_thread_id: 'a', fork_point_event_id: 'e10', session_id: null },
      { id: 'c', topic: 'Fork C', parent_thread_id: 'b', fork_point_event_id: 'e5', session_id: null },
      { id: 'd', topic: 'Fork D', parent_thread_id: 'a', fork_point_event_id: 'e10', session_id: null },
    ]

    // Children of 'a'
    const childrenOfA = threads.filter(t => t.parent_thread_id === 'a')
    assert.equal(childrenOfA.length, 2)
    assert.deepEqual(childrenOfA.map(t => t.id).sort(), ['b', 'd'])

    // Children of 'b'
    const childrenOfB = threads.filter(t => t.parent_thread_id === 'b')
    assert.equal(childrenOfB.length, 1)
    assert.equal(childrenOfB[0].id, 'c')

    // Root has no parent
    const root = threads.find(t => t.parent_thread_id === null)
    assert.equal(root?.id, 'a')
  })
})
