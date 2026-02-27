/**
 * Webhooks — Pure Function Tests
 *
 * Tests verifySignature, summarizeEvent, and delivery deduplication logic
 * from webhooks.ts. These are the pure/sync helpers that don't need a
 * Hono context or live DB connection.
 */

import { vi } from 'vitest'
import { createHmac } from 'node:crypto'

// Mock I/O dependencies
vi.mock('../lib/core/store', () => ({
  getConfig: vi.fn(),
  checkRecentAction: vi.fn().mockResolvedValue(false),
}))

vi.mock('../lib/core/router', () => ({
  handleMessage: vi.fn(),
}))

vi.mock('../lib/api/webhookRouter', () => ({
  routeWebhook: vi.fn(),
}))

vi.mock('../lib/api/ciRouter', () => ({
  routeWorkflowEvent: vi.fn(),
}))

vi.mock('../lib/api/webhookNotifier', () => ({
  notifyWebhook: vi.fn(),
}))

vi.mock('../lib/api/crossRepoDispatch', () => ({
  handlePushDispatch: vi.fn(),
}))

vi.mock('../lib/core/events', () => ({
  emit: vi.fn(),
}))

import {
  verifySignature,
  summarizeEvent,
  _testDeliveryDedup,
  type WebhookPayload,
} from '../lib/api/webhooks'

// ─── Fixtures ────────────────────────────────────────────────────────

import issueOpened from './fixtures/webhooks/issue_opened.json'
import prOpened from './fixtures/webhooks/pull_request_opened.json'
import issueComment from './fixtures/webhooks/issue_comment.json'
import pushPayload from './fixtures/webhooks/push.json'

// ─── verifySignature tests ───────────────────────────────────────────

describe('verifySignature', () => {
  const secret = 'test-secret-key'
  const payload = '{"action":"opened"}'

  function computeSignature(body: string, key: string): string {
    return createHmac('sha256', key).update(body).digest('hex')
  }

  it('returns true for valid signature', () => {
    const sig = computeSignature(payload, secret)
    expect(verifySignature(payload, sig, secret)).toBe(true)
  })

  it('returns false for invalid signature', () => {
    expect(verifySignature(payload, 'deadbeef'.repeat(8), secret)).toBe(false)
  })

  it('returns false when signature is empty', () => {
    expect(verifySignature(payload, '', secret)).toBe(false)
  })

  it('returns false when secret is empty', () => {
    expect(verifySignature(payload, 'abc', '')).toBe(false)
  })

  it('returns false for malformed signature (non-hex)', () => {
    expect(verifySignature(payload, 'not-a-hex-string', secret)).toBe(false)
  })

  it('returns false for signature length mismatch', () => {
    // Too short
    expect(verifySignature(payload, 'abcd', secret)).toBe(false)
  })

  it('handles different payloads', () => {
    const body1 = '{"action":"opened"}'
    const body2 = '{"action":"closed"}'
    const sig1 = computeSignature(body1, secret)
    // Same sig should not verify for different payload
    expect(verifySignature(body2, sig1, secret)).toBe(false)
  })
})

// ─── summarizeEvent tests ────────────────────────────────────────────

describe('summarizeEvent', () => {
  it('summarizes push events with commits (fixture)', () => {
    const result = summarizeEvent('push', pushPayload as WebhookPayload)
    expect(result).not.toBeNull()
    expect(result).toContain('[Gitea Push]')
    expect(result).toContain('alice')
    expect(result).toContain('2 commits')
    expect(result).toContain('feat: add webhook notifier')
  })

  it('only includes first line of commit messages in push summary', () => {
    const result = summarizeEvent('push', pushPayload as WebhookPayload)
    expect(result).toContain('fix: typo in README')
    expect(result).not.toContain('Long description here')
  })

  it('summarizes pull request events (fixture)', () => {
    const result = summarizeEvent('pull_request', prOpened as WebhookPayload)
    expect(result).not.toBeNull()
    expect(result).toContain('[Gitea PR]')
    expect(result).toContain('opened')
    expect(result).toContain('#10')
    expect(result).toContain('feat: add dark mode')
    expect(result).toContain('bob')
    expect(result).toContain('feat/dark-mode')
    expect(result).toContain('main')
  })

  it('summarizes issue events (fixture)', () => {
    const result = summarizeEvent('issues', issueOpened as WebhookPayload)
    expect(result).not.toBeNull()
    expect(result).toContain('[Gitea Issue]')
    expect(result).toContain('opened')
    expect(result).toContain('#42')
    expect(result).toContain('Bug: webhook fails on empty payload')
  })

  it('includes issue body in summary', () => {
    const result = summarizeEvent('issues', issueOpened as WebhookPayload)
    expect(result).toContain('Body:')
    expect(result).toContain('empty body')
  })

  it('handles issue without body', () => {
    const result = summarizeEvent('issues', {
      action: 'opened',
      issue: { number: 1, title: 'No body', body: '', html_url: '' },
      repository: { name: 'gigi', full_name: 'idea/gigi' },
    } as WebhookPayload)
    expect(result).not.toBeNull()
    expect(result).not.toContain('Body:')
  })

  it('summarizes issue comment events (fixture)', () => {
    const result = summarizeEvent('issue_comment', issueComment as WebhookPayload)
    expect(result).not.toBeNull()
    expect(result).toContain('[Gitea Comment]')
    expect(result).toContain('#42')
    expect(result).toContain('carol')
    expect(result).toContain('I can reproduce this')
  })

  it('returns null for unknown events', () => {
    expect(summarizeEvent('star', {} as WebhookPayload)).toBeNull()
    expect(summarizeEvent('fork', {} as WebhookPayload)).toBeNull()
    expect(summarizeEvent('repository', {} as WebhookPayload)).toBeNull()
  })

  it('handles push with empty commits', () => {
    const result = summarizeEvent('push', {
      pusher: { login: 'u' },
      commits: [],
      repository: { name: 'gigi', full_name: 'idea/gigi' },
      ref: 'refs/heads/main',
    } as WebhookPayload)
    expect(result).toContain('0 commits')
  })
})

// ─── Delivery deduplication tests ────────────────────────────────────

describe('delivery deduplication', () => {
  const { recentDeliveries, isDeliveryDuplicate } = _testDeliveryDedup

  beforeEach(() => {
    recentDeliveries.clear()
  })

  it('returns false for first delivery', () => {
    expect(isDeliveryDuplicate('delivery-1')).toBe(false)
  })

  it('returns true for duplicate delivery', () => {
    isDeliveryDuplicate('delivery-2')
    expect(isDeliveryDuplicate('delivery-2')).toBe(true)
  })

  it('returns false for empty delivery ID', () => {
    expect(isDeliveryDuplicate('')).toBe(false)
  })

  it('tracks multiple distinct deliveries', () => {
    isDeliveryDuplicate('a')
    isDeliveryDuplicate('b')
    isDeliveryDuplicate('c')
    expect(isDeliveryDuplicate('a')).toBe(true)
    expect(isDeliveryDuplicate('b')).toBe(true)
    expect(isDeliveryDuplicate('d')).toBe(false)
  })
})
