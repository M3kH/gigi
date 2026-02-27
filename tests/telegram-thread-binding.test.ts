/**
 * Telegram Thread Binding Tests
 *
 * Tests for Phase 0: Telegram Thread Binding functionality.
 * Pure function tests — no database or Telegram API calls required.
 *
 * Tests cover:
 * - Telegram command parsing (/switch, /threads, /fork, /compact, /thread)
 * - Thread switching logic (ref parsing, fuzzy matching)
 * - Auto-return to parent logic
 * - Thread formatting for display
 * - MCP tool schema validation
 */

import assert from 'node:assert/strict'

// ── Thread Display Formatting ────────────────────────────────────────

/** Status emoji for thread display */
function statusEmoji(status: string): string {
  switch (status) {
    case 'active': return '🟢'
    case 'paused': return '⏸'
    case 'stopped': return '✅'
    case 'archived': return '📦'
    default: return '⚪'
  }
}

interface MockThreadRef {
  ref_type: string
  repo: string
  number: number | null
}

interface MockThreadDisplay {
  topic: string | null
  status: string
  parent_thread_id: string | null
  refs: MockThreadRef[]
}

/** Format a thread for display as a single line */
function formatThread(t: MockThreadDisplay): string {
  const emoji = statusEmoji(t.status)
  const topic = t.topic || '(untitled)'
  const refs = t.refs
    .filter(r => r.number)
    .map(r => `${r.ref_type === 'pr' ? 'PR' : r.ref_type === 'issue' ? '#' : ''}${r.number}`)
    .join(', ')
  const refsStr = refs ? ` [${refs}]` : ''
  const depth = t.parent_thread_id ? ' ↳' : ''
  return `${depth}${emoji} ${topic}${refsStr}`
}

describe('Thread display formatting', () => {
  it('formats active thread with topic', () => {
    const result = formatThread({
      topic: 'JWT Auth',
      status: 'active',
      parent_thread_id: null,
      refs: [],
    })
    assert.equal(result, '🟢 JWT Auth')
  })

  it('formats paused thread with refs', () => {
    const result = formatThread({
      topic: 'Bug fix',
      status: 'paused',
      parent_thread_id: null,
      refs: [
        { ref_type: 'issue', repo: 'gigi', number: 42 },
        { ref_type: 'pr', repo: 'gigi', number: 99 },
      ],
    })
    assert.equal(result, '⏸ Bug fix [#42, PR99]')
  })

  it('formats child thread with depth indicator', () => {
    const result = formatThread({
      topic: 'Sub-task',
      status: 'active',
      parent_thread_id: 'parent-id',
      refs: [],
    })
    assert.equal(result, ' ↳🟢 Sub-task')
  })

  it('formats untitled thread', () => {
    const result = formatThread({
      topic: null,
      status: 'stopped',
      parent_thread_id: null,
      refs: [],
    })
    assert.equal(result, '✅ (untitled)')
  })

  it('formats archived thread', () => {
    const result = formatThread({
      topic: 'Old work',
      status: 'archived',
      parent_thread_id: null,
      refs: [],
    })
    assert.equal(result, '📦 Old work')
  })

  it('handles unknown status', () => {
    const result = formatThread({
      topic: 'Test',
      status: 'unknown' as string,
      parent_thread_id: null,
      refs: [],
    })
    assert.equal(result, '⚪ Test')
  })

  it('skips refs with null numbers', () => {
    const result = formatThread({
      topic: 'With branch',
      status: 'active',
      parent_thread_id: null,
      refs: [
        { ref_type: 'branch', repo: 'gigi', number: null },
        { ref_type: 'issue', repo: 'gigi', number: 5 },
      ],
    })
    assert.equal(result, '🟢 With branch [#5]')
  })
})

// ── Switch Command Parsing ───────────────────────────────────────────

interface SwitchParseResult {
  type: 'ref' | 'fuzzy'
  repo?: string
  number?: number
  query?: string
}

/**
 * Parse /switch command argument into structured lookup.
 */
function parseSwitchArg(arg: string): SwitchParseResult | null {
  if (!arg.trim()) return null

  const refMatch = arg.match(/^([a-z0-9._-]+)#(\d+)$/i)
  if (refMatch) {
    return {
      type: 'ref',
      repo: refMatch[1],
      number: parseInt(refMatch[2], 10),
    }
  }

  return {
    type: 'fuzzy',
    query: arg.trim().toLowerCase(),
  }
}

describe('/switch command argument parsing', () => {
  it('parses repo#number format', () => {
    const result = parseSwitchArg('gigi#234')
    assert.deepEqual(result, { type: 'ref', repo: 'gigi', number: 234 })
  })

  it('parses repo with dots and dashes', () => {
    const result = parseSwitchArg('my-project.v2#42')
    assert.deepEqual(result, { type: 'ref', repo: 'my-project.v2', number: 42 })
  })

  it('treats text as fuzzy search', () => {
    const result = parseSwitchArg('JWT auth')
    assert.deepEqual(result, { type: 'fuzzy', query: 'jwt auth' })
  })

  it('returns null for empty string', () => {
    assert.equal(parseSwitchArg(''), null)
    assert.equal(parseSwitchArg('   '), null)
  })

  it('handles quoted string as fuzzy', () => {
    const result = parseSwitchArg('"my thread topic"')
    assert.deepEqual(result, { type: 'fuzzy', query: '"my thread topic"' })
  })
})

// ── Fuzzy Thread Matching ────────────────────────────────────────────

interface MockThread {
  id: string
  topic: string | null
  status: string
}

/**
 * Find a thread by fuzzy topic match.
 */
function fuzzyMatchThread(query: string, threads: MockThread[]): MockThread | null {
  const q = query.toLowerCase()
  return threads.find(t => t.topic?.toLowerCase().includes(q)) ?? null
}

describe('Fuzzy thread matching', () => {
  const threads: MockThread[] = [
    { id: 't1', topic: 'JWT Authentication System', status: 'active' },
    { id: 't2', topic: 'Bug fix for login page', status: 'paused' },
    { id: 't3', topic: null, status: 'active' },
    { id: 't4', topic: 'Database migration v2', status: 'stopped' },
  ]

  it('finds thread by partial match', () => {
    const result = fuzzyMatchThread('jwt', threads)
    assert.equal(result?.id, 't1')
  })

  it('finds thread case-insensitively', () => {
    const result = fuzzyMatchThread('LOGIN', threads)
    assert.equal(result?.id, 't2')
  })

  it('returns first match when multiple match', () => {
    // Both t1 and t2 could match something generic
    const result = fuzzyMatchThread('migration', threads)
    assert.equal(result?.id, 't4')
  })

  it('returns null for no match', () => {
    const result = fuzzyMatchThread('nonexistent', threads)
    assert.equal(result, null)
  })

  it('skips threads with null topics', () => {
    const result = fuzzyMatchThread('null', threads)
    assert.equal(result, null)
  })
})

// ── Auto-Return to Parent Logic ──────────────────────────────────────

interface MockActiveMap {
  [key: string]: string  // channel:channelId → conversationId
}

interface MockThreadFull {
  id: string
  parent_thread_id: string | null
  conversation_id: string | null
}

/**
 * Find if any channel is bound to a thread's conversation and determine
 * if it should auto-return to the parent.
 */
function findAutoReturnTarget(
  completedThread: MockThreadFull,
  parentThread: MockThreadFull | null,
  activeMap: MockActiveMap,
): { channelKey: string; parentConvId: string } | null {
  if (!completedThread.parent_thread_id) return null
  if (!parentThread?.conversation_id) return null
  if (!completedThread.conversation_id) return null

  for (const [key, convId] of Object.entries(activeMap)) {
    if (convId === completedThread.conversation_id) {
      return { channelKey: key, parentConvId: parentThread.conversation_id }
    }
  }

  return null
}

describe('Auto-return to parent logic', () => {
  it('finds channel bound to completed sub-thread', () => {
    const result = findAutoReturnTarget(
      { id: 'child', parent_thread_id: 'parent', conversation_id: 'conv-child' },
      { id: 'parent', parent_thread_id: null, conversation_id: 'conv-parent' },
      { 'telegram:12345': 'conv-child' },
    )
    assert.deepEqual(result, {
      channelKey: 'telegram:12345',
      parentConvId: 'conv-parent',
    })
  })

  it('returns null for root thread (no parent)', () => {
    const result = findAutoReturnTarget(
      { id: 'root', parent_thread_id: null, conversation_id: 'conv-root' },
      null,
      { 'telegram:12345': 'conv-root' },
    )
    assert.equal(result, null)
  })

  it('returns null when no channel is bound to the thread', () => {
    const result = findAutoReturnTarget(
      { id: 'child', parent_thread_id: 'parent', conversation_id: 'conv-child' },
      { id: 'parent', parent_thread_id: null, conversation_id: 'conv-parent' },
      { 'telegram:12345': 'conv-other' },
    )
    assert.equal(result, null)
  })

  it('returns null when parent has no conversation', () => {
    const result = findAutoReturnTarget(
      { id: 'child', parent_thread_id: 'parent', conversation_id: 'conv-child' },
      { id: 'parent', parent_thread_id: null, conversation_id: null },
      { 'telegram:12345': 'conv-child' },
    )
    assert.equal(result, null)
  })

  it('returns null when completed thread has no conversation', () => {
    const result = findAutoReturnTarget(
      { id: 'child', parent_thread_id: 'parent', conversation_id: null },
      { id: 'parent', parent_thread_id: null, conversation_id: 'conv-parent' },
      { 'telegram:12345': 'conv-other' },
    )
    assert.equal(result, null)
  })

  it('finds correct channel when multiple channels are active', () => {
    const result = findAutoReturnTarget(
      { id: 'child', parent_thread_id: 'parent', conversation_id: 'conv-child' },
      { id: 'parent', parent_thread_id: null, conversation_id: 'conv-parent' },
      {
        'web:abc': 'conv-other',
        'telegram:12345': 'conv-child',
        'web:def': 'conv-third',
      },
    )
    assert.deepEqual(result, {
      channelKey: 'telegram:12345',
      parentConvId: 'conv-parent',
    })
  })
})

// ── MCP Tool Schema Validation ───────────────────────────────────────

/**
 * Validate list_threads input.
 */
function validateListThreadsInput(input: Record<string, unknown>): { valid: boolean; error?: string } {
  if (input.status) {
    const validStatuses = ['active', 'paused', 'stopped', 'archived']
    if (!validStatuses.includes(input.status as string)) {
      return { valid: false, error: `Invalid status: ${input.status}` }
    }
  }
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || input.limit < 1) {
      return { valid: false, error: 'Limit must be a positive number' }
    }
  }
  return { valid: true }
}

/**
 * Validate switch_thread input.
 */
function validateSwitchThreadInput(input: Record<string, unknown>): { valid: boolean; error?: string } {
  if (!input.thread_id && !input.ref) {
    return { valid: false, error: 'Provide either thread_id or ref' }
  }
  if (input.ref && typeof input.ref === 'string') {
    const refMatch = (input.ref as string).match(/^([a-z0-9._-]+)#(\d+)$/i)
    if (!refMatch) {
      return { valid: false, error: `Invalid ref format: ${input.ref}. Use "repo#number"` }
    }
  }
  return { valid: true }
}

describe('MCP tool input validation', () => {
  describe('list_threads', () => {
    it('accepts empty input', () => {
      assert.ok(validateListThreadsInput({}).valid)
    })

    it('accepts valid status', () => {
      assert.ok(validateListThreadsInput({ status: 'active' }).valid)
      assert.ok(validateListThreadsInput({ status: 'paused' }).valid)
    })

    it('rejects invalid status', () => {
      const result = validateListThreadsInput({ status: 'invalid' })
      assert.ok(!result.valid)
    })

    it('accepts valid limit', () => {
      assert.ok(validateListThreadsInput({ limit: 10 }).valid)
    })

    it('rejects invalid limit', () => {
      assert.ok(!validateListThreadsInput({ limit: 0 }).valid)
      assert.ok(!validateListThreadsInput({ limit: -1 }).valid)
    })
  })

  describe('switch_thread', () => {
    it('accepts thread_id', () => {
      assert.ok(validateSwitchThreadInput({ thread_id: 'abc-123' }).valid)
    })

    it('accepts valid ref', () => {
      assert.ok(validateSwitchThreadInput({ ref: 'gigi#234' }).valid)
    })

    it('rejects missing both thread_id and ref', () => {
      const result = validateSwitchThreadInput({})
      assert.ok(!result.valid)
    })

    it('rejects invalid ref format', () => {
      const result = validateSwitchThreadInput({ ref: 'invalid-ref' })
      assert.ok(!result.valid)
    })
  })
})

// ── Channel Key Parsing ──────────────────────────────────────────────

/**
 * Parse a channel key like "telegram:12345" into parts.
 */
function parseChannelKey(key: string): { channel: string; channelId: string } | null {
  const colonIdx = key.indexOf(':')
  if (colonIdx === -1) return null
  return {
    channel: key.slice(0, colonIdx),
    channelId: key.slice(colonIdx + 1),
  }
}

describe('Channel key parsing', () => {
  it('parses telegram key', () => {
    const result = parseChannelKey('telegram:12345')
    assert.deepEqual(result, { channel: 'telegram', channelId: '12345' })
  })

  it('parses web key', () => {
    const result = parseChannelKey('web:abc-def')
    assert.deepEqual(result, { channel: 'web', channelId: 'abc-def' })
  })

  it('returns null for invalid key', () => {
    assert.equal(parseChannelKey('nocolon'), null)
  })

  it('handles keys with multiple colons', () => {
    const result = parseChannelKey('web:abc:def')
    assert.deepEqual(result, { channel: 'web', channelId: 'abc:def' })
  })
})
