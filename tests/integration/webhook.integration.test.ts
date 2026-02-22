/**
 * Integration Test: Webhooks — Signature verification & routing
 *
 * Tests webhook signature generation/verification, payload construction,
 * and webhook routing against a real database.
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  connectTestDB,
  disconnectTestDB,
  truncateAll,
  issueEvent,
  issueCommentEvent,
  pullRequestEvent,
  prReviewCommentEvent,
  pushEvent,
  gigiMentionEvent,
  signPayload,
  verifySignature,
  simulateWebhookEvent,
  assertThreadTags,
  assertThreadStatus,
} from './index'
import * as store from '../../lib/core/store'

// ─── Suite Setup ────────────────────────────────────────────────────

before(async () => {
  await connectTestDB()
})

after(async () => {
  await disconnectTestDB()
})

beforeEach(async () => {
  await truncateAll()
})

// ─── Tests ──────────────────────────────────────────────────────────

describe('Webhook Mock: Signature Verification', () => {
  it('should generate valid HMAC-SHA256 signatures', () => {
    const secret = 'my-secret-key'
    const request = issueEvent({ secret })

    assert.ok(request.signature)
    assert.equal(request.signature.length, 64) // SHA256 hex = 64 chars

    // Verify the signature is correct
    const valid = verifySignature(request.body, request.signature, secret)
    assert.equal(valid, true)
  })

  it('should fail verification with wrong secret', () => {
    const request = issueEvent({ secret: 'correct-secret' })
    const valid = verifySignature(request.body, request.signature, 'wrong-secret')
    assert.equal(valid, false)
  })

  it('should fail verification with tampered body', () => {
    const request = issueEvent({ secret: 'my-secret' })
    const valid = verifySignature(request.body + 'tampered', request.signature, 'my-secret')
    assert.equal(valid, false)
  })

  it('should include correct headers', () => {
    const request = issueEvent()
    assert.equal(request.headers['content-type'], 'application/json')
    assert.equal(request.headers['x-gitea-event'], 'issues')
    assert.ok(request.headers['x-gitea-signature'])
  })
})

describe('Webhook Mock: Payload Generation', () => {
  it('should generate issue opened payload', () => {
    const request = issueEvent({
      repo: 'gigi',
      issueNumber: 42,
      issueTitle: 'Add feature X',
      author: 'testuser',
    })

    assert.equal(request.event, 'issues')
    assert.equal(request.payload.action, 'opened')
    assert.equal(request.payload.repository?.name, 'gigi')
    assert.equal(request.payload.issue?.number, 42)
    assert.equal(request.payload.issue?.title, 'Add feature X')
    assert.equal(request.payload.issue?.user?.login, 'testuser')
  })

  it('should generate issue comment payload', () => {
    const request = issueCommentEvent({
      repo: 'gigi',
      issueNumber: 42,
      commentBody: 'Looks good!',
      author: 'guglielmo',
    })

    assert.equal(request.event, 'issue_comment')
    assert.equal(request.payload.action, 'created')
    assert.equal(request.payload.comment?.body, 'Looks good!')
    assert.equal(request.payload.comment?.user?.login, 'guglielmo')
  })

  it('should generate pull request payload', () => {
    const request = pullRequestEvent({
      repo: 'gigi',
      prNumber: 15,
      prTitle: 'Fix bug',
      prBranch: 'fix/bug-123',
      baseBranch: 'main',
    })

    assert.equal(request.event, 'pull_request')
    assert.equal(request.payload.number, 15)
    assert.equal(request.payload.pull_request?.title, 'Fix bug')
    assert.equal(request.payload.pull_request?.head?.ref, 'fix/bug-123')
    assert.equal(request.payload.pull_request?.base?.ref, 'main')
  })

  it('should generate PR review comment payload', () => {
    const request = prReviewCommentEvent({
      repo: 'gigi',
      prNumber: 10,
      commentBody: 'Consider using const here',
    })

    assert.equal(request.event, 'pull_request_review_comment')
    assert.equal(request.payload.pull_request?.number, 10)
    assert.equal(request.payload.comment?.body, 'Consider using const here')
  })

  it('should generate push payload', () => {
    const request = pushEvent({
      repo: 'gigi',
      author: 'testuser',
      ref: 'refs/heads/feat/new-feature',
      commits: [
        { id: 'abc123', message: 'First commit' },
        { id: 'def456', message: 'Second commit' },
      ],
    })

    assert.equal(request.event, 'push')
    assert.equal(request.payload.ref, 'refs/heads/feat/new-feature')
    assert.equal(request.payload.pusher?.login, 'testuser')
    assert.equal(request.payload.commits?.length, 2)
  })

  it('should generate @gigi mention payload', () => {
    const request = gigiMentionEvent({
      repo: 'gigi',
      issueNumber: 38,
      commentBody: '@gigi please review this code',
    })

    assert.equal(request.event, 'issue_comment')
    assert.equal(request.payload.comment?.body, '@gigi please review this code')
    assert.equal(request.payload.comment?.user?.login, 'testuser')
  })

  it('should generate merged PR payload', () => {
    const request = pullRequestEvent({
      repo: 'gigi',
      prNumber: 5,
      action: 'closed',
      merged: true,
    })

    assert.equal(request.payload.action, 'closed')
    assert.equal(request.payload.pull_request?.merged, true)
  })
})

describe('Webhook Integration: Routing', () => {
  it('should route an issue opened webhook and create a conversation', async () => {
    const result = await simulateWebhookEvent('issue', {
      repo: 'gigi',
      issueNumber: 42,
      issueTitle: 'New feature request',
      action: 'opened',
    })

    assert.ok(result, 'Route should return a result for issue opened')
    assert.ok(result.conversationId)
    assert.ok(result.tags.includes('gigi'))
    assert.ok(result.tags.includes('gigi#42'))

    // Verify conversation was created in DB
    const conv = await store.getConversation(result.conversationId)
    assert.ok(conv)
    assert.equal(conv.channel, 'webhook')
    assert.ok(conv.topic?.includes('New feature request'))

    // Verify a system message was stored
    const messages = await store.getMessages(result.conversationId)
    assert.ok(messages.length >= 1)
    assert.equal(messages[0].role, 'system')
  })

  it('should route a PR opened webhook and create a conversation with PR tags', async () => {
    const result = await simulateWebhookEvent('pull_request', {
      repo: 'gigi',
      prNumber: 10,
      prTitle: 'Fix integration tests',
      action: 'opened',
    })

    assert.ok(result)
    assert.ok(result.tags.includes('pr#10'))
    assert.ok(result.tags.includes('gigi#10'))

    // Verify the conversation topic
    const conv = await store.getConversation(result.conversationId)
    assert.ok(conv?.topic?.includes('PR #10'))
  })

  it('should route a comment to an existing conversation', async () => {
    // First create a conversation via issue opened
    const initial = await simulateWebhookEvent('issue', {
      repo: 'gigi',
      issueNumber: 42,
      issueTitle: 'Feature X',
      action: 'opened',
    })
    assert.ok(initial)

    // Then route a comment to it
    const comment = await simulateWebhookEvent('issue_comment', {
      repo: 'gigi',
      issueNumber: 42,
      commentBody: 'Great work on this!',
    })

    assert.ok(comment)
    // Should route to the same conversation
    assert.equal(comment.conversationId, initial.conversationId)

    // Should have 2 messages now
    const messages = await store.getMessages(initial.conversationId)
    assert.equal(messages.length, 2)
  })

  it('should auto-close conversation when issue is closed', async () => {
    // Open issue
    const result = await simulateWebhookEvent('issue', {
      repo: 'gigi',
      issueNumber: 99,
      issueTitle: 'Bug fix',
      action: 'opened',
    })
    assert.ok(result)

    // Close issue
    await simulateWebhookEvent('issue', {
      repo: 'gigi',
      issueNumber: 99,
      action: 'closed',
    })

    await assertThreadStatus(result.conversationId, 'stopped')
  })
})
