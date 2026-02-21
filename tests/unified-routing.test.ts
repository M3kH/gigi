/**
 * Unified Thread Routing Tests
 *
 * Tests for the new thread-based routing: ref extraction from webhook payloads,
 * and auto-linking logic for PR/issue creation detection.
 *
 * Pure function tests — no database or network calls.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ── Ref Extraction Logic (mirrors webhookRouter.ts extractRefs) ─────

interface WebhookPayload {
  repository?: { name?: string }
  issue?: { number?: number; pull_request?: unknown }
  pull_request?: { number?: number }
  number?: number
}

interface WebhookRef {
  repo: string
  ref_type: 'issue' | 'pr'
  number: number
}

function extractRefs(event: string, payload: WebhookPayload): WebhookRef[] {
  const refs: WebhookRef[] = []
  const repo = payload.repository?.name
  if (!repo) return refs

  switch (event) {
    case 'issues':
      if (payload.issue?.number) {
        refs.push({ repo, ref_type: 'issue', number: payload.issue.number })
      }
      break
    case 'issue_comment':
      if (payload.issue?.number) {
        if (payload.issue?.pull_request) {
          refs.push({ repo, ref_type: 'pr', number: payload.issue.number })
        } else {
          refs.push({ repo, ref_type: 'issue', number: payload.issue.number })
        }
      }
      break
    case 'pull_request': {
      const prNum = payload.number || payload.pull_request?.number
      if (prNum) {
        refs.push({ repo, ref_type: 'pr', number: prNum })
      }
      break
    }
    case 'pull_request_review_comment':
      if (payload.pull_request?.number) {
        refs.push({ repo, ref_type: 'pr', number: payload.pull_request.number })
      }
      break
  }

  return refs
}

// ── Ref Extraction Tests ────────────────────────────────────────────

describe('extractRefs — issue events', () => {
  it('should extract issue ref for issues event', () => {
    const refs = extractRefs('issues', {
      repository: { name: 'gigi' },
      issue: { number: 42 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'issue', number: 42 }])
  })

  it('should extract issue ref for issue_comment on a plain issue', () => {
    const refs = extractRefs('issue_comment', {
      repository: { name: 'gigi' },
      issue: { number: 7 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'issue', number: 7 }])
  })

  it('should extract PR ref for issue_comment on a PR (Gitea sends PR comments as issue_comment)', () => {
    const refs = extractRefs('issue_comment', {
      repository: { name: 'gigi' },
      issue: { number: 15, pull_request: {} },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 15 }])
  })

  it('should return empty refs when no repository', () => {
    const refs = extractRefs('issues', {
      issue: { number: 42 },
    })
    assert.deepEqual(refs, [])
  })

  it('should return empty refs when no issue number', () => {
    const refs = extractRefs('issues', {
      repository: { name: 'gigi' },
    })
    assert.deepEqual(refs, [])
  })
})

describe('extractRefs — pull request events', () => {
  it('should extract PR ref for pull_request event', () => {
    const refs = extractRefs('pull_request', {
      repository: { name: 'gigi' },
      number: 28,
      pull_request: { number: 28 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 28 }])
  })

  it('should prefer payload.number over pull_request.number', () => {
    const refs = extractRefs('pull_request', {
      repository: { name: 'gigi' },
      number: 10,
      pull_request: { number: 99 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 10 }])
  })

  it('should fall back to pull_request.number', () => {
    const refs = extractRefs('pull_request', {
      repository: { name: 'gigi' },
      pull_request: { number: 15 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 15 }])
  })

  it('should extract PR ref for review comments', () => {
    const refs = extractRefs('pull_request_review_comment', {
      repository: { name: 'website' },
      pull_request: { number: 3 },
    })
    assert.deepEqual(refs, [{ repo: 'website', ref_type: 'pr', number: 3 }])
  })
})

describe('extractRefs — push and other events', () => {
  it('should return empty refs for push events (no issue/PR)', () => {
    const refs = extractRefs('push', {
      repository: { name: 'gigi' },
    })
    assert.deepEqual(refs, [])
  })

  it('should return empty refs for unknown events', () => {
    const refs = extractRefs('repository', {
      repository: { name: 'gigi' },
    })
    assert.deepEqual(refs, [])
  })
})

// ── Auto-link Detection Logic ───────────────────────────────────────

describe('auto-link detection', () => {
  it('should detect PR creation from gitea tool calls', () => {
    const toolCalls = [
      {
        name: 'mcp__gigi-tools__gitea',
        input: { action: 'create_pr', repo: 'gigi', title: 'Fix bug', head: 'fix/bug', base: 'main' },
      },
    ]
    const toolResults: Record<string, string> = {
      'result-1': JSON.stringify({ number: 42, html_url: 'https://example.com/pr/42' }),
    }

    // Simulate the auto-link detection logic
    const linkedRefs: Array<{ ref_type: string; repo: string; number: number }> = []
    for (const tc of toolCalls) {
      if (tc.name === 'mcp__gigi-tools__gitea' && tc.input) {
        if (tc.input.action === 'create_pr' && tc.input.repo) {
          const resultKey = Object.keys(toolResults).find(k =>
            toolResults[k]?.includes('"number"')
          )
          if (resultKey) {
            const result = JSON.parse(toolResults[resultKey])
            if (result.number) {
              linkedRefs.push({ ref_type: 'pr', repo: tc.input.repo as string, number: result.number })
            }
          }
        }
      }
    }

    assert.equal(linkedRefs.length, 1)
    assert.deepEqual(linkedRefs[0], { ref_type: 'pr', repo: 'gigi', number: 42 })
  })

  it('should detect issue creation from gitea tool calls', () => {
    const toolCalls = [
      {
        name: 'mcp__gigi-tools__gitea',
        input: { action: 'create_issue', repo: 'gigi', title: 'Bug: something broken' },
      },
    ]
    const toolResults: Record<string, string> = {
      'result-1': JSON.stringify({ number: 99, html_url: 'https://example.com/issues/99' }),
    }

    const linkedRefs: Array<{ ref_type: string; repo: string; number: number }> = []
    for (const tc of toolCalls) {
      if (tc.name === 'mcp__gigi-tools__gitea' && tc.input) {
        if (tc.input.action === 'create_issue' && tc.input.repo) {
          const resultKey = Object.keys(toolResults).find(k =>
            toolResults[k]?.includes('"number"')
          )
          if (resultKey) {
            const result = JSON.parse(toolResults[resultKey])
            if (result.number) {
              linkedRefs.push({ ref_type: 'issue', repo: tc.input.repo as string, number: result.number })
            }
          }
        }
      }
    }

    assert.equal(linkedRefs.length, 1)
    assert.deepEqual(linkedRefs[0], { ref_type: 'issue', repo: 'gigi', number: 99 })
  })

  it('should not link non-gitea tool calls', () => {
    const toolCalls = [
      { name: 'Bash', input: { command: 'git push' } },
      { name: 'Read', input: { file_path: '/foo' } },
    ]

    const linkedRefs: Array<{ ref_type: string; repo: string; number: number }> = []
    for (const tc of toolCalls) {
      if (tc.name === 'mcp__gigi-tools__gitea') {
        // Would process here
        linkedRefs.push({ ref_type: 'issue', repo: 'test', number: 1 })
      }
    }

    assert.equal(linkedRefs.length, 0)
  })
})
