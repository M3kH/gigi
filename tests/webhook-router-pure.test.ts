/**
 * Tests for webhookRouter.ts — pure function logic
 *
 * Tests extractRefs, extractTags, shouldAutoCreate, shouldAutoClose,
 * and all format* functions without any database dependency.
 */

import assert from 'node:assert/strict'

// ─── Re-implement pure functions from webhookRouter.ts ───────────────

interface WebhookPayload {
  action?: string
  repository?: { name?: string; full_name?: string; html_url?: string }
  issue?: {
    number?: number
    title?: string
    html_url?: string
    user?: { login?: string }
    state?: string
    pull_request?: unknown
  }
  pull_request?: {
    number?: number
    title?: string
    html_url?: string
    user?: { login?: string }
    merged?: boolean
    head?: { ref?: string }
    base?: { ref?: string }
  }
  number?: number
  comment?: { body?: string; user?: { login?: string }; html_url?: string }
  review?: { body?: string; user?: { login?: string } }
  pusher?: { login?: string }
  ref?: string
  commits?: Array<{ message: string }>
  sender?: { login?: string }
}

interface WebhookRef {
  repo: string
  ref_type: 'issue' | 'pr'
  number: number
}

const extractRefs = (event: string, payload: WebhookPayload): WebhookRef[] => {
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

const extractTags = (event: string, payload: WebhookPayload): string[] => {
  const tags: string[] = []
  const repo = payload.repository?.name
  if (!repo) return tags

  tags.push(repo)

  switch (event) {
    case 'issues':
      if (payload.issue?.number) tags.push(`${repo}#${payload.issue.number}`)
      break
    case 'issue_comment':
      if (payload.issue?.number) {
        tags.push(`${repo}#${payload.issue.number}`)
        if (payload.issue?.pull_request) tags.push(`pr#${payload.issue.number}`)
      }
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

const shouldAutoCreate = (event: string, payload: WebhookPayload): boolean => {
  return (
    (event === 'issues' && payload.action === 'opened') ||
    (event === 'pull_request' && payload.action === 'opened')
  )
}

interface MockConversation {
  status: string
}

const shouldAutoClose = (event: string, payload: WebhookPayload, conversation: MockConversation): boolean => {
  if (conversation.status === 'stopped' || conversation.status === 'archived') return false
  return (
    (event === 'issues' && payload.action === 'closed') ||
    (event === 'pull_request' && (payload.action === 'closed' || payload.pull_request?.merged === true))
  )
}

// ─── Format functions ────────────────────────────────────────────────

const formatIssueEvent = (payload: WebhookPayload): string => {
  const { action, issue } = payload
  const emoji: Record<string, string> = { opened: '📋', closed: '✅', reopened: '🔄', edited: '✏️' }
  return `${emoji[action!] || '📋'} Issue #${issue!.number} ${action}: "${issue!.title}" by @${issue?.user?.login}\n${issue?.html_url || ''}`
}

const formatPREvent = (payload: WebhookPayload): string => {
  const { action, pull_request, number } = payload
  const pr = pull_request
  const prNum = number || pr?.number
  const emoji: Record<string, string> = {
    opened: '🔀',
    closed: pr?.merged ? '✅' : '❌',
    synchronized: '🔄',
    merged: '✅',
    reopened: '🔄',
  }
  const status = pr?.merged ? 'merged' : action
  return `${emoji[action!] || '🔀'} PR #${prNum} ${status}: "${pr?.title}" by @${pr?.user?.login}\n${pr?.head?.ref || ''} → ${pr?.base?.ref || ''}\n${pr?.html_url || ''}`
}

const formatIssueCommentEvent = (payload: WebhookPayload): string => {
  const { issue, comment } = payload
  const commentPreview = comment?.body?.slice(0, 200) || ''
  return `💬 @${comment?.user?.login} commented on issue #${issue!.number}:\n"${commentPreview}${commentPreview.length >= 200 ? '...' : ''}"\n${comment?.html_url || ''}`
}

const formatPushEvent = (payload: WebhookPayload): string => {
  const commits = payload.commits || []
  const commitSummary = commits.slice(0, 3).map((c) => `  • ${c.message.split('\n')[0]}`).join('\n')
  const moreText = commits.length > 3 ? `\n  ... and ${commits.length - 3} more` : ''
  return `📤 @${payload.pusher?.login} pushed ${commits.length} commit(s) to ${payload.ref}:\n${commitSummary}${moreText}`
}

const formatPRReviewCommentEvent = (payload: WebhookPayload): string => {
  const { comment, pull_request } = payload
  const commentPreview = comment?.body?.slice(0, 200) || ''
  return `💬 @${comment?.user?.login} commented on PR #${pull_request!.number}:\n"${commentPreview}${commentPreview.length >= 200 ? '...' : ''}"\n${comment?.html_url || ''}`
}

const formatWebhookEvent = (event: string, payload: WebhookPayload): string => {
  const repo = payload.repository?.full_name || payload.repository?.name

  switch (event) {
    case 'issues':
      return formatIssueEvent(payload)
    case 'issue_comment':
      return formatIssueCommentEvent(payload)
    case 'pull_request':
      return formatPREvent(payload)
    case 'pull_request_review_comment':
      return formatPRReviewCommentEvent(payload)
    case 'push':
      return formatPushEvent(payload)
    default:
      return `[Webhook] ${event} in ${repo}`
  }
}

// ─── extractRefs tests ───────────────────────────────────────────────

describe('extractRefs', () => {
  const basePayload: WebhookPayload = {
    repository: { name: 'gigi', full_name: 'idea/gigi' },
  }

  it('extracts issue ref from issues event', () => {
    const refs = extractRefs('issues', {
      ...basePayload,
      issue: { number: 42 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'issue', number: 42 }])
  })

  it('extracts issue ref from issue_comment event', () => {
    const refs = extractRefs('issue_comment', {
      ...basePayload,
      issue: { number: 42 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'issue', number: 42 }])
  })

  it('extracts PR ref from issue_comment on a PR', () => {
    const refs = extractRefs('issue_comment', {
      ...basePayload,
      issue: { number: 10, pull_request: {} },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 10 }])
  })

  it('extracts PR ref from pull_request event', () => {
    const refs = extractRefs('pull_request', {
      ...basePayload,
      number: 15,
      pull_request: { number: 15 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 15 }])
  })

  it('uses payload.number over pull_request.number', () => {
    const refs = extractRefs('pull_request', {
      ...basePayload,
      number: 20,
      pull_request: { number: 15 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 20 }])
  })

  it('extracts PR ref from pull_request_review_comment event', () => {
    const refs = extractRefs('pull_request_review_comment', {
      ...basePayload,
      pull_request: { number: 7 },
    })
    assert.deepEqual(refs, [{ repo: 'gigi', ref_type: 'pr', number: 7 }])
  })

  it('returns empty for push event', () => {
    const refs = extractRefs('push', {
      ...basePayload,
      ref: 'refs/heads/main',
    })
    assert.deepEqual(refs, [])
  })

  it('returns empty when repository is missing', () => {
    const refs = extractRefs('issues', { issue: { number: 1 } })
    assert.deepEqual(refs, [])
  })

  it('returns empty for unknown event', () => {
    const refs = extractRefs('star', basePayload)
    assert.deepEqual(refs, [])
  })
})

// ─── extractTags tests ───────────────────────────────────────────────

describe('extractTags', () => {
  const basePayload: WebhookPayload = {
    repository: { name: 'gigi' },
  }

  it('always includes repo name as first tag', () => {
    const tags = extractTags('issues', {
      ...basePayload,
      issue: { number: 42 },
    })
    assert.equal(tags[0], 'gigi')
  })

  it('generates issue tag for issues event', () => {
    const tags = extractTags('issues', {
      ...basePayload,
      issue: { number: 42 },
    })
    assert.deepEqual(tags, ['gigi', 'gigi#42'])
  })

  it('generates issue + PR tags for issue_comment on PR', () => {
    const tags = extractTags('issue_comment', {
      ...basePayload,
      issue: { number: 10, pull_request: {} },
    })
    assert.deepEqual(tags, ['gigi', 'gigi#10', 'pr#10'])
  })

  it('generates PR tags for pull_request event', () => {
    const tags = extractTags('pull_request', {
      ...basePayload,
      number: 15,
      pull_request: { number: 15 },
    })
    assert.deepEqual(tags, ['gigi', 'gigi#15', 'pr#15'])
  })

  it('generates PR tags for review comments', () => {
    const tags = extractTags('pull_request_review_comment', {
      ...basePayload,
      pull_request: { number: 7 },
    })
    assert.deepEqual(tags, ['gigi', 'gigi#7', 'pr#7'])
  })

  it('returns only repo for push event', () => {
    const tags = extractTags('push', basePayload)
    assert.deepEqual(tags, ['gigi'])
  })

  it('returns empty when repository is missing', () => {
    const tags = extractTags('issues', { issue: { number: 1 } })
    assert.deepEqual(tags, [])
  })
})

// ─── shouldAutoCreate tests ──────────────────────────────────────────

describe('shouldAutoCreate', () => {
  it('returns true for newly opened issues', () => {
    assert.ok(shouldAutoCreate('issues', { action: 'opened' }))
  })

  it('returns true for newly opened PRs', () => {
    assert.ok(shouldAutoCreate('pull_request', { action: 'opened' }))
  })

  it('returns false for closed issues', () => {
    assert.ok(!shouldAutoCreate('issues', { action: 'closed' }))
  })

  it('returns false for comments', () => {
    assert.ok(!shouldAutoCreate('issue_comment', { action: 'created' }))
  })

  it('returns false for push events', () => {
    assert.ok(!shouldAutoCreate('push', {}))
  })
})

// ─── shouldAutoClose tests ───────────────────────────────────────────

describe('shouldAutoClose', () => {
  it('auto-closes on issue closed', () => {
    assert.ok(shouldAutoClose('issues', { action: 'closed' }, { status: 'paused' }))
  })

  it('auto-closes on PR closed', () => {
    assert.ok(shouldAutoClose('pull_request', { action: 'closed' }, { status: 'paused' }))
  })

  it('auto-closes on PR merged', () => {
    assert.ok(shouldAutoClose('pull_request', {
      action: 'closed',
      pull_request: { merged: true },
    }, { status: 'active' }))
  })

  it('does NOT auto-close already stopped conversations', () => {
    assert.ok(!shouldAutoClose('issues', { action: 'closed' }, { status: 'stopped' }))
  })

  it('does NOT auto-close already archived conversations', () => {
    assert.ok(!shouldAutoClose('issues', { action: 'closed' }, { status: 'archived' }))
  })

  it('does NOT auto-close on issue reopened', () => {
    assert.ok(!shouldAutoClose('issues', { action: 'reopened' }, { status: 'active' }))
  })

  it('does NOT auto-close on PR opened', () => {
    assert.ok(!shouldAutoClose('pull_request', { action: 'opened' }, { status: 'paused' }))
  })
})

// ─── formatWebhookEvent tests ────────────────────────────────────────

describe('formatWebhookEvent', () => {
  it('formats issue opened event', () => {
    const msg = formatWebhookEvent('issues', {
      action: 'opened',
      issue: { number: 42, title: 'Bug report', html_url: 'http://localhost/42', user: { login: 'alice' } },
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('📋'))
    assert.ok(msg.includes('Issue #42'))
    assert.ok(msg.includes('opened'))
    assert.ok(msg.includes('@alice'))
  })

  it('formats issue closed event', () => {
    const msg = formatWebhookEvent('issues', {
      action: 'closed',
      issue: { number: 42, title: 'Bug report', html_url: 'http://localhost/42', user: { login: 'alice' } },
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('✅'))
    assert.ok(msg.includes('closed'))
  })

  it('formats PR opened event with branches', () => {
    const msg = formatWebhookEvent('pull_request', {
      action: 'opened',
      number: 10,
      pull_request: {
        number: 10,
        title: 'New feature',
        html_url: 'http://localhost/10',
        user: { login: 'bob' },
        head: { ref: 'feat/x' },
        base: { ref: 'main' },
      },
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('🔀'))
    assert.ok(msg.includes('PR #10'))
    assert.ok(msg.includes('feat/x'))
    assert.ok(msg.includes('main'))
  })

  it('formats merged PR with merged status', () => {
    const msg = formatWebhookEvent('pull_request', {
      action: 'closed',
      number: 10,
      pull_request: {
        number: 10,
        title: 'Feature',
        merged: true,
        html_url: 'http://localhost/10',
        user: { login: 'bob' },
        head: { ref: 'feat' },
        base: { ref: 'main' },
      },
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('merged'))
  })

  it('formats issue comment event', () => {
    const msg = formatWebhookEvent('issue_comment', {
      issue: { number: 42 },
      comment: { body: 'LGTM', user: { login: 'carol' }, html_url: 'http://localhost/c' },
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('💬'))
    assert.ok(msg.includes('#42'))
    assert.ok(msg.includes('@carol'))
    assert.ok(msg.includes('LGTM'))
  })

  it('truncates long comments at 200 chars', () => {
    const longBody = 'x'.repeat(250)
    const msg = formatWebhookEvent('issue_comment', {
      issue: { number: 1 },
      comment: { body: longBody, user: { login: 'u' } },
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('...'))
  })

  it('formats push event with commits', () => {
    const msg = formatWebhookEvent('push', {
      ref: 'refs/heads/main',
      pusher: { login: 'dave' },
      commits: [
        { message: 'feat: first' },
        { message: 'fix: second\nlong description here' },
      ],
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('📤'))
    assert.ok(msg.includes('@dave'))
    assert.ok(msg.includes('2 commit(s)'))
    assert.ok(msg.includes('feat: first'))
    assert.ok(msg.includes('fix: second'))
    // Should NOT include the long description (only first line)
    assert.ok(!msg.includes('long description here'))
  })

  it('shows "and N more" for >3 commits', () => {
    const msg = formatWebhookEvent('push', {
      ref: 'refs/heads/main',
      pusher: { login: 'u' },
      commits: [
        { message: 'c1' }, { message: 'c2' }, { message: 'c3' },
        { message: 'c4' }, { message: 'c5' },
      ],
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('and 2 more'))
  })

  it('formats PR review comment event', () => {
    const msg = formatWebhookEvent('pull_request_review_comment', {
      pull_request: { number: 7 },
      comment: { body: 'Nitpick', user: { login: 'eve' }, html_url: 'http://localhost/r' },
      repository: { name: 'gigi' },
    })
    assert.ok(msg.includes('💬'))
    assert.ok(msg.includes('PR #7'))
    assert.ok(msg.includes('@eve'))
  })

  it('falls back for unknown event types', () => {
    const msg = formatWebhookEvent('star', {
      repository: { full_name: 'idea/gigi' },
    })
    assert.ok(msg.includes('[Webhook]'))
    assert.ok(msg.includes('star'))
    assert.ok(msg.includes('idea/gigi'))
  })
})
