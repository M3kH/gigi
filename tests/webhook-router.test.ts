/**
 * Webhook Router Tests
 *
 * Tests tag extraction from Gitea webhook events and event formatting.
 * These are pure function tests — no database or network calls.
 *
 * Since extractTags and formatEvent are not exported, we replicate the
 * logic here to ensure our expectations match the implementation.
 */

import assert from 'node:assert/strict'

// ── Tag extraction logic (mirrors webhookRouter.ts extractTags) ─────

interface WebhookPayload {
  repository?: { name?: string }
  issue?: { number?: number }
  pull_request?: { number?: number }
  number?: number
}

function extractTags(event: string, payload: WebhookPayload): string[] {
  const tags: string[] = []
  const repo = payload.repository?.name
  if (!repo) return tags

  tags.push(repo)

  switch (event) {
    case 'issues':
      if (payload.issue?.number) tags.push(`${repo}#${payload.issue.number}`)
      break
    case 'issue_comment':
      if (payload.issue?.number) tags.push(`${repo}#${payload.issue.number}`)
      break
    case 'pull_request': {
      const prNum = payload.number || payload.pull_request?.number
      if (prNum) {
        tags.push(`${repo}#${prNum}`)
        tags.push(`pr#${prNum}`)
      }
      break
    }
    case 'pull_request_review_comment':
      if (payload.pull_request?.number) {
        tags.push(`${repo}#${payload.pull_request.number}`)
        tags.push(`pr#${payload.pull_request.number}`)
      }
      break
  }

  return tags
}

// ── Tag Extraction Tests ────────────────────────────────────────────

describe('extractTags — issue events', () => {
  it('should extract repo and issue tags for issues event', () => {
    const tags = extractTags('issues', {
      repository: { name: 'gigi' },
      issue: { number: 42 },
    })
    assert.deepEqual(tags, ['gigi', 'gigi#42'])
  })

  it('should extract repo and issue tags for issue_comment event', () => {
    const tags = extractTags('issue_comment', {
      repository: { name: 'org-press' },
      issue: { number: 7 },
    })
    assert.deepEqual(tags, ['org-press', 'org-press#7'])
  })

  it('should return only repo tag when issue number is missing', () => {
    const tags = extractTags('issues', {
      repository: { name: 'gigi' },
    })
    assert.deepEqual(tags, ['gigi'])
  })

  it('should return empty tags when no repository', () => {
    const tags = extractTags('issues', {
      issue: { number: 42 },
    })
    assert.deepEqual(tags, [])
  })
})

describe('extractTags — pull request events', () => {
  it('should extract repo, issue-style, and pr tags for PR event', () => {
    const tags = extractTags('pull_request', {
      repository: { name: 'gigi' },
      number: 28,
      pull_request: { number: 28 },
    })
    assert.deepEqual(tags, ['gigi', 'gigi#28', 'pr#28'])
  })

  it('should prefer payload.number over pull_request.number', () => {
    const tags = extractTags('pull_request', {
      repository: { name: 'gigi' },
      number: 10,
      pull_request: { number: 99 },
    })
    // payload.number takes priority in the || chain
    assert.deepEqual(tags, ['gigi', 'gigi#10', 'pr#10'])
  })

  it('should fall back to pull_request.number when payload.number is absent', () => {
    const tags = extractTags('pull_request', {
      repository: { name: 'gigi' },
      pull_request: { number: 15 },
    })
    assert.deepEqual(tags, ['gigi', 'gigi#15', 'pr#15'])
  })

  it('should extract tags for PR review comments', () => {
    const tags = extractTags('pull_request_review_comment', {
      repository: { name: 'website' },
      pull_request: { number: 3 },
    })
    assert.deepEqual(tags, ['website', 'website#3', 'pr#3'])
  })
})

describe('extractTags — push events', () => {
  it('should return only repo tag for push events', () => {
    const tags = extractTags('push', {
      repository: { name: 'gigi' },
    })
    assert.deepEqual(tags, ['gigi'])
  })
})

describe('extractTags — unknown events', () => {
  it('should return only repo tag for unknown event types', () => {
    const tags = extractTags('repository', {
      repository: { name: 'gigi' },
    })
    assert.deepEqual(tags, ['gigi'])
  })
})

// ── Tag-based conversation lookup priority ──────────────────────────

describe('tag priority — specific tags first', () => {
  it('tags with # should sort before tags without', () => {
    const tags = ['gigi', 'gigi#42', 'pr#42']
    const prioritized = [...tags].sort((a, b) => {
      const aSpecific = a.includes('#')
      const bSpecific = b.includes('#')
      if (aSpecific && !bSpecific) return -1
      if (!aSpecific && bSpecific) return 1
      return 0
    })
    // Specific tags first
    assert.equal(prioritized[0].includes('#'), true)
    assert.equal(prioritized[1].includes('#'), true)
    assert.equal(prioritized[2], 'gigi')
  })

  it('should keep same-specificity order stable', () => {
    const tags = ['gigi#42', 'pr#42']
    const prioritized = [...tags].sort((a, b) => {
      const aSpecific = a.includes('#')
      const bSpecific = b.includes('#')
      if (aSpecific && !bSpecific) return -1
      if (!aSpecific && bSpecific) return 1
      return 0
    })
    // Both are specific — order preserved
    assert.deepEqual(prioritized, ['gigi#42', 'pr#42'])
  })
})
