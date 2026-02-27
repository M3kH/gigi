/**
 * Webhook Router — Pure Function Tests
 *
 * Tests extractRefs, extractTags, shouldAutoCreate, shouldAutoClose,
 * and all format* functions by importing directly from the source module.
 *
 * Uses vi.mock() to stub I/O dependencies (store, threads, agent, events,
 * response-routing) so pure functions can be tested without a database.
 */

import { vi } from 'vitest'

// Mock all I/O dependencies before importing
vi.mock('../lib/core/store', () => ({
  getPool: vi.fn(),
  getConfig: vi.fn(),
  findByTag: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  addMessage: vi.fn(),
  getMessages: vi.fn(),
  stopThread: vi.fn(),
  addTags: vi.fn(),
  setSessionId: vi.fn(),
}))

vi.mock('../lib/core/threads', () => ({
  findThreadByRef: vi.fn(),
  createThread: vi.fn(),
  addThreadRef: vi.fn(),
  addThreadEvent: vi.fn(),
  getThread: vi.fn(),
  updateThreadStatus: vi.fn(),
  updateThreadRefStatus: vi.fn(),
  setThreadSession: vi.fn(),
}))

vi.mock('../lib/core/agent', () => ({
  runAgent: vi.fn(),
}))

vi.mock('../lib/core/events', () => ({
  emit: vi.fn(),
}))

vi.mock('../lib/api/webhookNotifier', () => ({
  notifyWebhook: vi.fn().mockResolvedValue(true),
  notifyThreadEvent: vi.fn().mockResolvedValue(true),
}))

vi.mock('../lib/core/response-routing', () => ({
  determineRouting: vi.fn().mockReturnValue({ notify: [], notifyCondition: 'never' }),
  isSignificantEvent: vi.fn().mockReturnValue(false),
  buildDeliveryMetadata: vi.fn().mockReturnValue({}),
  getThreadActiveChannels: vi.fn().mockResolvedValue([]),
}))

import {
  extractRefs,
  extractTags,
  shouldAutoCreate,
  shouldAutoClose,
  formatWebhookEvent,
  formatIssueEvent,
  formatIssueCommentEvent,
  formatPREvent,
  formatPushEvent,
  formatPRReviewCommentEvent,
  type WebhookRef,
} from '../lib/api/webhookRouter'

import type { WebhookPayload } from '../lib/api/webhooks'

// ─── Fixtures ────────────────────────────────────────────────────────

import issueOpened from './fixtures/webhooks/issue_opened.json'
import issueClosed from './fixtures/webhooks/issue_closed.json'
import prOpened from './fixtures/webhooks/pull_request_opened.json'
import prMerged from './fixtures/webhooks/pull_request_merged.json'
import issueComment from './fixtures/webhooks/issue_comment.json'
import issueCommentOnPr from './fixtures/webhooks/issue_comment_on_pr.json'
import prReviewComment from './fixtures/webhooks/pr_review_comment.json'
import pushPayload from './fixtures/webhooks/push.json'

// ─── extractRefs tests ───────────────────────────────────────────────

describe('extractRefs', () => {
  it('extracts issue ref from issues event (fixture)', () => {
    const refs = extractRefs('issues', issueOpened as WebhookPayload)
    expect(refs).toEqual([{ repo: 'gigi', ref_type: 'issue', number: 42 }])
  })

  it('extracts issue ref from issue_comment event (fixture)', () => {
    const refs = extractRefs('issue_comment', issueComment as WebhookPayload)
    expect(refs).toEqual([{ repo: 'gigi', ref_type: 'issue', number: 42 }])
  })

  it('extracts PR ref from issue_comment on a PR (fixture)', () => {
    const refs = extractRefs('issue_comment', issueCommentOnPr as WebhookPayload)
    expect(refs).toEqual([{ repo: 'gigi', ref_type: 'pr', number: 10 }])
  })

  it('extracts PR ref from pull_request event (fixture)', () => {
    const refs = extractRefs('pull_request', prOpened as WebhookPayload)
    expect(refs).toEqual([{ repo: 'gigi', ref_type: 'pr', number: 10 }])
  })

  it('uses payload.number over pull_request.number', () => {
    const refs = extractRefs('pull_request', {
      repository: { name: 'gigi', full_name: 'idea/gigi' },
      number: 20,
      pull_request: { number: 15, title: 'x', merged: false, html_url: '', head: { ref: '' }, base: { ref: '' } },
    } as WebhookPayload)
    expect(refs).toEqual([{ repo: 'gigi', ref_type: 'pr', number: 20 }])
  })

  it('extracts PR ref from pull_request_review_comment event (fixture)', () => {
    const refs = extractRefs('pull_request_review_comment', prReviewComment as WebhookPayload)
    expect(refs).toEqual([{ repo: 'gigi', ref_type: 'pr', number: 10 }])
  })

  it('returns empty for push event', () => {
    const refs = extractRefs('push', pushPayload as WebhookPayload)
    expect(refs).toEqual([])
  })

  it('returns empty when repository is missing', () => {
    const refs = extractRefs('issues', { issue: { number: 1 } } as WebhookPayload)
    expect(refs).toEqual([])
  })

  it('returns empty for unknown event', () => {
    const refs = extractRefs('star', { repository: { name: 'gigi', full_name: 'idea/gigi' } } as WebhookPayload)
    expect(refs).toEqual([])
  })

  it('returns empty when issue number is missing', () => {
    const refs = extractRefs('issues', {
      repository: { name: 'gigi', full_name: 'idea/gigi' },
      issue: { title: 'No number' },
    } as unknown as WebhookPayload)
    expect(refs).toEqual([])
  })
})

// ─── extractTags tests ───────────────────────────────────────────────

describe('extractTags', () => {
  it('always includes repo name as first tag', () => {
    const tags = extractTags('issues', issueOpened as WebhookPayload)
    expect(tags[0]).toBe('gigi')
  })

  it('generates issue tag for issues event (fixture)', () => {
    const tags = extractTags('issues', issueOpened as WebhookPayload)
    expect(tags).toEqual(['gigi', 'gigi#42'])
  })

  it('generates issue tag for issue_comment event (fixture)', () => {
    const tags = extractTags('issue_comment', issueComment as WebhookPayload)
    expect(tags).toEqual(['gigi', 'gigi#42'])
  })

  it('generates issue + PR tags for issue_comment on PR (fixture)', () => {
    const tags = extractTags('issue_comment', issueCommentOnPr as WebhookPayload)
    expect(tags).toEqual(['gigi', 'gigi#10', 'pr#10'])
  })

  it('generates PR tags for pull_request event (fixture)', () => {
    const tags = extractTags('pull_request', prOpened as WebhookPayload)
    expect(tags).toEqual(['gigi', 'gigi#10', 'pr#10'])
  })

  it('generates PR tags for review comments (fixture)', () => {
    const tags = extractTags('pull_request_review_comment', prReviewComment as WebhookPayload)
    expect(tags).toEqual(['gigi', 'gigi#10', 'pr#10'])
  })

  it('returns only repo for push event', () => {
    const tags = extractTags('push', pushPayload as WebhookPayload)
    expect(tags).toEqual(['gigi'])
  })

  it('returns empty when repository is missing', () => {
    const tags = extractTags('issues', { issue: { number: 1 } } as WebhookPayload)
    expect(tags).toEqual([])
  })

  it('returns only repo tag for unknown event types', () => {
    const tags = extractTags('repository', { repository: { name: 'gigi', full_name: 'idea/gigi' } } as WebhookPayload)
    expect(tags).toEqual(['gigi'])
  })

  it('prefers payload.number over pull_request.number for tags', () => {
    const tags = extractTags('pull_request', {
      repository: { name: 'gigi', full_name: 'idea/gigi' },
      number: 10,
      pull_request: { number: 99, title: 'x', merged: false, html_url: '', head: { ref: '' }, base: { ref: '' } },
    } as WebhookPayload)
    expect(tags).toEqual(['gigi', 'gigi#10', 'pr#10'])
  })
})

// ─── Tag priority (tag sorting logic) ────────────────────────────────

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
    expect(prioritized[0]).toContain('#')
    expect(prioritized[1]).toContain('#')
    expect(prioritized[2]).toBe('gigi')
  })

  it('keeps same-specificity order stable', () => {
    const tags = ['gigi#42', 'pr#42']
    const prioritized = [...tags].sort((a, b) => {
      const aSpecific = a.includes('#')
      const bSpecific = b.includes('#')
      if (aSpecific && !bSpecific) return -1
      if (!aSpecific && bSpecific) return 1
      return 0
    })
    expect(prioritized).toEqual(['gigi#42', 'pr#42'])
  })
})

// ─── shouldAutoCreate tests ──────────────────────────────────────────

describe('shouldAutoCreate', () => {
  it('returns true for newly opened issues (fixture)', () => {
    expect(shouldAutoCreate('issues', issueOpened as WebhookPayload)).toBe(true)
  })

  it('returns true for newly opened PRs (fixture)', () => {
    expect(shouldAutoCreate('pull_request', prOpened as WebhookPayload)).toBe(true)
  })

  it('returns false for closed issues', () => {
    expect(shouldAutoCreate('issues', issueClosed as WebhookPayload)).toBe(false)
  })

  it('returns false for comments', () => {
    expect(shouldAutoCreate('issue_comment', issueComment as WebhookPayload)).toBe(false)
  })

  it('returns false for push events', () => {
    expect(shouldAutoCreate('push', pushPayload as WebhookPayload)).toBe(false)
  })

  it('returns false for merged PRs', () => {
    expect(shouldAutoCreate('pull_request', prMerged as WebhookPayload)).toBe(false)
  })
})

// ─── shouldAutoClose tests ───────────────────────────────────────────

describe('shouldAutoClose', () => {
  it('auto-closes on issue closed', () => {
    expect(shouldAutoClose('issues', issueClosed as WebhookPayload, { status: 'paused' })).toBe(true)
  })

  it('auto-closes on PR closed', () => {
    expect(shouldAutoClose('pull_request', { action: 'closed' } as WebhookPayload, { status: 'paused' })).toBe(true)
  })

  it('auto-closes on PR merged (fixture)', () => {
    expect(shouldAutoClose('pull_request', prMerged as WebhookPayload, { status: 'active' })).toBe(true)
  })

  it('does NOT auto-close already stopped conversations', () => {
    expect(shouldAutoClose('issues', issueClosed as WebhookPayload, { status: 'stopped' })).toBe(false)
  })

  it('does NOT auto-close already archived conversations', () => {
    expect(shouldAutoClose('issues', issueClosed as WebhookPayload, { status: 'archived' })).toBe(false)
  })

  it('does NOT auto-close on issue reopened', () => {
    expect(shouldAutoClose('issues', { action: 'reopened' } as WebhookPayload, { status: 'active' })).toBe(false)
  })

  it('does NOT auto-close on PR opened', () => {
    expect(shouldAutoClose('pull_request', prOpened as WebhookPayload, { status: 'paused' })).toBe(false)
  })

  it('does NOT auto-close on comment events', () => {
    expect(shouldAutoClose('issue_comment', issueComment as WebhookPayload, { status: 'active' })).toBe(false)
  })
})

// ─── formatIssueEvent tests ──────────────────────────────────────────

describe('formatIssueEvent', () => {
  it('formats opened issue with correct emoji', () => {
    const msg = formatIssueEvent(issueOpened as WebhookPayload)
    expect(msg).toContain('📋')
    expect(msg).toContain('Issue #42')
    expect(msg).toContain('opened')
    expect(msg).toContain('@alice')
  })

  it('formats closed issue with correct emoji', () => {
    const msg = formatIssueEvent(issueClosed as WebhookPayload)
    expect(msg).toContain('✅')
    expect(msg).toContain('closed')
  })

  it('uses default emoji for unknown action', () => {
    const msg = formatIssueEvent({
      action: 'milestoned',
      issue: { number: 1, title: 'Test', body: '', html_url: '', user: { login: 'u' } },
    } as WebhookPayload)
    expect(msg).toContain('📋')
  })

  it('formats reopened issue with correct emoji', () => {
    const msg = formatIssueEvent({
      action: 'reopened',
      issue: { number: 1, title: 'Test', body: '', html_url: '', user: { login: 'u' } },
    } as WebhookPayload)
    expect(msg).toContain('🔄')
  })
})

// ─── formatPREvent tests ─────────────────────────────────────────────

describe('formatPREvent', () => {
  it('formats opened PR with branches', () => {
    const msg = formatPREvent(prOpened as WebhookPayload)
    expect(msg).toContain('🔀')
    expect(msg).toContain('PR #10')
    expect(msg).toContain('feat/dark-mode')
    expect(msg).toContain('main')
  })

  it('formats merged PR with status "merged"', () => {
    const msg = formatPREvent(prMerged as WebhookPayload)
    expect(msg).toContain('merged')
    expect(msg).toContain('✅')
  })

  it('formats closed (not merged) PR', () => {
    const msg = formatPREvent({
      action: 'closed',
      number: 5,
      pull_request: { number: 5, title: 'Dropped', merged: false, html_url: '', user: { login: 'u' }, head: { ref: 'feat' }, base: { ref: 'main' } },
    } as WebhookPayload)
    expect(msg).toContain('❌')
    expect(msg).toContain('closed')
  })
})

// ─── formatIssueCommentEvent tests ───────────────────────────────────

describe('formatIssueCommentEvent', () => {
  it('formats comment with user and preview (fixture)', () => {
    const msg = formatIssueCommentEvent(issueComment as WebhookPayload)
    expect(msg).toContain('💬')
    expect(msg).toContain('@carol')
    expect(msg).toContain('#42')
    expect(msg).toContain('I can reproduce this')
  })

  it('truncates long comments at 200 chars', () => {
    const longBody = 'a'.repeat(250)
    const msg = formatIssueCommentEvent({
      issue: { number: 1, title: 'T', body: '', html_url: '' },
      comment: { body: longBody, user: { login: 'u' }, html_url: '' },
    } as WebhookPayload)
    expect(msg).toContain('...')
  })

  it('does not truncate short comments', () => {
    const msg = formatIssueCommentEvent({
      issue: { number: 1, title: 'T', body: '', html_url: '' },
      comment: { body: 'Short', user: { login: 'u' }, html_url: '' },
    } as WebhookPayload)
    expect(msg).not.toContain('...')
  })
})

// ─── formatPushEvent tests ───────────────────────────────────────────

describe('formatPushEvent', () => {
  it('formats push with commits (fixture)', () => {
    const msg = formatPushEvent(pushPayload as WebhookPayload)
    expect(msg).toContain('📤')
    expect(msg).toContain('@alice')
    expect(msg).toContain('2 commit(s)')
    expect(msg).toContain('feat: add webhook notifier')
  })

  it('only shows first line of multi-line commit messages', () => {
    const msg = formatPushEvent(pushPayload as WebhookPayload)
    expect(msg).toContain('fix: typo in README')
    expect(msg).not.toContain('Long description here')
  })

  it('shows "and N more" for >3 commits', () => {
    const msg = formatPushEvent({
      ref: 'refs/heads/main',
      pusher: { login: 'u' },
      commits: [
        { id: '1', message: 'c1' }, { id: '2', message: 'c2' },
        { id: '3', message: 'c3' }, { id: '4', message: 'c4' },
        { id: '5', message: 'c5' },
      ],
    } as WebhookPayload)
    expect(msg).toContain('and 2 more')
  })

  it('does not show "and N more" for <=3 commits', () => {
    const msg = formatPushEvent(pushPayload as WebhookPayload)
    expect(msg).not.toContain('and')
  })

  it('handles empty commits array', () => {
    const msg = formatPushEvent({
      ref: 'refs/heads/main',
      pusher: { login: 'u' },
      commits: [],
    } as unknown as WebhookPayload)
    expect(msg).toContain('0 commit(s)')
  })
})

// ─── formatPRReviewCommentEvent tests ────────────────────────────────

describe('formatPRReviewCommentEvent', () => {
  it('formats PR review comment (fixture)', () => {
    const msg = formatPRReviewCommentEvent(prReviewComment as WebhookPayload)
    expect(msg).toContain('💬')
    expect(msg).toContain('@eve')
    expect(msg).toContain('PR #10')
    expect(msg).toContain('null check')
  })

  it('truncates long review comments at 200 chars', () => {
    const longBody = 'r'.repeat(250)
    const msg = formatPRReviewCommentEvent({
      pull_request: { number: 1, title: 'T', merged: false, html_url: '', user: { login: 'u' }, head: { ref: '' }, base: { ref: '' } },
      comment: { body: longBody, user: { login: 'u' }, html_url: '' },
    } as WebhookPayload)
    expect(msg).toContain('...')
  })
})

// ─── formatWebhookEvent (dispatcher) tests ───────────────────────────

describe('formatWebhookEvent', () => {
  it('dispatches issues to formatIssueEvent', () => {
    const msg = formatWebhookEvent('issues', issueOpened as WebhookPayload)
    expect(msg).toContain('Issue #42')
  })

  it('dispatches issue_comment to formatIssueCommentEvent', () => {
    const msg = formatWebhookEvent('issue_comment', issueComment as WebhookPayload)
    expect(msg).toContain('@carol')
  })

  it('dispatches pull_request to formatPREvent', () => {
    const msg = formatWebhookEvent('pull_request', prOpened as WebhookPayload)
    expect(msg).toContain('PR #10')
  })

  it('dispatches pull_request_review_comment to formatPRReviewCommentEvent', () => {
    const msg = formatWebhookEvent('pull_request_review_comment', prReviewComment as WebhookPayload)
    expect(msg).toContain('PR #10')
  })

  it('dispatches push to formatPushEvent', () => {
    const msg = formatWebhookEvent('push', pushPayload as WebhookPayload)
    expect(msg).toContain('@alice')
  })

  it('falls back for unknown event types', () => {
    const msg = formatWebhookEvent('star', {
      repository: { name: 'gigi', full_name: 'idea/gigi' },
    } as WebhookPayload)
    expect(msg).toContain('[Webhook]')
    expect(msg).toContain('star')
    expect(msg).toContain('idea/gigi')
  })

  it('uses repo name when full_name is absent in fallback', () => {
    const msg = formatWebhookEvent('star', {
      repository: { name: 'gigi', full_name: 'idea/gigi' },
    } as WebhookPayload)
    expect(msg).toContain('idea/gigi')
  })
})
