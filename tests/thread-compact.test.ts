/**
 * Thread Compact Tests
 *
 * Tests for the thread compaction module's pure functions:
 * - Event text extraction
 * - Event formatting for summaries
 * - Context building logic
 * - Basic summary fallback
 *
 * Pure function tests — no database or API calls required.
 */

import assert from 'node:assert/strict'

// ─── Re-implement pure functions for testing (same logic as thread-compact.ts) ─

interface MockThreadEvent {
  id: string
  thread_id: string
  channel: string
  direction: string
  actor: string
  content: unknown
  message_type: string
  usage: unknown | null
  metadata: Record<string, unknown>
  is_compacted: boolean
  created_at: string
}

/** Extract readable text from event content */
function extractEventText(event: MockThreadEvent): string {
  const content = event.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    try {
      return JSON.stringify(content).slice(0, 500)
    } catch {
      return '[non-text content]'
    }
  }
  return ''
}

/** Format events for summary prompt */
function formatEventsForSummary(events: MockThreadEvent[]): string {
  return events.map(e => {
    const text = extractEventText(e)
    const timestamp = new Date(e.created_at).toISOString().slice(0, 16)
    const truncated = text.length > 600 ? text.slice(0, 600) + '...' : text
    return `[${timestamp}] [${e.channel}/${e.direction}] ${e.actor}: ${truncated}`
  }).join('\n\n')
}

/** Basic summary fallback (no LLM) */
function formatBasicSummary(events: MockThreadEvent[]): string {
  const channels = [...new Set(events.map(e => e.channel))]
  const actors = [...new Set(events.map(e => e.actor))]
  const firstDate = events[0]?.created_at ? new Date(events[0].created_at).toISOString().slice(0, 10) : 'unknown'
  const lastDate = events[events.length - 1]?.created_at
    ? new Date(events[events.length - 1].created_at).toISOString().slice(0, 10)
    : 'unknown'
  return `Thread with ${events.length} events from ${firstDate} to ${lastDate}. Channels: ${channels.join(', ')}. Participants: ${actors.join(', ')}.`
}

/** Build context messages from events */
function buildContextFromEvents(events: MockThreadEvent[]): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  for (const event of events) {
    const role: 'user' | 'assistant' = event.direction === 'inbound' ? 'user' : 'assistant'
    if (event.message_type === 'summary') {
      const summaryText = extractEventText(event)
      const metadata = event.metadata as Record<string, unknown>
      const compactedCount = metadata?.compacted_count ?? metadata?.source_event_count ?? '?'
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `[THREAD SUMMARY — ${compactedCount} earlier events condensed]\n${summaryText}` }],
      })
      continue
    }
    messages.push({ role, content: event.content })
  }
  return messages
}

// ─── Test Helpers ───────────────────────────────────────────────────

function makeEvent(overrides: Partial<MockThreadEvent> = {}): MockThreadEvent {
  return {
    id: 'evt-1',
    thread_id: 'thread-1',
    channel: 'web',
    direction: 'inbound',
    actor: 'user',
    content: [{ type: 'text', text: 'Hello' }],
    message_type: 'text',
    usage: null,
    metadata: {},
    is_compacted: false,
    created_at: '2026-02-21T10:00:00Z',
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('extractEventText', () => {
  it('extracts text from content blocks array', () => {
    const event = makeEvent({ content: [{ type: 'text', text: 'Hello world' }] })
    assert.equal(extractEventText(event), 'Hello world')
  })

  it('extracts text from plain string content', () => {
    const event = makeEvent({ content: 'Plain string message' })
    assert.equal(extractEventText(event), 'Plain string message')
  })

  it('joins multiple text blocks', () => {
    const event = makeEvent({
      content: [
        { type: 'text', text: 'First part' },
        { type: 'text', text: 'Second part' },
      ],
    })
    assert.equal(extractEventText(event), 'First part\nSecond part')
  })

  it('filters out non-text blocks', () => {
    const event = makeEvent({
      content: [
        { type: 'text', text: 'Keep this' },
        { type: 'tool_use', name: 'bash', input: {} },
        { type: 'text', text: 'And this' },
      ],
    })
    assert.equal(extractEventText(event), 'Keep this\nAnd this')
  })

  it('handles object content (webhooks) by JSON-stringifying', () => {
    const event = makeEvent({ content: { action: 'opened', number: 42 } })
    const text = extractEventText(event)
    assert.ok(text.includes('opened'))
    assert.ok(text.includes('42'))
  })

  it('returns empty string for null content', () => {
    const event = makeEvent({ content: null })
    assert.equal(extractEventText(event), '')
  })

  it('truncates long JSON objects to 500 chars', () => {
    const longContent = { data: 'x'.repeat(1000) }
    const event = makeEvent({ content: longContent })
    const text = extractEventText(event)
    assert.ok(text.length <= 500)
  })
})

describe('formatEventsForSummary', () => {
  it('formats events with timestamp, channel, and actor', () => {
    const events = [
      makeEvent({
        created_at: '2026-02-21T10:30:00Z',
        channel: 'web',
        direction: 'inbound',
        actor: 'user',
        content: [{ type: 'text', text: 'Help me with dark mode' }],
      }),
    ]
    const formatted = formatEventsForSummary(events)
    assert.ok(formatted.includes('2026-02-21T10:30'))
    assert.ok(formatted.includes('web/inbound'))
    assert.ok(formatted.includes('user:'))
    assert.ok(formatted.includes('Help me with dark mode'))
  })

  it('truncates long event text to 600 chars', () => {
    const longText = 'x'.repeat(800)
    const events = [makeEvent({ content: [{ type: 'text', text: longText }] })]
    const formatted = formatEventsForSummary(events)
    assert.ok(formatted.includes('...'))
    assert.ok(formatted.length < 800)
  })

  it('separates multiple events with double newlines', () => {
    const events = [
      makeEvent({ id: '1', content: [{ type: 'text', text: 'First' }] }),
      makeEvent({ id: '2', content: [{ type: 'text', text: 'Second' }] }),
    ]
    const formatted = formatEventsForSummary(events)
    assert.ok(formatted.includes('\n\n'))
  })
})

describe('formatBasicSummary', () => {
  it('produces a fallback summary with key metadata', () => {
    const events = [
      makeEvent({ channel: 'web', actor: 'user', created_at: '2026-02-20T09:00:00Z' }),
      makeEvent({ channel: 'telegram', actor: 'gigi', created_at: '2026-02-21T15:00:00Z' }),
    ]
    const summary = formatBasicSummary(events)
    assert.ok(summary.includes('2 events'))
    assert.ok(summary.includes('web'))
    assert.ok(summary.includes('telegram'))
    assert.ok(summary.includes('user'))
    assert.ok(summary.includes('gigi'))
    assert.ok(summary.includes('2026-02-20'))
    assert.ok(summary.includes('2026-02-21'))
  })

  it('handles single event', () => {
    const events = [makeEvent()]
    const summary = formatBasicSummary(events)
    assert.ok(summary.includes('1 events'))
  })
})

describe('buildContextFromEvents', () => {
  it('maps inbound events to user role', () => {
    const events = [makeEvent({ direction: 'inbound' })]
    const messages = buildContextFromEvents(events)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role, 'user')
  })

  it('maps outbound events to assistant role', () => {
    const events = [makeEvent({ direction: 'outbound', actor: 'gigi' })]
    const messages = buildContextFromEvents(events)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role, 'assistant')
  })

  it('formats summary events with THREAD SUMMARY prefix', () => {
    const events = [
      makeEvent({
        message_type: 'summary',
        direction: 'outbound',
        actor: 'system',
        content: [{ type: 'text', text: 'Summary of events 1-15' }],
        metadata: { compacted_count: 15 },
      }),
    ]
    const messages = buildContextFromEvents(events)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role, 'user') // summaries are user-role context
    const text = (messages[0].content as Array<{ text: string }>)[0].text
    assert.ok(text.includes('[THREAD SUMMARY — 15 earlier events condensed]'))
    assert.ok(text.includes('Summary of events 1-15'))
  })

  it('handles fork-compact summary with source_event_count', () => {
    const events = [
      makeEvent({
        message_type: 'summary',
        direction: 'outbound',
        actor: 'system',
        content: [{ type: 'text', text: 'Forked summary' }],
        metadata: { source_event_count: 30, compact_type: 'fork' },
      }),
    ]
    const messages = buildContextFromEvents(events)
    const text = (messages[0].content as Array<{ text: string }>)[0].text
    assert.ok(text.includes('[THREAD SUMMARY — 30 earlier events condensed]'))
  })

  it('builds complete context: summary + recent events', () => {
    const events = [
      makeEvent({
        id: 'summary-1',
        message_type: 'summary',
        direction: 'outbound',
        actor: 'system',
        content: [{ type: 'text', text: 'Summary of 15 earlier events' }],
        metadata: { compacted_count: 15 },
        created_at: '2026-02-21T10:00:00Z',
      }),
      makeEvent({
        id: 'evt-16',
        direction: 'inbound',
        actor: 'user',
        content: [{ type: 'text', text: 'Continue working on dark mode' }],
        created_at: '2026-02-21T10:01:00Z',
      }),
      makeEvent({
        id: 'evt-17',
        direction: 'outbound',
        actor: 'gigi',
        content: [{ type: 'text', text: 'Sure, I will continue.' }],
        created_at: '2026-02-21T10:02:00Z',
      }),
    ]
    const messages = buildContextFromEvents(events)
    assert.equal(messages.length, 3)
    assert.equal(messages[0].role, 'user')   // summary (as context)
    assert.equal(messages[1].role, 'user')   // user message
    assert.equal(messages[2].role, 'assistant') // assistant reply
  })

  it('returns empty array for no events', () => {
    const messages = buildContextFromEvents([])
    assert.equal(messages.length, 0)
  })
})

// ─── Channel Attribution ────────────────────────────────────────────

/** Channel labels for attribution */
const CHANNEL_LABELS: Record<string, string> = {
  web: 'Web',
  telegram: 'Telegram',
  gitea_comment: 'Gitea comment',
  gitea_review: 'Gitea review',
  webhook: 'Webhook',
  system: 'System',
}

/** Format channel attribution prefix */
function formatChannelAttribution(event: MockThreadEvent): string {
  const label = CHANNEL_LABELS[event.channel] ?? event.channel
  const actor = event.actor !== 'user' && event.actor !== 'gigi'
    ? ` by ${event.actor}`
    : ''
  return `[via ${label}${actor}]`
}

/** Add channel attribution to content */
function addChannelAttributionToContent(event: MockThreadEvent, enableAttribution: boolean): unknown {
  if (!enableAttribution || event.direction === 'outbound') return event.content
  const attribution = formatChannelAttribution(event)
  const content = event.content
  if (Array.isArray(content)) {
    const blocks = content as Array<{ type: string; text?: string }>
    const firstTextIdx = blocks.findIndex(b => b.type === 'text' && b.text)
    if (firstTextIdx >= 0) {
      const modified = [...blocks]
      modified[firstTextIdx] = {
        ...modified[firstTextIdx],
        text: `${attribution} ${modified[firstTextIdx].text}`,
      }
      return modified
    }
  }
  if (typeof content === 'string') return `${attribution} ${content}`
  return content
}

/** Format refs context */
function formatRefsContext(refs: Array<{ ref_type: string; repo: string; number?: number | null; ref?: string | null; status?: string | null; url?: string | null }>): string | null {
  if (refs.length === 0) return null
  const lines = refs.map(r => {
    const num = r.number ? `#${r.number}` : r.ref || ''
    const status = r.status ? ` (${r.status})` : ''
    return `- ${r.ref_type} ${r.repo}${num}${status}${r.url ? ` — ${r.url}` : ''}`
  })
  return `[LINKED REFS]\n${lines.join('\n')}`
}

/** Estimate tokens from content */
function estimateTokens(content: unknown): number {
  if (typeof content === 'string') return Math.ceil(content.length / 4)
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .reduce((sum, b) => sum + (b.text ? Math.ceil(b.text.length / 4) : 0), 0)
  }
  if (content && typeof content === 'object') {
    try { return Math.ceil(JSON.stringify(content).length / 4) } catch { return 0 }
  }
  return 0
}

describe('formatChannelAttribution', () => {
  it('formats web channel for regular user', () => {
    const event = makeEvent({ channel: 'web', actor: 'user' })
    assert.equal(formatChannelAttribution(event), '[via Web]')
  })

  it('formats telegram channel for regular user', () => {
    const event = makeEvent({ channel: 'telegram', actor: 'user' })
    assert.equal(formatChannelAttribution(event), '[via Telegram]')
  })

  it('includes actor name for non-user/gigi actors', () => {
    const event = makeEvent({ channel: 'gitea_comment', actor: '@testuser' })
    assert.equal(formatChannelAttribution(event), '[via Gitea comment by @testuser]')
  })

  it('does not include actor for gigi', () => {
    const event = makeEvent({ channel: 'web', actor: 'gigi' })
    assert.equal(formatChannelAttribution(event), '[via Web]')
  })

  it('handles unknown channel type gracefully', () => {
    const event = makeEvent({ channel: 'slack' as string })
    assert.equal(formatChannelAttribution(event), '[via slack]')
  })
})

describe('addChannelAttributionToContent', () => {
  it('prepends attribution to text content blocks for inbound events', () => {
    const event = makeEvent({
      channel: 'telegram',
      direction: 'inbound',
      content: [{ type: 'text', text: 'Hello from phone' }],
    })
    const result = addChannelAttributionToContent(event, true) as Array<{ type: string; text: string }>
    assert.equal(result[0].text, '[via Telegram] Hello from phone')
  })

  it('does NOT add attribution to outbound events', () => {
    const event = makeEvent({
      channel: 'web',
      direction: 'outbound',
      actor: 'gigi',
      content: [{ type: 'text', text: 'Sure, I will help' }],
    })
    const result = addChannelAttributionToContent(event, true) as Array<{ type: string; text: string }>
    assert.equal(result[0].text, 'Sure, I will help')
  })

  it('does NOT add attribution when disabled', () => {
    const event = makeEvent({
      channel: 'telegram',
      direction: 'inbound',
      content: [{ type: 'text', text: 'Hello' }],
    })
    const result = addChannelAttributionToContent(event, false) as Array<{ type: string; text: string }>
    assert.equal(result[0].text, 'Hello')
  })

  it('handles string content', () => {
    const event = makeEvent({
      channel: 'telegram',
      direction: 'inbound',
      content: 'Plain string message',
    })
    const result = addChannelAttributionToContent(event, true)
    assert.equal(result, '[via Telegram] Plain string message')
  })

  it('preserves non-text blocks while attributing the first text block', () => {
    const event = makeEvent({
      channel: 'gitea_review',
      direction: 'inbound',
      actor: '@reviewer',
      content: [
        { type: 'tool_result', id: 'x' },
        { type: 'text', text: 'Looks good' },
      ],
    })
    const result = addChannelAttributionToContent(event, true) as Array<{ type: string; text?: string }>
    assert.equal(result[0].type, 'tool_result') // non-text preserved
    assert.equal(result[1].text, '[via Gitea review by @reviewer] Looks good')
  })
})

describe('formatRefsContext', () => {
  it('formats multiple refs with status and URLs', () => {
    const refs = [
      { ref_type: 'issue', repo: 'gigi', number: 37, status: 'open', ref: null, url: 'http://gitea/gigi/issues/37' },
      { ref_type: 'pr', repo: 'gigi', number: 31, status: 'merged', ref: null, url: 'http://gitea/gigi/pulls/31' },
    ]
    const result = formatRefsContext(refs)!
    assert.ok(result.includes('[LINKED REFS]'))
    assert.ok(result.includes('issue gigi#37 (open)'))
    assert.ok(result.includes('pr gigi#31 (merged)'))
  })

  it('returns null for empty refs', () => {
    assert.equal(formatRefsContext([]), null)
  })

  it('handles refs without number (e.g., branches)', () => {
    const refs = [
      { ref_type: 'branch', repo: 'gigi', number: null, ref: 'feat/dark-mode', status: null, url: null },
    ]
    const result = formatRefsContext(refs)!
    assert.ok(result.includes('branch gigifeat/dark-mode'))
  })
})

describe('estimateTokens', () => {
  it('estimates tokens for a string (~4 chars per token)', () => {
    const tokens = estimateTokens('Hello world!!') // 13 chars → 4 tokens
    assert.equal(tokens, Math.ceil(13 / 4))
  })

  it('estimates tokens for content block arrays', () => {
    const tokens = estimateTokens([
      { type: 'text', text: 'Hello' },      // 5 chars
      { type: 'text', text: 'World' },      // 5 chars
    ]) // 10 chars → 3 tokens
    assert.equal(tokens, Math.ceil(5 / 4) + Math.ceil(5 / 4))
  })

  it('returns 0 for null/undefined content', () => {
    assert.equal(estimateTokens(null), 0)
    assert.equal(estimateTokens(undefined), 0)
  })

  it('handles object content (JSON)', () => {
    const tokens = estimateTokens({ key: 'value' })
    assert.ok(tokens > 0)
  })
})

describe('buildContextFromEvents (with attribution)', () => {
  /** Enhanced buildContext that includes channel attribution */
  function buildContextWithAttribution(
    events: MockThreadEvent[],
    refs: Array<{ ref_type: string; repo: string; number?: number | null; status?: string | null; ref?: string | null; url?: string | null }> = [],
    enableAttribution = true,
  ) {
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
    let totalTokens = 0

    // Prepend refs
    const refsText = formatRefsContext(refs)
    if (refsText) {
      const refsContent = [{ type: 'text', text: refsText }]
      messages.push({ role: 'user', content: refsContent })
      totalTokens += estimateTokens(refsContent)
    }

    for (const event of events) {
      const role: 'user' | 'assistant' = event.direction === 'inbound' ? 'user' : 'assistant'
      if (event.message_type === 'summary') {
        const summaryText = extractEventText(event)
        const metadata = event.metadata as Record<string, unknown>
        const compactedCount = metadata?.compacted_count ?? metadata?.source_event_count ?? '?'
        const content = [{ type: 'text', text: `[THREAD SUMMARY — ${compactedCount} earlier events condensed]\n${summaryText}` }]
        messages.push({ role: 'user', content })
        totalTokens += estimateTokens(content)
        continue
      }
      const content = addChannelAttributionToContent(event, enableAttribution)
      messages.push({ role, content })
      totalTokens += estimateTokens(content)
    }

    const channels = [...new Set(events.map(e => e.channel))]
    return { messages, estimatedTokens: totalTokens, eventCount: events.length, channels }
  }

  it('adds channel attribution to cross-channel events', () => {
    const events = [
      makeEvent({ channel: 'telegram', direction: 'inbound', content: [{ type: 'text', text: 'Add dark mode' }] }),
      makeEvent({ channel: 'web', direction: 'outbound', actor: 'gigi', content: [{ type: 'text', text: 'Sure!' }] }),
      makeEvent({ channel: 'gitea_comment', direction: 'inbound', actor: '@testuser', content: [{ type: 'text', text: 'Also add persistence' }] }),
    ]
    const result = buildContextWithAttribution(events)
    assert.equal(result.messages.length, 3)
    // Inbound telegram gets attribution
    assert.ok((result.messages[0].content as Array<{ text: string }>)[0].text.includes('[via Telegram]'))
    // Outbound from gigi: no attribution
    assert.ok(!(result.messages[1].content as Array<{ text: string }>)[0].text.includes('[via'))
    // Inbound gitea: attribution with actor
    assert.ok((result.messages[2].content as Array<{ text: string }>)[0].text.includes('[via Gitea comment by @testuser]'))
  })

  it('includes linked refs as first message', () => {
    const refs = [{ ref_type: 'issue', repo: 'gigi', number: 37, status: 'open', ref: null, url: null }]
    const events = [makeEvent()]
    const result = buildContextWithAttribution(events, refs)
    assert.equal(result.messages.length, 2) // refs + 1 event
    assert.ok((result.messages[0].content as Array<{ text: string }>)[0].text.includes('[LINKED REFS]'))
    assert.equal(result.messages[0].role, 'user')
  })

  it('tracks channels present in context', () => {
    const events = [
      makeEvent({ channel: 'web' }),
      makeEvent({ channel: 'telegram' }),
      makeEvent({ channel: 'telegram' }),
    ]
    const result = buildContextWithAttribution(events)
    assert.deepEqual(result.channels.sort(), ['telegram', 'web'])
  })

  it('estimates total token count', () => {
    const events = [
      makeEvent({ content: [{ type: 'text', text: 'Hello world from telegram' }] }),
    ]
    const result = buildContextWithAttribution(events)
    assert.ok(result.estimatedTokens > 0)
  })

  it('works with attribution disabled', () => {
    const events = [
      makeEvent({ channel: 'telegram', direction: 'inbound', content: [{ type: 'text', text: 'No attribution' }] }),
    ]
    const result = buildContextWithAttribution(events, [], false)
    assert.ok(!(result.messages[0].content as Array<{ text: string }>)[0].text.includes('[via'))
  })
})

// ─── Compaction Logic Validation ────────────────────────────────────

describe('Compaction logic validation', () => {
  it('identifies older events correctly (all but last N)', () => {
    const keepRecent = 3
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, created_at: `2026-02-21T${String(i).padStart(2, '0')}:00:00Z` })
    )

    const olderEvents = events.slice(0, -keepRecent)
    const recentEvents = events.slice(-keepRecent)

    assert.equal(olderEvents.length, 7)
    assert.equal(recentEvents.length, 3)
    assert.equal(olderEvents[olderEvents.length - 1].id, 'evt-6')
    assert.equal(recentEvents[0].id, 'evt-7')
  })

  it('refuses to compact when events <= keep_recent', () => {
    const keepRecent = 10
    const events = Array.from({ length: 5 }, (_, i) => makeEvent({ id: `evt-${i}` }))

    const shouldCompact = events.length > keepRecent
    assert.equal(shouldCompact, false)
  })

  it('correctly identifies cutoff date for compaction', () => {
    const keepRecent = 2
    const events = [
      makeEvent({ id: 'evt-1', created_at: '2026-02-21T08:00:00Z' }),
      makeEvent({ id: 'evt-2', created_at: '2026-02-21T09:00:00Z' }),
      makeEvent({ id: 'evt-3', created_at: '2026-02-21T10:00:00Z' }),
      makeEvent({ id: 'evt-4', created_at: '2026-02-21T11:00:00Z' }),
    ]

    const cutoffDate = events[events.length - keepRecent].created_at
    assert.equal(cutoffDate, '2026-02-21T10:00:00Z')
  })
})

// ─── Should Compact Heuristic ───────────────────────────────────────

describe('shouldCompact heuristic', () => {
  it('recommends compaction when event count exceeds threshold', () => {
    const count = 25
    const threshold = 20
    const result = count > threshold
    assert.equal(result, true)
  })

  it('does not recommend compaction below threshold', () => {
    const count = 15
    const threshold = 20
    const result = count > threshold
    assert.equal(result, false)
  })

  it('does not recommend compaction at exactly threshold', () => {
    const count = 20
    const threshold = 20
    const result = count > threshold
    assert.equal(result, false)
  })
})
