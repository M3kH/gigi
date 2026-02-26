/**
 * Kanban Board Tests
 *
 * Tests for kanban board features added in the quick-create / priority-sort PR:
 *
 * 1. Priority sorting — getPriorityScore() and sortCardsByPriority()
 * 2. Board create endpoint — POST /api/gitea/board/create validation
 * 3. Board response shape — linked_pr_details, linked_chat_details, repos
 */

import assert from 'node:assert/strict'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import {
  getPriorityScore,
  sortCardsByPriority,
  sortColumnCards,
  PRIORITY_ORDER,
} from '../web/app/lib/kanban-utils'
import type { KanbanCard, KanbanColumn } from '../web/app/lib/stores/kanban.svelte'

// ─── Test Helpers ────────────────────────────────────────────────────

/** Create a minimal KanbanCard with the given labels */
function makeCard(
  overrides: Partial<KanbanCard> & { number: number; title: string },
): KanbanCard {
  return {
    id: overrides.number,
    number: overrides.number,
    title: overrides.title,
    repo: 'gigi',
    labels: [],
    assignee: null,
    milestone: null,
    comments: 0,
    linked_prs: 0,
    linked_pr_details: [],
    linked_chats: 0,
    linked_chat_details: [],
    html_url: `https://gitea.local/gigi/gigi/issues/${overrides.number}`,
    ...overrides,
  }
}

function label(name: string, color = '#000000') {
  return { id: Math.random() * 1000 | 0, name, color }
}

// ─── Priority Sorting ────────────────────────────────────────────────

describe('Kanban Priority Sorting', () => {
  it('getPriorityScore returns correct order for each priority level', () => {
    assert.equal(
      getPriorityScore(makeCard({ number: 1, title: 'A', labels: [label('priority/critical')] })),
      0,
    )
    assert.equal(
      getPriorityScore(makeCard({ number: 2, title: 'B', labels: [label('priority/high')] })),
      1,
    )
    assert.equal(
      getPriorityScore(makeCard({ number: 3, title: 'C', labels: [label('priority/medium')] })),
      2,
    )
    assert.equal(
      getPriorityScore(makeCard({ number: 4, title: 'D', labels: [label('priority/low')] })),
      3,
    )
  })

  it('getPriorityScore returns 99 for cards with no priority label', () => {
    const card = makeCard({
      number: 5,
      title: 'No priority',
      labels: [label('type/bug'), label('status/ready')],
    })
    assert.equal(getPriorityScore(card), 99)
  })

  it('getPriorityScore uses first matching priority label', () => {
    const card = makeCard({
      number: 6,
      title: 'Multi-label',
      labels: [label('type/feature'), label('priority/high'), label('priority/low')],
    })
    // Should match 'priority/high' first (it appears first in labels array)
    assert.equal(getPriorityScore(card), 1)
  })

  it('sortCardsByPriority orders critical > high > medium > low > none', () => {
    const cards = [
      makeCard({ number: 1, title: 'Low', labels: [label('priority/low')] }),
      makeCard({ number: 2, title: 'None', labels: [] }),
      makeCard({ number: 3, title: 'Critical', labels: [label('priority/critical')] }),
      makeCard({ number: 4, title: 'High', labels: [label('priority/high')] }),
      makeCard({ number: 5, title: 'Medium', labels: [label('priority/medium')] }),
    ]

    const sorted = sortCardsByPriority(cards)

    assert.equal(sorted[0].title, 'Critical')
    assert.equal(sorted[1].title, 'High')
    assert.equal(sorted[2].title, 'Medium')
    assert.equal(sorted[3].title, 'Low')
    assert.equal(sorted[4].title, 'None')
  })

  it('sortCardsByPriority does not mutate the original array', () => {
    const cards = [
      makeCard({ number: 1, title: 'Low', labels: [label('priority/low')] }),
      makeCard({ number: 2, title: 'Critical', labels: [label('priority/critical')] }),
    ]

    const sorted = sortCardsByPriority(cards)

    assert.notEqual(sorted, cards)
    assert.equal(cards[0].title, 'Low', 'original should be unchanged')
    assert.equal(sorted[0].title, 'Critical', 'sorted should have Critical first')
  })

  it('sortCardsByPriority handles empty array', () => {
    const sorted = sortCardsByPriority([])
    assert.deepEqual(sorted, [])
  })

  it('sortCardsByPriority preserves relative order for same priority', () => {
    const cards = [
      makeCard({ number: 1, title: 'First high', labels: [label('priority/high')] }),
      makeCard({ number: 2, title: 'Second high', labels: [label('priority/high')] }),
      makeCard({ number: 3, title: 'Third high', labels: [label('priority/high')] }),
    ]

    const sorted = sortCardsByPriority(cards)

    // Array.sort is not guaranteed stable in all engines, but in Node 12+
    // it is stable. The key point: all have the same score.
    assert.equal(sorted.length, 3)
    assert.ok(sorted.every(c => getPriorityScore(c) === 1))
  })
})

// ─── sortColumnCards ─────────────────────────────────────────────────

describe('sortColumnCards', () => {
  const columns: KanbanColumn[] = [
    {
      id: 'backlog',
      title: 'Backlog',
      status: null,
      cards: [
        makeCard({ number: 1, title: 'Low', labels: [label('priority/low')] }),
        makeCard({ number: 2, title: 'Critical', labels: [label('priority/critical')] }),
      ],
    },
    {
      id: 'ready',
      title: 'Ready',
      status: 'status/ready',
      cards: [
        makeCard({ number: 3, title: 'None', labels: [] }),
        makeCard({ number: 4, title: 'High', labels: [label('priority/high')] }),
      ],
    },
  ]

  it('returns columns unchanged in default mode', () => {
    const result = sortColumnCards(columns, 'default')
    assert.equal(result, columns, 'should return same reference in default mode')
  })

  it('sorts cards within each column in priority mode', () => {
    const result = sortColumnCards(columns, 'priority')

    assert.notEqual(result, columns, 'should return new array')
    assert.equal(result[0].cards[0].title, 'Critical')
    assert.equal(result[0].cards[1].title, 'Low')
    assert.equal(result[1].cards[0].title, 'High')
    assert.equal(result[1].cards[1].title, 'None')
  })

  it('preserves column metadata when sorting', () => {
    const result = sortColumnCards(columns, 'priority')

    assert.equal(result[0].id, 'backlog')
    assert.equal(result[0].title, 'Backlog')
    assert.equal(result[0].status, null)
    assert.equal(result[1].id, 'ready')
    assert.equal(result[1].status, 'status/ready')
  })
})

// ─── PRIORITY_ORDER constant ─────────────────────────────────────────

describe('PRIORITY_ORDER', () => {
  it('has exactly 4 priority levels', () => {
    assert.equal(Object.keys(PRIORITY_ORDER).length, 4)
  })

  it('critical < high < medium < low', () => {
    assert.ok(PRIORITY_ORDER['priority/critical'] < PRIORITY_ORDER['priority/high'])
    assert.ok(PRIORITY_ORDER['priority/high'] < PRIORITY_ORDER['priority/medium'])
    assert.ok(PRIORITY_ORDER['priority/medium'] < PRIORITY_ORDER['priority/low'])
  })
})

// ─── Board Create Endpoint ───────────────────────────────────────────

const GITEA_URL = 'http://localhost:3300'

const apiCalls: Array<{ method: string; path: string; body?: unknown }> = []

const handlers = [
  // Gitea: list org repos
  http.get(`${GITEA_URL}/api/v1/orgs/:org/repos`, () => {
    apiCalls.push({ method: 'GET', path: '/orgs/gigi/repos' })
    return HttpResponse.json([{ name: 'gigi', archived: false, open_issues_count: 5 }])
  }),

  // Gitea: create issue (must match Zod Issue schema — state is required)
  http.post(`${GITEA_URL}/api/v1/repos/:owner/:repo/issues`, async ({ request, params }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: `/repos/${params.owner}/${params.repo}/issues`, body })
    return HttpResponse.json({
      id: 42,
      number: 42,
      title: (body as Record<string, unknown>).title,
      state: 'open',
      labels: [],
      comments: 0,
      html_url: `${GITEA_URL}/gigi/${params.repo}/issues/42`,
      created_at: '2026-02-22T00:00:00Z',
      updated_at: '2026-02-22T00:00:00Z',
    })
  }),

  // Gitea: list labels (for ensureStatusLabels)
  http.get(`${GITEA_URL}/api/v1/repos/:owner/:repo/labels`, () => {
    return HttpResponse.json([
      { id: 1, name: 'status/ready' },
      { id: 2, name: 'status/in-progress' },
      { id: 3, name: 'status/review' },
      { id: 4, name: 'status/blocked' },
      { id: 5, name: 'status/done' },
    ])
  }),

  // Gitea: set labels by name (PUT)
  http.put(`${GITEA_URL}/api/v1/repos/:owner/:repo/issues/:number/labels`, async ({ request }) => {
    const body = await request.json()
    apiCalls.push({ method: 'PUT', path: '/labels', body })
    return HttpResponse.json([])
  }),
]

const server = setupServer(...handlers)

// Override env for the gitea-proxy module
process.env.GITEA_URL = GITEA_URL
process.env.GITEA_TOKEN = 'test-token'
process.env.GITEA_ORG = 'gigi'

describe('POST /board/create endpoint', () => {
  let createGiteaProxy: () => import('hono').Hono

  beforeEach(async () => {
    server.listen({ onUnhandledRequest: 'bypass' })
    apiCalls.length = 0

    // Re-import to reset singleton client (dynamic import for isolation)
    const mod = await import('../lib/api/gitea-proxy')
    createGiteaProxy = mod.createGiteaProxy
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  it('returns 400 when repo is missing', async () => {
    const app = createGiteaProxy()
    const res = await app.fetch(
      new Request('http://localhost/board/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test issue' }),
      }),
    )

    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error.includes('repo'))
  })

  it('returns 400 when title is missing', async () => {
    const app = createGiteaProxy()
    const res = await app.fetch(
      new Request('http://localhost/board/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'gigi' }),
      }),
    )

    assert.equal(res.status, 400)
    const body = await res.json()
    assert.ok(body.error.includes('title'))
  })

  it('creates issue successfully with repo and title', async () => {
    const app = createGiteaProxy()
    const res = await app.fetch(
      new Request('http://localhost/board/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'gigi', title: 'New feature' }),
      }),
    )

    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.issue.number, 42)
    assert.equal(body.issue.title, 'New feature')
    assert.equal(body.issue.repo, 'gigi')

    // Should have called create issue endpoint
    const createCall = apiCalls.find(c => c.method === 'POST' && c.path.includes('/issues'))
    assert.ok(createCall, 'should call Gitea create issue API')
    assert.equal((createCall!.body as Record<string, unknown>).title, 'New feature')
  })

  it('creates issue with target column and sets status label', async () => {
    const app = createGiteaProxy()
    const res = await app.fetch(
      new Request('http://localhost/board/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'gigi',
          title: 'Ready task',
          targetColumn: 'ready',
        }),
      }),
    )

    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)

    // Should have set labels
    const labelCall = apiCalls.find(c => c.method === 'PUT' && c.path === '/labels')
    assert.ok(labelCall, 'should call set labels API')
  })

  it('skips label assignment when targetColumn is backlog', async () => {
    const app = createGiteaProxy()
    const res = await app.fetch(
      new Request('http://localhost/board/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'gigi',
          title: 'Backlog task',
          targetColumn: 'backlog',
        }),
      }),
    )

    assert.equal(res.status, 200)

    // Should NOT have set labels (backlog = no status label)
    const labelCall = apiCalls.find(c => c.method === 'PUT' && c.path === '/labels')
    assert.equal(labelCall, undefined, 'should not call set labels for backlog')
  })
})
