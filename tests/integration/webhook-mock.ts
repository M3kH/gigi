/**
 * Webhook Mock — Generate valid Gitea webhook payloads with HMAC-SHA256 signatures
 *
 * Covers: issues/opened, issue_comment/created, pull_request/opened,
 * pull_request_review_comment/created, pull_request/closed+merged, push
 */

import { createHmac } from 'node:crypto'
import type { WebhookPayload } from '../../lib/api/webhooks'

// ─── Types ──────────────────────────────────────────────────────────

export interface WebhookRequest {
  event: string
  payload: WebhookPayload
  body: string
  signature: string
  headers: Record<string, string>
}

export interface WebhookOptions {
  repo?: string
  repoFullName?: string
  action?: string
  issueNumber?: number
  issueTitle?: string
  issueBody?: string
  prNumber?: number
  prTitle?: string
  prBranch?: string
  baseBranch?: string
  merged?: boolean
  commentBody?: string
  author?: string
  secret?: string
  commits?: Array<{ id: string; message: string }>
  ref?: string
}

// ─── Defaults ───────────────────────────────────────────────────────

const DEFAULT_REPO = 'test-repo'
const DEFAULT_SECRET = 'test-webhook-secret'
const DEFAULT_AUTHOR = 'testuser'

// ─── Signature Generation ───────────────────────────────────────────

export const signPayload = (body: string, secret: string): string => {
  return createHmac('sha256', secret).update(body).digest('hex')
}

// ─── Payload Factories ──────────────────────────────────────────────

const baseRepo = (opts: WebhookOptions) => ({
  name: opts.repo || DEFAULT_REPO,
  full_name: opts.repoFullName || `idea/${opts.repo || DEFAULT_REPO}`,
  html_url: `http://localhost:3000/idea/${opts.repo || DEFAULT_REPO}`,
})

const baseUser = (opts: WebhookOptions) => ({
  login: opts.author || DEFAULT_AUTHOR,
})

/**
 * Generate an issues webhook event.
 */
export const issueEvent = (opts: WebhookOptions = {}): WebhookRequest => {
  const action = opts.action || 'opened'
  const payload: WebhookPayload = {
    action,
    repository: baseRepo(opts),
    issue: {
      number: opts.issueNumber || 1,
      title: opts.issueTitle || 'Test Issue',
      body: opts.issueBody || 'Test issue body',
      html_url: `http://localhost:3000/idea/${opts.repo || DEFAULT_REPO}/issues/${opts.issueNumber || 1}`,
      user: baseUser(opts),
    },
  }
  return buildRequest('issues', payload, opts.secret || DEFAULT_SECRET)
}

/**
 * Generate an issue_comment webhook event.
 */
export const issueCommentEvent = (opts: WebhookOptions = {}): WebhookRequest => {
  const payload: WebhookPayload = {
    action: opts.action || 'created',
    repository: baseRepo(opts),
    issue: {
      number: opts.issueNumber || 1,
      title: opts.issueTitle || 'Test Issue',
      body: opts.issueBody || '',
      html_url: `http://localhost:3000/idea/${opts.repo || DEFAULT_REPO}/issues/${opts.issueNumber || 1}`,
      user: baseUser(opts),
    },
    comment: {
      body: opts.commentBody || 'Test comment',
      user: baseUser(opts),
      html_url: `http://localhost:3000/idea/${opts.repo || DEFAULT_REPO}/issues/${opts.issueNumber || 1}#comment-1`,
    },
  }
  return buildRequest('issue_comment', payload, opts.secret || DEFAULT_SECRET)
}

/**
 * Generate a pull_request webhook event.
 */
export const pullRequestEvent = (opts: WebhookOptions = {}): WebhookRequest => {
  const action = opts.action || 'opened'
  const prNum = opts.prNumber || 1
  const payload: WebhookPayload = {
    action,
    repository: baseRepo(opts),
    number: prNum,
    pull_request: {
      number: prNum,
      title: opts.prTitle || 'Test PR',
      head: { ref: opts.prBranch || 'feat/test' },
      base: { ref: opts.baseBranch || 'main' },
      merged: opts.merged || false,
      user: baseUser(opts),
      html_url: `http://localhost:3000/idea/${opts.repo || DEFAULT_REPO}/pulls/${prNum}`,
    },
  }
  return buildRequest('pull_request', payload, opts.secret || DEFAULT_SECRET)
}

/**
 * Generate a pull_request_review_comment webhook event.
 */
export const prReviewCommentEvent = (opts: WebhookOptions = {}): WebhookRequest => {
  const prNum = opts.prNumber || 1
  const payload: WebhookPayload = {
    action: opts.action || 'created',
    repository: baseRepo(opts),
    pull_request: {
      number: prNum,
      title: opts.prTitle || 'Test PR',
      head: { ref: opts.prBranch || 'feat/test' },
      base: { ref: opts.baseBranch || 'main' },
      merged: false,
      user: baseUser(opts),
      html_url: `http://localhost:3000/idea/${opts.repo || DEFAULT_REPO}/pulls/${prNum}`,
    },
    comment: {
      body: opts.commentBody || 'Review comment',
      user: baseUser(opts),
      html_url: `http://localhost:3000/idea/${opts.repo || DEFAULT_REPO}/pulls/${prNum}#comment-1`,
    },
  }
  return buildRequest('pull_request_review_comment', payload, opts.secret || DEFAULT_SECRET)
}

/**
 * Generate a push webhook event.
 */
export const pushEvent = (opts: WebhookOptions = {}): WebhookRequest => {
  const payload: WebhookPayload = {
    repository: baseRepo(opts),
    ref: opts.ref || 'refs/heads/main',
    pusher: baseUser(opts),
    commits: opts.commits || [
      { id: 'abc1234def5678', message: 'Test commit' },
    ],
  }
  return buildRequest('push', payload, opts.secret || DEFAULT_SECRET)
}

/**
 * Generate a @gigi mention in an issue comment.
 */
export const gigiMentionEvent = (opts: WebhookOptions = {}): WebhookRequest => {
  return issueCommentEvent({
    ...opts,
    commentBody: opts.commentBody || '@gigi What do you think about this?',
    author: opts.author || 'mauro',
  })
}

// ─── Request Builder ────────────────────────────────────────────────

const buildRequest = (event: string, payload: WebhookPayload, secret: string): WebhookRequest => {
  const body = JSON.stringify(payload)
  const signature = signPayload(body, secret)
  return {
    event,
    payload,
    body,
    signature,
    headers: {
      'content-type': 'application/json',
      'x-gitea-event': event,
      'x-gitea-signature': signature,
    },
  }
}

// ─── Verification Helper ────────────────────────────────────────────

/**
 * Verify that a signature matches the payload.
 * Useful for testing the verification logic itself.
 */
export const verifySignature = (body: string, signature: string, secret: string): boolean => {
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  return signature === expected
}
