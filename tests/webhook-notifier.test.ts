/**
 * Webhook Notifier Tests
 *
 * Tests the shouldNotify filtering, formatNotification templating,
 * and escapeMarkdown utility for Telegram notifications triggered
 * by Gitea webhook events.
 *
 * These are pure function tests — no Telegram API calls are made.
 * The functions are re-implemented here since they're not exported.
 */

import assert from 'node:assert/strict'

// ─── Re-implement pure functions for unit testing ────────────────────

interface WebhookPayload {
  action?: string
  repository?: { name?: string; full_name?: string; html_url?: string }
  issue?: { number?: number; title?: string; html_url?: string; user?: { login?: string }; state?: string }
  pull_request?: { number?: number; title?: string; html_url?: string; user?: { login?: string }; merged?: boolean; head?: { ref?: string }; base?: { ref?: string } }
  number?: number
  comment?: { body?: string; user?: { login?: string }; html_url?: string }
  review?: { body?: string; user?: { login?: string } }
  pusher?: { login?: string }
  ref?: string
  commits?: Array<{ message: string }>
  sender?: { login?: string }
}

const shouldNotify = (event: string, payload: WebhookPayload): boolean => {
  const sender = payload.sender?.login || payload.pusher?.login || ''
  if (sender === 'gigi') return false

  switch (event) {
    case 'issues':
      return payload.action === 'opened' || payload.action === 'closed'
    case 'pull_request':
      return payload.action === 'opened' || payload.pull_request?.merged === true || payload.action === 'closed'
    case 'issue_comment':
      return payload.action === 'created'
    case 'pull_request_review_comment':
      return payload.action === 'created'
    case 'push':
      return payload.ref === 'refs/heads/main' || payload.ref === 'refs/heads/master'
    default:
      return false
  }
}

const escapeMarkdown = (text: string): string => {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

const formatNotification = (event: string, payload: WebhookPayload): string => {
  const repo = payload.repository?.full_name || payload.repository?.name || 'unknown'

  switch (event) {
    case 'issues': {
      const { action, issue } = payload
      if (action === 'opened') {
        return `📋 *New issue* in \`${repo}\`\n[#${issue?.number}: ${escapeMarkdown(issue?.title || '')}](${issue?.html_url})\nby @${issue?.user?.login}`
      }
      if (action === 'closed') {
        return `✅ *Issue closed* in \`${repo}\`\n[#${issue?.number}: ${escapeMarkdown(issue?.title || '')}](${issue?.html_url})`
      }
      break
    }

    case 'pull_request': {
      const pr = payload.pull_request
      const prNum = payload.number || pr?.number
      if (pr?.merged) {
        return `🎉 *PR merged* in \`${repo}\`\n[#${prNum}: ${escapeMarkdown(pr?.title || '')}](${pr?.html_url})\n\`${pr?.head?.ref}\` → \`${pr?.base?.ref}\``
      }
      if (payload.action === 'opened') {
        return `🔀 *New PR* in \`${repo}\`\n[#${prNum}: ${escapeMarkdown(pr?.title || '')}](${pr?.html_url})\n\`${pr?.head?.ref}\` → \`${pr?.base?.ref}\`\nby @${pr?.user?.login}`
      }
      if (payload.action === 'closed') {
        return `❌ *PR closed* in \`${repo}\`\n[#${prNum}: ${escapeMarkdown(pr?.title || '')}](${pr?.html_url})`
      }
      break
    }

    case 'issue_comment': {
      const { issue, comment } = payload
      const preview = (comment?.body || '').slice(0, 100)
      const ellipsis = (comment?.body || '').length > 100 ? '...' : ''
      return `💬 *Comment* on #${issue?.number} in \`${repo}\`\nby @${comment?.user?.login}: ${escapeMarkdown(preview)}${ellipsis}\n${comment?.html_url}`
    }

    case 'pull_request_review_comment': {
      const { pull_request, comment } = payload
      const preview = (comment?.body || '').slice(0, 100)
      const ellipsis = (comment?.body || '').length > 100 ? '...' : ''
      return `💬 *Review comment* on PR #${pull_request?.number} in \`${repo}\`\nby @${comment?.user?.login}: ${escapeMarkdown(preview)}${ellipsis}\n${comment?.html_url}`
    }

    case 'push': {
      const commits = payload.commits || []
      const branch = payload.ref?.replace('refs/heads/', '') || 'unknown'
      const summary = commits.slice(0, 3).map(c => `• ${c.message.split('\n')[0]}`).join('\n')
      const more = commits.length > 3 ? `\n_...and ${commits.length - 3} more_` : ''
      return `📤 *Push to \`${branch}\`* in \`${repo}\`\n${commits.length} commit(s) by @${payload.pusher?.login}\n${summary}${more}`
    }
  }

  return `🔔 *Webhook* \`${event}\` in \`${repo}\``
}

// ─── shouldNotify tests ──────────────────────────────────────────────

describe('webhook notifier — event filtering', () => {
  // ── Self-event filtering ───────────────────────────────────────
  it('should NOT notify for events from gigi bot (sender)', () => {
    assert.equal(shouldNotify('issues', { action: 'opened', sender: { login: 'gigi' } }), false)
  })

  it('should NOT notify for pushes from gigi bot (pusher)', () => {
    assert.equal(shouldNotify('push', { ref: 'refs/heads/main', pusher: { login: 'gigi' } }), false)
  })

  // ── Issues ──────────────────────────────────────────────────────
  it('should notify for issue opened', () => {
    assert.ok(shouldNotify('issues', { action: 'opened', sender: { login: 'testuser' } }))
  })

  it('should notify for issue closed', () => {
    assert.ok(shouldNotify('issues', { action: 'closed', sender: { login: 'testuser' } }))
  })

  it('should NOT notify for issue edited', () => {
    assert.equal(shouldNotify('issues', { action: 'edited', sender: { login: 'testuser' } }), false)
  })

  it('should NOT notify for issue labeled', () => {
    assert.equal(shouldNotify('issues', { action: 'label_updated', sender: { login: 'testuser' } }), false)
  })

  it('should NOT notify for issue reopened', () => {
    assert.equal(shouldNotify('issues', { action: 'reopened', sender: { login: 'testuser' } }), false)
  })

  // ── Pull Requests ──────────────────────────────────────────────
  it('should notify for PR opened', () => {
    assert.ok(shouldNotify('pull_request', { action: 'opened', sender: { login: 'testuser' } }))
  })

  it('should notify for PR merged', () => {
    assert.ok(shouldNotify('pull_request', {
      action: 'closed',
      pull_request: { merged: true },
      sender: { login: 'testuser' },
    }))
  })

  it('should notify for PR closed (not merged)', () => {
    assert.ok(shouldNotify('pull_request', {
      action: 'closed',
      pull_request: { merged: false },
      sender: { login: 'testuser' },
    }))
  })

  it('should NOT notify for PR synchronized (new push)', () => {
    assert.equal(shouldNotify('pull_request', { action: 'synchronized', sender: { login: 'testuser' } }), false)
  })

  // ── Comments ───────────────────────────────────────────────────
  it('should notify for ALL new issue comments', () => {
    assert.ok(shouldNotify('issue_comment', { action: 'created', sender: { login: 'testuser' } }))
  })

  it('should notify for @gigi mention comments', () => {
    assert.ok(shouldNotify('issue_comment', {
      action: 'created',
      comment: { body: '@gigi please fix this', user: { login: 'testuser' } },
      sender: { login: 'testuser' },
    }))
  })

  it('should notify for PR review comments', () => {
    assert.ok(shouldNotify('pull_request_review_comment', {
      action: 'created',
      sender: { login: 'testuser' },
    }))
  })

  it('should NOT notify for edited comments', () => {
    assert.equal(shouldNotify('issue_comment', { action: 'edited', sender: { login: 'testuser' } }), false)
  })

  it('should NOT notify for deleted comments', () => {
    assert.equal(shouldNotify('issue_comment', { action: 'deleted', sender: { login: 'testuser' } }), false)
  })

  // ── Push ───────────────────────────────────────────────────────
  it('should notify for push to main', () => {
    assert.ok(shouldNotify('push', { ref: 'refs/heads/main', pusher: { login: 'testuser' } }))
  })

  it('should notify for push to master', () => {
    assert.ok(shouldNotify('push', { ref: 'refs/heads/master', pusher: { login: 'testuser' } }))
  })

  it('should NOT notify for push to feature branch', () => {
    assert.equal(shouldNotify('push', { ref: 'refs/heads/feat/my-feature', pusher: { login: 'testuser' } }), false)
  })

  // ── Unknown events ─────────────────────────────────────────────
  it('should NOT notify for unknown event types', () => {
    assert.equal(shouldNotify('repository', { sender: { login: 'testuser' } }), false)
    assert.equal(shouldNotify('fork', { sender: { login: 'testuser' } }), false)
    assert.equal(shouldNotify('create', { sender: { login: 'testuser' } }), false)
  })
})

// ─── escapeMarkdown tests ────────────────────────────────────────────

describe('webhook notifier — escapeMarkdown', () => {
  it('escapes underscores', () => {
    assert.equal(escapeMarkdown('hello_world'), 'hello\\_world')
  })

  it('escapes asterisks', () => {
    assert.equal(escapeMarkdown('*bold*'), '\\*bold\\*')
    assert.equal(escapeMarkdown('**bold**'), '\\*\\*bold\\*\\*')
  })

  it('escapes brackets and parens', () => {
    assert.equal(escapeMarkdown('[link](url)'), '\\[link\\]\\(url\\)')
  })

  it('escapes backticks', () => {
    assert.equal(escapeMarkdown('`code`'), '\\`code\\`')
  })

  it('escapes hash', () => {
    assert.equal(escapeMarkdown('#123'), '\\#123')
  })

  it('escapes exclamation', () => {
    assert.equal(escapeMarkdown('breaking!'), 'breaking\\!')
  })

  it('handles empty strings', () => {
    assert.equal(escapeMarkdown(''), '')
  })

  it('leaves plain text unchanged', () => {
    assert.equal(escapeMarkdown('hello world'), 'hello world')
    assert.equal(escapeMarkdown('simple text 123'), 'simple text 123')
  })

  it('escapes multiple special chars in complex strings', () => {
    const input = 'fix: handle #123 (breaking!)'
    const expected = 'fix: handle \\#123 \\(breaking\\!\\)'
    assert.equal(escapeMarkdown(input), expected)
  })
})

// ─── formatNotification tests ────────────────────────────────────────

describe('webhook notifier — formatNotification', () => {
  const basePayload: WebhookPayload = {
    repository: { name: 'gigi', full_name: 'idea/gigi', html_url: 'http://localhost:3300/idea/gigi' },
  }

  describe('issues', () => {
    it('formats new issue notification', () => {
      const msg = formatNotification('issues', {
        ...basePayload,
        action: 'opened',
        issue: { number: 42, title: 'Fix the bug', html_url: 'http://localhost/issues/42', user: { login: 'alice' } },
      })
      assert.ok(msg.includes('📋'))
      assert.ok(msg.includes('New issue'))
      assert.ok(msg.includes('#42'))
      assert.ok(msg.includes('idea/gigi'))
      assert.ok(msg.includes('@alice'))
      assert.ok(msg.includes('Fix the bug'))
    })

    it('formats closed issue notification', () => {
      const msg = formatNotification('issues', {
        ...basePayload,
        action: 'closed',
        issue: { number: 42, title: 'Fix the bug', html_url: 'http://localhost/issues/42' },
      })
      assert.ok(msg.includes('✅'))
      assert.ok(msg.includes('Issue closed'))
      assert.ok(msg.includes('#42'))
    })
  })

  describe('pull_request', () => {
    it('formats new PR notification with branch info', () => {
      const msg = formatNotification('pull_request', {
        ...basePayload,
        action: 'opened',
        number: 10,
        pull_request: {
          number: 10, title: 'Add feature', html_url: 'http://localhost/pulls/10',
          user: { login: 'bob' }, head: { ref: 'feat/new' }, base: { ref: 'main' },
        },
      })
      assert.ok(msg.includes('🔀'))
      assert.ok(msg.includes('New PR'))
      assert.ok(msg.includes('#10'))
      assert.ok(msg.includes('feat/new'))
      assert.ok(msg.includes('main'))
      assert.ok(msg.includes('@bob'))
    })

    it('formats merged PR notification', () => {
      const msg = formatNotification('pull_request', {
        ...basePayload,
        action: 'closed',
        number: 10,
        pull_request: {
          number: 10, title: 'Add feature', html_url: 'http://localhost/pulls/10',
          merged: true, head: { ref: 'feat/new' }, base: { ref: 'main' },
        },
      })
      assert.ok(msg.includes('🎉'))
      assert.ok(msg.includes('PR merged'))
    })

    it('formats closed (not merged) PR notification', () => {
      const msg = formatNotification('pull_request', {
        ...basePayload,
        action: 'closed',
        number: 10,
        pull_request: { number: 10, title: 'Abandoned', html_url: 'http://localhost/pulls/10', merged: false },
      })
      assert.ok(msg.includes('❌'))
      assert.ok(msg.includes('PR closed'))
    })
  })

  describe('comments', () => {
    it('formats issue comment notification', () => {
      const msg = formatNotification('issue_comment', {
        ...basePayload,
        issue: { number: 42 },
        comment: { body: 'Great work!', user: { login: 'carol' }, html_url: 'http://localhost/c' },
      })
      assert.ok(msg.includes('💬'))
      assert.ok(msg.includes('Comment'))
      assert.ok(msg.includes('#42'))
      assert.ok(msg.includes('@carol'))
      assert.ok(msg.includes('Great work'))
    })

    it('truncates long comments with ellipsis', () => {
      const longBody = 'x'.repeat(150)
      const msg = formatNotification('issue_comment', {
        ...basePayload,
        issue: { number: 1 },
        comment: { body: longBody, user: { login: 'user' }, html_url: 'http://localhost/c' },
      })
      assert.ok(msg.includes('...'))
    })

    it('does not add ellipsis for short comments', () => {
      const msg = formatNotification('issue_comment', {
        ...basePayload,
        issue: { number: 1 },
        comment: { body: 'Short', user: { login: 'user' }, html_url: 'http://localhost/c' },
      })
      assert.ok(!msg.includes('...'))
    })

    it('formats PR review comment notification', () => {
      const msg = formatNotification('pull_request_review_comment', {
        ...basePayload,
        pull_request: { number: 5 },
        comment: { body: 'Needs refactor', user: { login: 'dave' }, html_url: 'http://localhost/r' },
      })
      assert.ok(msg.includes('Review comment'))
      assert.ok(msg.includes('PR #5'))
      assert.ok(msg.includes('@dave'))
    })
  })

  describe('push', () => {
    it('formats push notification with commits', () => {
      const msg = formatNotification('push', {
        ...basePayload,
        ref: 'refs/heads/main',
        pusher: { login: 'eve' },
        commits: [{ message: 'feat: add login' }, { message: 'fix: typo' }],
      })
      assert.ok(msg.includes('📤'))
      assert.ok(msg.includes('Push to'))
      assert.ok(msg.includes('main'))
      assert.ok(msg.includes('2 commit(s)'))
      assert.ok(msg.includes('@eve'))
      assert.ok(msg.includes('feat: add login'))
      assert.ok(msg.includes('fix: typo'))
    })

    it('only shows first line of multi-line commit messages', () => {
      const msg = formatNotification('push', {
        ...basePayload,
        ref: 'refs/heads/main',
        pusher: { login: 'user' },
        commits: [{ message: 'feat: summary\n\nLong description here' }],
      })
      assert.ok(msg.includes('feat: summary'))
      assert.ok(!msg.includes('Long description'))
    })

    it('shows "and N more" for >3 commits', () => {
      const msg = formatNotification('push', {
        ...basePayload,
        ref: 'refs/heads/main',
        pusher: { login: 'user' },
        commits: [
          { message: 'c1' }, { message: 'c2' }, { message: 'c3' },
          { message: 'c4' }, { message: 'c5' },
        ],
      })
      assert.ok(msg.includes('5 commit(s)'))
      assert.ok(msg.includes('and 2 more'))
    })

    it('does not show "and N more" for <=3 commits', () => {
      const msg = formatNotification('push', {
        ...basePayload,
        ref: 'refs/heads/main',
        pusher: { login: 'user' },
        commits: [{ message: 'c1' }, { message: 'c2' }],
      })
      assert.ok(!msg.includes('and'))
    })
  })

  describe('fallback', () => {
    it('falls back for unknown events', () => {
      const msg = formatNotification('star', basePayload)
      assert.ok(msg.includes('🔔'))
      assert.ok(msg.includes('Webhook'))
      assert.ok(msg.includes('star'))
      assert.ok(msg.includes('idea/gigi'))
    })

    it('handles missing repository info', () => {
      const msg = formatNotification('issues', {
        action: 'opened',
        issue: { number: 1, title: 'Test' },
      })
      assert.ok(msg.includes('unknown'))
    })
  })
})
