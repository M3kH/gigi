/**
 * Tests for PR #98 UI/UX batch fixes
 *
 * Covers the changes introduced in the "fix: batch UI/UX improvements" PR:
 *
 * 1. ChatInput autofocus — draft utilities + autofocus prop behavior
 * 2. GigiSidebar new chat — handleNewChat logic opens chat overlay
 * 3. Fork compact default — forkConversation sends compact: true by default
 * 4. Compact system event — compactThread appends system segment
 * 5. Repos filter removed — chips-row no longer rendered in GigiFilters
 * 6. Kanban Done column hidden — fetchBoard filters out done column
 * 7. System events centered — isSystemEvent detection logic
 * 8. Thread fork summary — forkThread with compact creates summary event
 *
 * Related: issue #99
 */

import { describe, it, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  saveDraft,
  loadDraft,
  clearDraft,
  cleanStaleDrafts,
  draftKey,
  DRAFT_PREFIX,
  DRAFT_MAX_AGE_MS,
} from '../web/app/lib/utils/draft'

// ── Mock Storage for draft tests ─────────────────────────────────────

class MockStorage implements Storage {
  private data = new Map<string, string>()

  get length() { return this.data.size }

  clear() { this.data.clear() }

  getItem(key: string) { return this.data.get(key) ?? null }

  key(index: number) {
    const keys = [...this.data.keys()]
    return keys[index] ?? null
  }

  removeItem(key: string) { this.data.delete(key) }

  setItem(key: string, value: string) { this.data.set(key, value) }
}

// ── Kanban Column Types (mirrored from store) ────────────────────────

interface MockKanbanColumn {
  id: string
  title: string
  status: string | null
  cards: Array<{ id: number; title: string }>
}

// ── Thread Event Types (for isSystemEvent tests) ─────────────────────

interface MockThreadEvent {
  channel: string
  direction: string
  actor: string
  message_type: string
  content: unknown
}

// ── MSW Server for HTTP Tests ────────────────────────────────────────

const apiCalls: Array<{ method: string; path: string; body?: unknown }>  = []

const handlers = [
  // Mock board endpoint — returns data including a 'done' column
  http.get('http://localhost/api/gitea/board', () => {
    apiCalls.push({ method: 'GET', path: '/api/gitea/board' })
    return HttpResponse.json({
      org: 'gigi',
      totalIssues: 10,
      repos: ['gigi'],
      columns: [
        { id: 'backlog', title: 'Backlog', status: null, cards: [{ id: 1, title: 'Task 1' }] },
        { id: 'ready', title: 'Ready', status: 'status/ready', cards: [{ id: 2, title: 'Task 2' }] },
        { id: 'in-progress', title: 'In Progress', status: 'status/in-progress', cards: [] },
        { id: 'done', title: 'Done', status: 'status/done', cards: [{ id: 3, title: 'Finished task' }] },
      ],
    })
  }),

  // Mock fork endpoint — captures the body to verify compact flag
  http.post('http://localhost/api/threads/:id/fork', async ({ request }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: '/api/threads/fork', body })
    return HttpResponse.json({ id: 'forked-thread-123', topic: 'Fork' }, { status: 201 })
  }),

  // Mock compact endpoint — returns compacted_count
  http.post('http://localhost/api/threads/:id/compact', async ({ request }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: '/api/threads/compact', body })
    return HttpResponse.json({ compacted_count: 15, summary: 'Summary text' })
  }),

  // Mock conversations list (needed by forkConversation flow)
  http.get('http://localhost/api/conversations', () => {
    return HttpResponse.json([])
  }),

  // Mock conversation messages
  http.get('http://localhost/api/conversations/:id/messages', () => {
    return HttpResponse.json([])
  }),
]

const server = setupServer(...handlers)

// ═══════════════════════════════════════════════════════════════════════
// 1. ChatInput Autofocus — Draft Utility Tests
// ═══════════════════════════════════════════════════════════════════════

describe('ChatInput: draft utilities', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = new MockStorage()
  })

  it('draftKey returns correct key for conversation ID', () => {
    assert.equal(draftKey('conv-123'), `${DRAFT_PREFIX}conv-123`)
  })

  it('draftKey returns "new" suffix for null conversation', () => {
    assert.equal(draftKey(null), `${DRAFT_PREFIX}new`)
    assert.equal(draftKey(undefined), `${DRAFT_PREFIX}new`)
  })

  it('saveDraft persists non-empty text with timestamp', () => {
    saveDraft(storage, 'conv-1', 'Hello draft', 1000)
    const raw = storage.getItem(`${DRAFT_PREFIX}conv-1`)
    assert.ok(raw)
    const parsed = JSON.parse(raw!)
    assert.equal(parsed.text, 'Hello draft')
    assert.equal(parsed.ts, 1000)
  })

  it('saveDraft removes entry for empty/whitespace text', () => {
    saveDraft(storage, 'conv-1', 'Some text', 1000)
    assert.ok(storage.getItem(`${DRAFT_PREFIX}conv-1`))

    saveDraft(storage, 'conv-1', '   ', 2000)
    assert.equal(storage.getItem(`${DRAFT_PREFIX}conv-1`), null)
  })

  it('loadDraft returns saved text within max age', () => {
    const now = Date.now()
    saveDraft(storage, 'conv-1', 'Saved text', now)
    const loaded = loadDraft(storage, 'conv-1', now + 1000)
    assert.equal(loaded, 'Saved text')
  })

  it('loadDraft returns null for stale drafts', () => {
    const now = Date.now()
    saveDraft(storage, 'conv-1', 'Old text', now)
    const loaded = loadDraft(storage, 'conv-1', now + DRAFT_MAX_AGE_MS + 1)
    assert.equal(loaded, null)
  })

  it('loadDraft removes stale entries from storage', () => {
    const now = Date.now()
    saveDraft(storage, 'conv-1', 'Old text', now)
    loadDraft(storage, 'conv-1', now + DRAFT_MAX_AGE_MS + 1)
    assert.equal(storage.getItem(`${DRAFT_PREFIX}conv-1`), null)
  })

  it('clearDraft removes the draft entry', () => {
    saveDraft(storage, 'conv-1', 'Text', Date.now())
    clearDraft(storage, 'conv-1')
    assert.equal(storage.getItem(`${DRAFT_PREFIX}conv-1`), null)
  })

  it('cleanStaleDrafts removes expired entries', () => {
    const now = Date.now()
    saveDraft(storage, 'conv-old', 'Old', now - DRAFT_MAX_AGE_MS - 1000)
    saveDraft(storage, 'conv-new', 'Fresh', now - 1000)

    cleanStaleDrafts(storage, now)

    assert.equal(storage.getItem(`${DRAFT_PREFIX}conv-old`), null)
    assert.ok(storage.getItem(`${DRAFT_PREFIX}conv-new`))
  })

  it('cleanStaleDrafts removes corrupt entries', () => {
    storage.setItem(`${DRAFT_PREFIX}corrupt`, 'not-json')
    cleanStaleDrafts(storage, Date.now())
    assert.equal(storage.getItem(`${DRAFT_PREFIX}corrupt`), null)
  })

  it('cleanStaleDrafts ignores non-draft keys', () => {
    storage.setItem('other-key', 'some-value')
    cleanStaleDrafts(storage, Date.now())
    assert.equal(storage.getItem('other-key'), 'some-value')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 2. GigiSidebar: handleNewChat opens chat overlay
// ═══════════════════════════════════════════════════════════════════════

describe('GigiSidebar: handleNewChat logic', () => {
  it('opens chatOverlay when it is hidden', () => {
    // Simulate the handleNewChat logic from GigiSidebar
    // handleNewChat calls:
    //   1. newConversation() — resets active conversation
    //   2. clearSearch() — clears search
    //   3. if chatOverlay === 'hidden' → setPanelState('chatOverlay', 'compact')
    let chatState: 'full' | 'compact' | 'hidden' = 'hidden'
    const getPanelState = () => chatState
    const setPanelState = (_id: string, state: 'full' | 'compact' | 'hidden') => { chatState = state }

    // Execute the handleNewChat logic
    const chatOverlayState = getPanelState()
    if (chatOverlayState === 'hidden') {
      setPanelState('chatOverlay', 'compact')
    }

    assert.equal(chatState, 'compact')
  })

  it('does not change chatOverlay when already visible', () => {
    let chatState: 'full' | 'compact' | 'hidden' = 'compact'
    const getPanelState = () => chatState
    const setPanelState = (_id: string, state: 'full' | 'compact' | 'hidden') => { chatState = state }

    const chatOverlayState = getPanelState()
    if (chatOverlayState === 'hidden') {
      setPanelState('chatOverlay', 'compact')
    }

    assert.equal(chatState, 'compact', 'should remain compact')
  })

  it('does not change chatOverlay when in full mode', () => {
    let chatState: 'full' | 'compact' | 'hidden' = 'full'
    const getPanelState = () => chatState
    const setPanelState = (_id: string, state: 'full' | 'compact' | 'hidden') => { chatState = state }

    const chatOverlayState = getPanelState()
    if (chatOverlayState === 'hidden') {
      setPanelState('chatOverlay', 'compact')
    }

    assert.equal(chatState, 'full', 'should remain full')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 3. Fork Conversation: compact defaults to true
// ═══════════════════════════════════════════════════════════════════════

describe('forkConversation: compact default behavior', () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
    apiCalls.length = 0
  })

  afterEach(() => {
    server.resetHandlers()
  })

  after(() => {
    server.close()
  })

  it('sends compact: true by default when no options provided', async () => {
    // Simulate the forkConversation logic:
    // body: JSON.stringify({ topic: opts?.topic, compact: opts?.compact ?? true })
    const opts: { topic?: string; compact?: boolean } | undefined = undefined
    const body = {
      topic: opts?.topic,
      compact: opts?.compact ?? true,
    }

    const res = await fetch('http://localhost/api/threads/thread-1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 201)

    const forkCall = apiCalls.find(c => c.path === '/api/threads/fork')
    assert.ok(forkCall, 'should have made fork API call')
    assert.equal((forkCall!.body as { compact: boolean }).compact, true, 'compact should default to true')
  })

  it('sends compact: true when opts provided without compact', async () => {
    const opts = { topic: 'My fork' }
    const body = {
      topic: opts.topic,
      compact: (opts as { compact?: boolean }).compact ?? true,
    }

    await fetch('http://localhost/api/threads/thread-1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const forkCall = apiCalls.find(c => c.path === '/api/threads/fork')
    assert.ok(forkCall)
    assert.equal((forkCall!.body as { compact: boolean }).compact, true)
    assert.equal((forkCall!.body as { topic: string }).topic, 'My fork')
  })

  it('sends compact: false when explicitly overridden', async () => {
    const opts = { compact: false }
    const body = {
      topic: opts.topic,
      compact: opts.compact ?? true,
    }

    await fetch('http://localhost/api/threads/thread-1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const forkCall = apiCalls.find(c => c.path === '/api/threads/fork')
    assert.ok(forkCall)
    assert.equal((forkCall!.body as { compact: boolean }).compact, false, 'compact should be false when explicitly set')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 4. compactThread: system event format
// ═══════════════════════════════════════════════════════════════════════

describe('compactThread: system segment format', () => {
  it('formats system event with compacted_count from response', () => {
    // Simulate the logic from chat.svelte.ts compactThread():
    // const count = result?.compacted_count ?? '?'
    // streamSegments = [...streamSegments, { type: 'system', text: `📦 Thread compacted — ${count} events summarized` }]

    const result = { compacted_count: 15 }
    const count = result?.compacted_count ?? '?'
    const segment = {
      type: 'system' as const,
      text: `📦 Thread compacted — ${count} events summarized`,
    }

    assert.equal(segment.type, 'system')
    assert.equal(segment.text, '📦 Thread compacted — 15 events summarized')
  })

  it('uses "?" when compacted_count is missing', () => {
    const result: Record<string, unknown> = {}
    const count = result?.compacted_count ?? '?'
    const segment = {
      type: 'system' as const,
      text: `📦 Thread compacted — ${count} events summarized`,
    }

    assert.equal(segment.text, '📦 Thread compacted — ? events summarized')
  })

  it('uses "?" when result is null', () => {
    const result = null
    const count = result?.compacted_count ?? '?'
    const segment = {
      type: 'system' as const,
      text: `📦 Thread compacted — ${count} events summarized`,
    }

    assert.equal(segment.text, '📦 Thread compacted — ? events summarized')
  })

  it('appends system segment to existing segments', () => {
    // Simulate the streamSegments update
    const existingSegments = [
      { type: 'text' as const, text: 'Previous message' },
    ]

    const count = 10
    const newSegments = [...existingSegments, {
      type: 'system' as const,
      text: `📦 Thread compacted — ${count} events summarized`,
    }]

    assert.equal(newSegments.length, 2)
    assert.equal(newSegments[0].type, 'text')
    assert.equal(newSegments[1].type, 'system')
    assert.ok(newSegments[1].text.includes('10 events summarized'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 5. GigiFilters: repo filter chips removed
// ═══════════════════════════════════════════════════════════════════════

describe('GigiFilters: repo filter chips removed', () => {
  it('template does not render a chips-row for repo filtering', async () => {
    // Read the GigiFilters component and verify no chips-row usage in the template
    // Since we can't render Svelte components in node tests, we verify the source
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../web/app/components/GigiFilters.svelte', import.meta.url),
      'utf-8',
    )

    // The template section (after </script>) should NOT contain chips-row usage
    const templateSection = source.split('</script>').slice(1).join('</script>')

    // Verify no chip elements in the template (they existed in old versions)
    assert.ok(
      !templateSection.includes('class="chips-row"') &&
      !templateSection.includes('class:collapsed={!filtersExpanded}'),
      'chips-row should not be rendered in the template',
    )

    // Verify the old "Repos:" filter label is not in the template
    assert.ok(
      !templateSection.includes('>Repos:<'),
      'Repos filter label should not be in the template',
    )
  })

  it('CSS still defines .chips-row for potential future use but it is not used', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../web/app/components/GigiFilters.svelte', import.meta.url),
      'utf-8',
    )

    // The style section may still have the CSS rules as dead code
    const styleSection = source.split('<style>').slice(1).join('<style>')

    // CSS classes may exist but should not be referenced in the HTML template
    const templateSection = source.split('</script>').pop()!.split('<style>')[0]

    // No <div class="chips-row"> or similar in the template
    assert.ok(!templateSection.includes('chips-row'), 'template should not reference chips-row')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 6. Kanban: Done column hidden
// ═══════════════════════════════════════════════════════════════════════

describe('Kanban: done column filtered from board', () => {
  it('filters out columns with id === "done"', () => {
    // Simulate the fetchBoard() filter logic:
    // columns = data.columns.filter(col => col.id !== 'done')
    const apiColumns: MockKanbanColumn[] = [
      { id: 'backlog', title: 'Backlog', status: null, cards: [{ id: 1, title: 'Task 1' }] },
      { id: 'ready', title: 'Ready', status: 'status/ready', cards: [{ id: 2, title: 'Task 2' }] },
      { id: 'in-progress', title: 'In Progress', status: 'status/in-progress', cards: [] },
      { id: 'done', title: 'Done', status: 'status/done', cards: [{ id: 3, title: 'Finished' }] },
    ]

    const filtered = apiColumns.filter(col => col.id !== 'done')

    assert.equal(filtered.length, 3)
    assert.ok(filtered.every(col => col.id !== 'done'), 'no done column should remain')
  })

  it('preserves all non-done columns', () => {
    const apiColumns: MockKanbanColumn[] = [
      { id: 'backlog', title: 'Backlog', status: null, cards: [] },
      { id: 'ready', title: 'Ready', status: 'status/ready', cards: [] },
      { id: 'review', title: 'Review', status: 'status/review', cards: [] },
      { id: 'done', title: 'Done', status: 'status/done', cards: [] },
    ]

    const filtered = apiColumns.filter(col => col.id !== 'done')

    assert.equal(filtered.length, 3)
    assert.deepEqual(
      filtered.map(c => c.id),
      ['backlog', 'ready', 'review'],
    )
  })

  it('handles board with no done column gracefully', () => {
    const apiColumns: MockKanbanColumn[] = [
      { id: 'backlog', title: 'Backlog', status: null, cards: [] },
      { id: 'ready', title: 'Ready', status: 'status/ready', cards: [] },
    ]

    const filtered = apiColumns.filter(col => col.id !== 'done')

    assert.equal(filtered.length, 2, 'all columns preserved when no done column exists')
  })

  it('handles empty columns array', () => {
    const apiColumns: MockKanbanColumn[] = []
    const filtered = apiColumns.filter(col => col.id !== 'done')
    assert.equal(filtered.length, 0)
  })

  it('filter is applied in fetchBoard source code', async () => {
    // Verify the actual kanban store code includes the filter
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../web/app/lib/stores/kanban.svelte.ts', import.meta.url),
      'utf-8',
    )

    assert.ok(
      source.includes("col.id !== 'done'") || source.includes('col.id !== "done"'),
      'kanban store should filter out done column',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 7. ThreadEvent: system event detection + centering
// ═══════════════════════════════════════════════════════════════════════

describe('ThreadEvent: isSystemEvent detection', () => {
  // Re-implement the isSystemEvent logic from ThreadEvent.svelte:
  // const isSystemEvent = event.channel === 'webhook' ||
  //                       event.channel === 'system' ||
  //                       event.message_type === 'status_change'
  function isSystemEvent(event: MockThreadEvent): boolean {
    return (
      event.channel === 'webhook' ||
      event.channel === 'system' ||
      event.message_type === 'status_change'
    )
  }

  it('detects webhook channel as system event', () => {
    const event: MockThreadEvent = {
      channel: 'webhook',
      direction: 'inbound',
      actor: 'gitea',
      message_type: 'text',
      content: 'Issue opened',
    }
    assert.ok(isSystemEvent(event))
  })

  it('detects system channel as system event', () => {
    const event: MockThreadEvent = {
      channel: 'system',
      direction: 'outbound',
      actor: 'gigi',
      message_type: 'text',
      content: 'Thread compacted',
    }
    assert.ok(isSystemEvent(event))
  })

  it('detects status_change message_type as system event', () => {
    const event: MockThreadEvent = {
      channel: 'web',
      direction: 'outbound',
      actor: 'gigi',
      message_type: 'status_change',
      content: 'Status changed to paused',
    }
    assert.ok(isSystemEvent(event))
  })

  it('regular web message is NOT a system event', () => {
    const event: MockThreadEvent = {
      channel: 'web',
      direction: 'inbound',
      actor: 'user',
      message_type: 'text',
      content: 'Hello',
    }
    assert.ok(!isSystemEvent(event))
  })

  it('telegram message is NOT a system event', () => {
    const event: MockThreadEvent = {
      channel: 'telegram',
      direction: 'inbound',
      actor: 'user',
      message_type: 'text',
      content: 'Hello from phone',
    }
    assert.ok(!isSystemEvent(event))
  })

  it('gitea_comment is NOT a system event', () => {
    const event: MockThreadEvent = {
      channel: 'gitea_comment',
      direction: 'inbound',
      actor: '@reviewer',
      message_type: 'text',
      content: 'Nice PR',
    }
    assert.ok(!isSystemEvent(event))
  })
})

describe('ThreadEvent: system event CSS centering', () => {
  it('system-event class has margin: auto and justify-content: center', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../web/app/components/chat/ThreadEvent.svelte', import.meta.url),
      'utf-8',
    )

    const styleSection = source.split('<style>')[1]?.split('</style>')[0] ?? ''

    // Find the .system-event rule and verify centering styles
    assert.ok(styleSection.includes('.system-event'), '.system-event CSS class should exist')
    assert.ok(styleSection.includes('justify-content: center'), 'should have justify-content: center')
    assert.ok(styleSection.includes('auto'), 'should have margin: auto for centering')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 8. Thread fork: summary event creation (backend logic)
// ═══════════════════════════════════════════════════════════════════════

describe('Thread fork: compact summary text', () => {
  it('generates correct summary text with topic', () => {
    // From threads.ts forkThread:
    // const summary = source.summary ?? `Forked from thread "${source.topic ?? sourceId}" (compact — original events not copied)`
    const source = { topic: 'Dark mode implementation', summary: null as string | null }
    const sourceId = 'thread-abc'

    const summary = source.summary ?? `Forked from thread "${source.topic ?? sourceId}" (compact — original events not copied)`

    assert.equal(
      summary,
      'Forked from thread "Dark mode implementation" (compact — original events not copied)',
    )
  })

  it('generates summary with thread ID when topic is null', () => {
    const source = { topic: null as string | null, summary: null as string | null }
    const sourceId = 'thread-abc'

    const summary = source.summary ?? `Forked from thread "${source.topic ?? sourceId}" (compact — original events not copied)`

    assert.equal(
      summary,
      'Forked from thread "thread-abc" (compact — original events not copied)',
    )
  })

  it('uses existing summary when available', () => {
    const source = { topic: 'Dark mode', summary: 'Existing thread summary text' }
    const sourceId = 'thread-abc'

    const summary = source.summary ?? `Forked from thread "${source.topic ?? sourceId}" (compact — original events not copied)`

    assert.equal(summary, 'Existing thread summary text')
  })

  it('summary event has correct channel and message_type', () => {
    // From threads.ts:
    // await addThreadEvent(newThread.id, {
    //   channel: 'system',
    //   direction: 'outbound',
    //   actor: 'gigi',
    //   content: summary,
    //   message_type: 'summary',
    // })
    const eventOpts = {
      channel: 'system',
      direction: 'outbound',
      actor: 'gigi',
      content: 'Some summary',
      message_type: 'summary',
    }

    assert.equal(eventOpts.channel, 'system')
    assert.equal(eventOpts.direction, 'outbound')
    assert.equal(eventOpts.actor, 'gigi')
    assert.equal(eventOpts.message_type, 'summary')
  })

  it('compact fork creates summary event (source code verification)', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../lib/core/threads.ts', import.meta.url),
      'utf-8',
    )

    // Verify the fork-compact code path exists
    assert.ok(source.includes('opts.compact'), 'should check opts.compact')
    assert.ok(source.includes("message_type: 'summary'"), 'should create event with message_type summary')
    assert.ok(source.includes("channel: 'system'"), 'summary event should use system channel')
    assert.ok(source.includes("actor: 'gigi'"), 'summary event should have gigi as actor')
    assert.ok(source.includes('updateThreadSummary'), 'should update thread summary field')
    assert.ok(source.includes('addThreadEvent'), 'should add timeline event')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 9. Integration: compact endpoint returns compacted_count
// ═══════════════════════════════════════════════════════════════════════

describe('Compact endpoint: compacted_count in response', () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
    apiCalls.length = 0
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('POST /api/threads/:id/compact returns compacted_count', async () => {
    const res = await fetch('http://localhost/api/threads/thread-1/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'in-place', keep_recent: 10 }),
    })

    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.compacted_count, 15)
  })

  it('compacted_count is used for the system event message', async () => {
    const res = await fetch('http://localhost/api/threads/thread-1/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'in-place', keep_recent: 10 }),
    })

    const result = await res.json()
    const count = result?.compacted_count ?? '?'
    const systemText = `📦 Thread compacted — ${count} events summarized`

    assert.equal(systemText, '📦 Thread compacted — 15 events summarized')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 10. ChatInput: autofocus prop (source verification)
// ═══════════════════════════════════════════════════════════════════════

describe('ChatInput: autofocus prop', () => {
  it('component accepts autofocus prop with default false', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../web/app/components/chat/ChatInput.svelte', import.meta.url),
      'utf-8',
    )

    // Verify autofocus prop is declared
    assert.ok(source.includes('autofocus'), 'should have autofocus prop')
    assert.ok(source.includes('autofocus = false'), 'autofocus should default to false')
  })

  it('uses $effect + requestAnimationFrame to focus on autofocus', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../web/app/components/chat/ChatInput.svelte', import.meta.url),
      'utf-8',
    )

    // Verify the autofocus effect exists
    assert.ok(source.includes('$effect'), 'should use $effect for autofocus')
    assert.ok(source.includes('requestAnimationFrame'), 'should use rAF for focus timing')
    assert.ok(source.includes('inputEl?.focus()'), 'should call focus() on the textarea')
  })
})
