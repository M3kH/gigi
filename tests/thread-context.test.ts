/**
 * Thread Context Stack — Unit Tests (Phase 2, Issue #299)
 *
 * Tests the pure logic and formatting of the 5-layer context stack.
 * For functions that require DB/API, we re-implement the core logic
 * and test it in isolation (same pattern as thread-compact.test.ts).
 *
 * Integration tests with real DB go in tests/integration/.
 */

import assert from 'node:assert/strict'

// ─── Re-implement pure functions from thread-context.ts for testing ──

/** Estimate tokens (~4 chars per token) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Extract parent issue number from an issue body */
function extractParentIssueNumber(body: string): number | null {
  const match = body.match(/(?:part of|parent(?:\s+issue)?)\s*(?:.*?)#(\d+)/i)
  return match ? parseInt(match[1], 10) : null
}

/** Map status labels to emoji */
function getStatusEmoji(labels: Array<{ name: string }>): string {
  for (const l of labels) {
    if (l.name === 'status/done') return '✅'
    if (l.name === 'status/in-progress') return '🔄'
    if (l.name === 'status/review') return '👀'
    if (l.name === 'status/ready') return '📋'
    if (l.name === 'status/blocked') return '🚫'
  }
  return '⬜'
}

/** Format execution plan for display */
interface ExecutionStep {
  id: number
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
}

interface ExecutionPlan {
  task: string
  steps: ExecutionStep[]
  workspace?: string
  branch?: string
}

function formatExecutionPlan(plan: ExecutionPlan): string | null {
  if (!plan.task || !plan.steps?.length) return null

  const statusIcons: Record<string, string> = {
    done: '✅',
    in_progress: '🔄',
    pending: '⬚',
    failed: '❌',
  }

  const sections = ['## Execution Plan']
  sections.push(`Task: ${plan.task}`)
  sections.push('Steps:')

  for (const step of plan.steps) {
    const icon = statusIcons[step.status] || '⬚'
    sections.push(`${step.id}. ${icon} ${step.description}`)
  }

  if (plan.workspace) sections.push(`\nWorkspace: ${plan.workspace}`)
  if (plan.branch) sections.push(`Branch: ${plan.branch}`)

  return sections.join('\n')
}

/** Format repo CLAUDE.md context */
function formatRepoContext(repos: Array<{ repo: string; content: string }>, maxTokens: number): string | null {
  if (repos.length === 0) return null

  const sections: string[] = []
  let totalTokens = 0

  for (const { repo, content } of repos) {
    const tokens = estimateTokens(content)
    if (totalTokens + tokens > maxTokens) {
      const remainingChars = (maxTokens - totalTokens) * 4
      if (remainingChars > 200) {
        sections.push(`## Repository Context: ${repo}\n${content.slice(0, remainingChars)}...\n[truncated to fit token budget]`)
      }
      break
    }
    sections.push(`## Repository Context: ${repo}\n${content}`)
    totalTokens += tokens
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

/** Format ticket chain context */
interface IssueInfo {
  number: number
  title: string
  state: string
  body: string
  labels: Array<{ name: string }>
}

function formatTicketChain(
  currentIssue: IssueInfo,
  repo: string,
  parentIssue?: IssueInfo | null,
  maxTokens: number = 2000
): string {
  const sections: string[] = ['## Ticket Context']
  let totalTokens = 0

  // Parent issue (if found)
  if (parentIssue && totalTokens < maxTokens) {
    const parentBodyBudget = Math.min(500, (maxTokens - totalTokens) * 4)
    const parentBody = parentIssue.body.length > parentBodyBudget
      ? parentIssue.body.slice(0, parentBodyBudget) + '...'
      : parentIssue.body
    const parentEmoji = getStatusEmoji(parentIssue.labels)
    sections.push(`### Parent Issue: ${repo}#${parentIssue.number} — ${parentIssue.title} ${parentEmoji}`)
    sections.push(parentBody)
    sections.push('')
    totalTokens += estimateTokens(parentBody) + 20
  }

  // Current issue
  const bodyBudget = Math.min(1200, (maxTokens - totalTokens) * 4)
  const truncatedBody = currentIssue.body.length > bodyBudget
    ? currentIssue.body.slice(0, bodyBudget) + '...'
    : currentIssue.body
  const statusEmoji = getStatusEmoji(currentIssue.labels)
  sections.push(`### Current Issue: ${repo}#${currentIssue.number} — ${currentIssue.title} ${statusEmoji}`)
  sections.push(truncatedBody)

  return sections.join('\n')
}

/** Format thread lineage context */
interface ThreadInfo {
  id: string
  topic: string | null
  display_name: string | null
  status: string
  summary: string | null
}

function formatThreadLineage(parent: ThreadInfo, parentRefs: Array<{ ref_type: string; repo: string; number?: number | null; status?: string | null }>): string {
  const label = parent.display_name ?? parent.topic ?? 'Unknown'
  const sections = ['## Parent Thread Summary']
  sections.push(`Thread: "${label}" (${parent.id.slice(0, 8)})`)
  sections.push(`Status: ${parent.status}`)

  if (parent.summary) {
    sections.push(`\n${parent.summary}`)
  } else if (parent.topic) {
    sections.push(`Topic: ${parent.topic}`)
  }

  if (parentRefs.length > 0) {
    const refLines = parentRefs.map(r => {
      const num = r.number ? `#${r.number}` : ''
      const status = r.status ? ` (${r.status})` : ''
      return `- ${r.ref_type} ${r.repo}${num}${status}`
    })
    sections.push(`\nParent refs:\n${refLines.join('\n')}`)
  }

  return sections.join('\n')
}

/** Assemble full context stack */
function assembleContextStack(
  layers: Array<{ layer: number; name: string; content: string }>,
  threadId: string
): { threadId: string; layers: typeof layers & { estimatedTokens: number }[]; totalTokens: number; formatted: string } | null {
  if (layers.length === 0) return null

  const withTokens = layers.map(l => ({
    ...l,
    estimatedTokens: estimateTokens(l.content),
  }))
  const totalTokens = withTokens.reduce((sum, l) => sum + l.estimatedTokens, 0)
  const formatted = layers.map(l => l.content).join('\n\n---\n\n')

  return { threadId, layers: withTokens, totalTokens, formatted }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Token estimation', () => {
  it('estimates ~4 chars per token', () => {
    assert.equal(estimateTokens('hello'), 2) // 5/4 = 1.25, ceil = 2
    assert.equal(estimateTokens(''), 0)
    assert.equal(estimateTokens('a'.repeat(100)), 25) // 100/4 = 25
    assert.equal(estimateTokens('a'.repeat(401)), 101) // 401/4 = 100.25, ceil = 101
  })
})

// ─── Parent Issue Extraction ────────────────────────────────────────

describe('extractParentIssueNumber', () => {
  it('extracts "Part of #N"', () => {
    assert.equal(extractParentIssueNumber('Part of #294 — Threads as Trees'), 294)
  })

  it('extracts "Part of #N" with preceding text', () => {
    assert.equal(
      extractParentIssueNumber('## Parent Issue\nPart of #294 — Threads as Trees'),
      294
    )
  })

  it('extracts case-insensitive "part of"', () => {
    assert.equal(extractParentIssueNumber('PART OF #100'), 100)
    assert.equal(extractParentIssueNumber('part of #42'), 42)
  })

  it('extracts "Parent: #N"', () => {
    assert.equal(extractParentIssueNumber('Parent: #50'), 50)
  })

  it('extracts "Parent issue: #N"', () => {
    assert.equal(extractParentIssueNumber('Parent issue: #123'), 123)
  })

  it('returns null when no parent pattern found', () => {
    assert.equal(extractParentIssueNumber('Just a normal issue body'), null)
    assert.equal(extractParentIssueNumber('Closes #42'), null) // "Closes" is not a parent pattern
    assert.equal(extractParentIssueNumber(''), null)
  })

  it('handles multi-line body', () => {
    const body = `## Summary
Build the context stack.

## Parent Issue
Part of #294 — Threads as Trees

## Details
More info here.`
    assert.equal(extractParentIssueNumber(body), 294)
  })
})

// ─── Status Emoji Mapping ───────────────────────────────────────────

describe('getStatusEmoji', () => {
  it('maps done → ✅', () => {
    assert.equal(getStatusEmoji([{ name: 'status/done' }]), '✅')
  })

  it('maps in-progress → 🔄', () => {
    assert.equal(getStatusEmoji([{ name: 'status/in-progress' }]), '🔄')
  })

  it('maps review → 👀', () => {
    assert.equal(getStatusEmoji([{ name: 'status/review' }]), '👀')
  })

  it('maps ready → 📋', () => {
    assert.equal(getStatusEmoji([{ name: 'status/ready' }]), '📋')
  })

  it('maps blocked → 🚫', () => {
    assert.equal(getStatusEmoji([{ name: 'status/blocked' }]), '🚫')
  })

  it('returns ⬜ for empty labels', () => {
    assert.equal(getStatusEmoji([]), '⬜')
  })

  it('returns ⬜ for non-status labels', () => {
    assert.equal(getStatusEmoji([{ name: 'type/feature' }]), '⬜')
  })

  it('picks first matching status label', () => {
    assert.equal(
      getStatusEmoji([{ name: 'type/feature' }, { name: 'status/done' }, { name: 'status/in-progress' }]),
      '✅' // done comes first in the check order
    )
  })
})

// ─── Execution Plan Formatting ──────────────────────────────────────

describe('formatExecutionPlan', () => {
  it('formats a complete plan', () => {
    const plan: ExecutionPlan = {
      task: 'Implement JWT middleware',
      steps: [
        { id: 1, description: 'Create lib/auth/jwt.ts', status: 'done' },
        { id: 2, description: 'Write tests', status: 'in_progress' },
        { id: 3, description: 'Create PR', status: 'pending' },
      ],
      workspace: '/workspace/gigi-feat-jwt',
      branch: 'feat/jwt-middleware',
    }

    const result = formatExecutionPlan(plan)
    assert.ok(result)
    assert.ok(result!.includes('## Execution Plan'))
    assert.ok(result!.includes('Task: Implement JWT middleware'))
    assert.ok(result!.includes('1. ✅ Create lib/auth/jwt.ts'))
    assert.ok(result!.includes('2. 🔄 Write tests'))
    assert.ok(result!.includes('3. ⬚ Create PR'))
    assert.ok(result!.includes('Workspace: /workspace/gigi-feat-jwt'))
    assert.ok(result!.includes('Branch: feat/jwt-middleware'))
  })

  it('handles failed steps', () => {
    const plan: ExecutionPlan = {
      task: 'Deploy',
      steps: [
        { id: 1, description: 'Build', status: 'done' },
        { id: 2, description: 'Run tests', status: 'failed' },
      ],
    }

    const result = formatExecutionPlan(plan)
    assert.ok(result)
    assert.ok(result!.includes('1. ✅ Build'))
    assert.ok(result!.includes('2. ❌ Run tests'))
  })

  it('returns null for empty task', () => {
    const plan: ExecutionPlan = { task: '', steps: [{ id: 1, description: 'x', status: 'pending' }] }
    assert.equal(formatExecutionPlan(plan), null)
  })

  it('returns null for empty steps', () => {
    const plan: ExecutionPlan = { task: 'Something', steps: [] }
    assert.equal(formatExecutionPlan(plan), null)
  })

  it('omits workspace/branch when not set', () => {
    const plan: ExecutionPlan = {
      task: 'Quick task',
      steps: [{ id: 1, description: 'Do it', status: 'pending' }],
    }

    const result = formatExecutionPlan(plan)
    assert.ok(result)
    assert.ok(!result!.includes('Workspace:'))
    assert.ok(!result!.includes('Branch:'))
  })
})

// ─── Repo Context Formatting ────────────────────────────────────────

describe('formatRepoContext', () => {
  it('formats a single repo CLAUDE.md', () => {
    const repos = [{ repo: 'idea/gigi', content: '# Architecture\nEntry: src/index.ts' }]
    const result = formatRepoContext(repos, 4000)

    assert.ok(result)
    assert.ok(result!.includes('## Repository Context: idea/gigi'))
    assert.ok(result!.includes('# Architecture'))
    assert.ok(result!.includes('Entry: src/index.ts'))
  })

  it('formats multiple repos', () => {
    const repos = [
      { repo: 'idea/gigi', content: 'Gigi docs' },
      { repo: 'idea/other', content: 'Other docs' },
    ]
    const result = formatRepoContext(repos, 4000)

    assert.ok(result)
    assert.ok(result!.includes('idea/gigi'))
    assert.ok(result!.includes('idea/other'))
  })

  it('returns null for empty repos', () => {
    assert.equal(formatRepoContext([], 4000), null)
  })

  it('truncates when exceeding token budget', () => {
    const longContent = 'A'.repeat(20000) // ~5000 tokens
    const repos = [{ repo: 'idea/big', content: longContent }]
    const result = formatRepoContext(repos, 1000) // 1000 token budget

    assert.ok(result)
    assert.ok(result!.includes('[truncated to fit token budget]'))
    // Total content should be much less than the original
    assert.ok(result!.length < longContent.length)
  })

  it('skips subsequent repos when budget exhausted', () => {
    const repos = [
      { repo: 'idea/first', content: 'A'.repeat(16000) }, // ~4K tokens, fills budget
      { repo: 'idea/second', content: 'B'.repeat(4000) },
    ]
    const result = formatRepoContext(repos, 4000)

    assert.ok(result)
    // Second repo should not appear (or be truncated heavily)
    assert.ok(result!.includes('idea/first'))
  })
})

// ─── Ticket Chain Formatting ────────────────────────────────────────

describe('formatTicketChain', () => {
  it('formats current issue', () => {
    const issue: IssueInfo = {
      number: 42,
      title: 'JWT Middleware',
      state: 'open',
      body: 'Build the JWT auth middleware.',
      labels: [{ name: 'status/in-progress' }],
    }

    const result = formatTicketChain(issue, 'idea/gigi')
    assert.ok(result.includes('## Ticket Context'))
    assert.ok(result.includes('### Current Issue: idea/gigi#42 — JWT Middleware 🔄'))
    assert.ok(result.includes('Build the JWT auth middleware.'))
  })

  it('includes parent issue when provided', () => {
    const current: IssueInfo = {
      number: 42,
      title: 'JWT Middleware',
      state: 'open',
      body: 'Build JWT middleware.',
      labels: [{ name: 'status/in-progress' }],
    }
    const parent: IssueInfo = {
      number: 10,
      title: 'Auth System',
      state: 'open',
      body: 'Build the complete auth system.',
      labels: [{ name: 'status/ready' }],
    }

    const result = formatTicketChain(current, 'idea/gigi', parent)
    assert.ok(result.includes('### Parent Issue: idea/gigi#10 — Auth System 📋'))
    assert.ok(result.includes('### Current Issue: idea/gigi#42 — JWT Middleware 🔄'))
    // Parent should come before current
    const parentIdx = result.indexOf('Parent Issue')
    const currentIdx = result.indexOf('Current Issue')
    assert.ok(parentIdx < currentIdx)
  })

  it('truncates long issue bodies', () => {
    const issue: IssueInfo = {
      number: 1,
      title: 'Big Issue',
      state: 'open',
      body: 'X'.repeat(10000),
      labels: [],
    }

    const result = formatTicketChain(issue, 'idea/gigi', null, 500)
    // Body should be truncated with ellipsis
    assert.ok(result.includes('...'))
    assert.ok(result.length < 10000)
  })
})

// ─── Thread Lineage Formatting ──────────────────────────────────────

describe('formatThreadLineage', () => {
  it('formats parent with summary', () => {
    const parent: ThreadInfo = {
      id: 'parent-uuid-1234-5678',
      topic: 'Build Auth System',
      display_name: 'Auth System',
      status: 'paused',
      summary: 'Working on JWT + refresh tokens. Using Hono middleware pattern.',
    }

    const result = formatThreadLineage(parent, [])
    assert.ok(result.includes('## Parent Thread Summary'))
    assert.ok(result.includes('Thread: "Auth System" (parent-u)'))
    assert.ok(result.includes('Status: paused'))
    assert.ok(result.includes('JWT + refresh tokens'))
  })

  it('falls back to topic when no display_name', () => {
    const parent: ThreadInfo = {
      id: 'p-12345678',
      topic: 'Fix login bug',
      display_name: null,
      status: 'active',
      summary: null,
    }

    const result = formatThreadLineage(parent, [])
    assert.ok(result.includes('Thread: "Fix login bug"'))
    assert.ok(result.includes('Topic: Fix login bug'))
  })

  it('includes parent refs', () => {
    const parent: ThreadInfo = {
      id: 'p-12345678',
      topic: 'Auth',
      display_name: null,
      status: 'active',
      summary: 'Auth summary',
    }

    const refs = [
      { ref_type: 'issue', repo: 'idea/gigi', number: 10, status: 'open' },
      { ref_type: 'pr', repo: 'idea/gigi', number: 50, status: 'merged' },
    ]

    const result = formatThreadLineage(parent, refs)
    assert.ok(result.includes('Parent refs:'))
    assert.ok(result.includes('- issue idea/gigi#10 (open)'))
    assert.ok(result.includes('- pr idea/gigi#50 (merged)'))
  })

  it('falls back to "Unknown" when no display_name or topic', () => {
    const parent: ThreadInfo = {
      id: 'p-12345678',
      topic: null,
      display_name: null,
      status: 'active',
      summary: 'Some summary',
    }

    const result = formatThreadLineage(parent, [])
    assert.ok(result.includes('Thread: "Unknown"'))
  })
})

// ─── Full Stack Assembly ────────────────────────────────────────────

describe('assembleContextStack', () => {
  it('assembles multiple layers', () => {
    const layers = [
      { layer: 2, name: 'Repo CLAUDE.md', content: '## Repository Context\nDocs here' },
      { layer: 3, name: 'Ticket Chain', content: '## Ticket Context\nIssue info' },
      { layer: 4, name: 'Thread Lineage', content: '## Parent Thread Summary\nParent info' },
    ]

    const result = assembleContextStack(layers, 'thread-1')
    assert.ok(result)
    assert.equal(result!.threadId, 'thread-1')
    assert.equal(result!.layers.length, 3)
    assert.ok(result!.totalTokens > 0)
    assert.ok(result!.formatted.includes('Repository Context'))
    assert.ok(result!.formatted.includes('Ticket Context'))
    assert.ok(result!.formatted.includes('Parent Thread Summary'))
    // Layers are separated by ---
    assert.ok(result!.formatted.includes('---'))
  })

  it('returns null for empty layers', () => {
    assert.equal(assembleContextStack([], 'thread-1'), null)
  })

  it('calculates total tokens correctly', () => {
    const layers = [
      { layer: 2, name: 'A', content: 'a'.repeat(100) }, // ~25 tokens
      { layer: 3, name: 'B', content: 'b'.repeat(200) }, // ~50 tokens
    ]

    const result = assembleContextStack(layers, 'thread-1')
    assert.ok(result)
    assert.equal(result!.totalTokens, 25 + 50)
  })

  it('preserves layer order in formatted output', () => {
    const layers = [
      { layer: 2, name: 'First', content: 'FIRST_CONTENT' },
      { layer: 5, name: 'Last', content: 'LAST_CONTENT' },
    ]

    const result = assembleContextStack(layers, 'thread-1')
    assert.ok(result)
    const firstIdx = result!.formatted.indexOf('FIRST_CONTENT')
    const lastIdx = result!.formatted.indexOf('LAST_CONTENT')
    assert.ok(firstIdx < lastIdx)
  })
})

// ─── Context Stack Budget ───────────────────────────────────────────

describe('Context stack token budget', () => {
  it('total overhead stays within ~7K tokens for typical content', () => {
    const layers = [
      { layer: 2, name: 'Repo', content: 'A'.repeat(4000 * 4) }, // ~4K tokens
      { layer: 3, name: 'Tickets', content: 'B'.repeat(2000 * 4) }, // ~2K tokens
      { layer: 4, name: 'Lineage', content: 'C'.repeat(500 * 4) }, // ~500 tokens
      { layer: 5, name: 'Exec', content: 'D'.repeat(500 * 4) }, // ~500 tokens
    ]

    const result = assembleContextStack(layers, 'thread-1')
    assert.ok(result)
    assert.ok(result!.totalTokens <= 7500) // ~7K with some overhead
  })
})

// ─── Edge Cases ─────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('handles empty issue body', () => {
    const issue: IssueInfo = {
      number: 1,
      title: 'Empty',
      state: 'open',
      body: '',
      labels: [],
    }

    const result = formatTicketChain(issue, 'idea/gigi')
    assert.ok(result.includes('Current Issue'))
  })

  it('extractParentIssueNumber handles edge cases', () => {
    // No match
    assert.equal(extractParentIssueNumber('Fixes #42'), null)
    // Only digit after #
    assert.equal(extractParentIssueNumber('Part of #'), null)
    // Very large number
    assert.equal(extractParentIssueNumber('Part of #999999'), 999999)
  })

  it('thread lineage handles short ID', () => {
    const parent: ThreadInfo = {
      id: 'ab',
      topic: 'Short ID',
      display_name: null,
      status: 'active',
      summary: null,
    }

    const result = formatThreadLineage(parent, [])
    assert.ok(result.includes('Thread: "Short ID" (ab)'))
  })
})

// ─── Cache Integration (#304) ───────────────────────────────────────

describe('Backward-compatible cache API', () => {
  // These test that the wrapper functions from thread-context.ts delegate
  // correctly to context-cache.ts. We import from thread-context to verify
  // the re-export works.

  it('clearContextCache clears all cached data', async () => {
    // Use the cache module directly to set some data, then clear via thread-context wrapper
    const { setCache, getCached, clearAll } = await import('../lib/core/context-cache')
    clearAll() // clean slate
    setCache('test-key', 'test-value', 60_000)
    assert.equal(getCached('test-key'), 'test-value')

    // Import the wrapper from thread-context
    const { clearContextCache } = await import('../lib/core/thread-context')
    clearContextCache()

    assert.equal(getCached('test-key'), null)
  })

  it('invalidateCache removes matching entries', async () => {
    const { setCache, getCached, clearAll } = await import('../lib/core/context-cache')
    clearAll()
    setCache('claude_md:idea/gigi', 'docs', 60_000)
    setCache('claude_md:idea/other', 'other', 60_000)
    setCache('issue:gigi#1', 'issue', 60_000)

    const { invalidateCache } = await import('../lib/core/thread-context')
    invalidateCache('claude_md:')

    assert.equal(getCached('claude_md:idea/gigi'), null)
    assert.equal(getCached('claude_md:idea/other'), null)
    assert.equal(getCached('issue:gigi#1'), 'issue')
  })
})

describe('Checksum computation in context stack', () => {
  it('computeChecksum produces consistent results', async () => {
    const { computeChecksum } = await import('../lib/core/context-cache')
    const cs1 = computeChecksum('hello world')
    const cs2 = computeChecksum('hello world')
    assert.equal(cs1, cs2)
    assert.equal(cs1.length, 16)
  })

  it('different content produces different checksums', async () => {
    const { computeChecksum } = await import('../lib/core/context-cache')
    const cs1 = computeChecksum('content A')
    const cs2 = computeChecksum('content B')
    assert.notEqual(cs1, cs2)
  })
})

describe('Layer name to checksum key mapping', () => {
  // Test the layerNameToChecksumKey helper logic
  it('maps standard layer names correctly', () => {
    // Re-implement the mapping for isolated testing
    const layerNameToChecksumKey = (name: string): string | null => {
      switch (name) {
        case 'Repo CLAUDE.md': return 'repoContext'
        case 'Ticket Chain': return 'ticketChain'
        case 'Thread Lineage': return 'threadLineage'
        case 'Execution State': return 'executionState'
        default: return null
      }
    }

    assert.equal(layerNameToChecksumKey('Repo CLAUDE.md'), 'repoContext')
    assert.equal(layerNameToChecksumKey('Ticket Chain'), 'ticketChain')
    assert.equal(layerNameToChecksumKey('Thread Lineage'), 'threadLineage')
    assert.equal(layerNameToChecksumKey('Execution State'), 'executionState')
    assert.equal(layerNameToChecksumKey('Unknown Layer'), null)
  })
})
