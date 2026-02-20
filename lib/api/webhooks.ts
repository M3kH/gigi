/**
 * API — Gitea Webhook Handler
 *
 * HMAC signature verification, self-event filtering, and event routing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getConfig, checkRecentAction } from '../core/store'
import { handleMessage } from '../core/router'
import { routeWebhook } from './webhookRouter'
import { notifyWebhook } from './webhookNotifier'
import { handlePushDispatch } from './crossRepoDispatch'
import { emit } from '../core/events'

import type { Context } from 'hono'

// ─── Types ──────────────────────────────────────────────────────────

export interface WebhookPayload {
  repository?: { name: string; full_name: string; html_url?: string }
  action?: string // e.g. 'created', 'deleted', 'opened', 'closed'
  issue?: { number: number; title: string; body: string; html_url: string; user?: { login: string }; pull_request?: unknown }
  pull_request?: { title: string; number: number; head?: { ref: string }; base?: { ref: string }; merged: boolean; user?: { login: string }; html_url: string }
  number?: number
  comment?: { body: string; user?: { login: string }; html_url: string }
  commits?: Array<{ id: string; message: string }>
  pusher?: { login: string }
  sender?: { login: string }
  ref?: string
}

export interface WebhookResult {
  conversationId: string
  tags: string[]
  systemMessage: string
  agentInvoked: boolean
}

// ─── Signature Verification ─────────────────────────────────────────

const verifySignature = (payload: string, signature: string, secret: string): boolean => {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    )
  } catch {
    return false
  }
}

// ─── Webhook Handler ────────────────────────────────────────────────

export const handleWebhook = async (c: Context): Promise<Response> => {
  const secret = await getConfig('webhook_secret')
  const body = await c.req.text()
  const signature = c.req.header('x-gitea-signature') || ''
  const event = c.req.header('x-gitea-event') || 'unknown'

  if (secret && !verifySignature(body, signature, secret)) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const payload: WebhookPayload = JSON.parse(body)
  console.log(`Webhook: ${event}`, payload.action || '')

  const isSelfGenerated = await isSelfEvent(event, payload)
  if (isSelfGenerated) {
    console.log(`Skipping self-generated ${event}`)
    return c.json({ ok: true, skipped: 'self-generated' })
  }

  // Cross-repo workflow dispatch (e.g. gigi push → gigi-infra build)
  if (event === 'push' && payload.repository?.name && payload.ref) {
    const commits = payload.commits || []
    const headSha = commits.length > 0 ? commits[commits.length - 1].id : undefined
    handlePushDispatch(payload.repository.name, payload.ref, headSha).catch(err =>
      console.warn('[webhook] Cross-repo dispatch failed:', (err as Error).message)
    )
  }

  // Broadcast to frontend via SSE so the UI updates in real-time
  emit({
    type: 'gitea_event',
    event,
    action: payload.action,
    repo: payload.repository?.name,
  })

  try {
    const result = await routeWebhook(event, payload)

    if (result) {
      console.log(`[webhook] Routed ${event} to conversation ${result.conversationId}`)
      return c.json({
        ok: true,
        processed: event,
        conversationId: result.conversationId,
        tags: result.tags,
      })
    }

    // Telegram notification for unrouted events (routed events are notified inside webhookRouter)
    notifyWebhook(event, payload).catch(err =>
      console.warn('[webhook] Telegram notification failed:', (err as Error).message)
    )

    const summary = summarizeEvent(event, payload)
    if (!summary) return c.json({ ok: true, skipped: true })

    const apiKey = await getConfig('anthropic_api_key')
    if (!apiKey) return c.json({ ok: true, note: 'Claude not configured' })

    await handleMessage('webhook', event, summary)
    return c.json({ ok: true, processed: event, fallback: true })
  } catch (err) {
    console.error('Webhook processing error:', (err as Error).message)
    return c.json({ error: (err as Error).message }, 500)
  }
}

// ─── Self-Event Detection ───────────────────────────────────────────

const isSelfEvent = async (event: string, payload: WebhookPayload): Promise<boolean> => {
  const repo = payload.repository?.name
  if (!repo) return false

  switch (event) {
    case 'issues':
      if (payload.action === 'opened') {
        return await checkRecentAction('create_issue', repo, `${payload.issue?.number}`)
      }
      return false

    case 'issue_comment':
      if (payload.action === 'created') {
        return await checkRecentAction('comment_issue', repo, `${payload.issue?.number}`)
      }
      return false

    case 'pull_request':
      if (payload.action === 'opened') {
        return await checkRecentAction('create_pr', repo, `${payload.number}`)
      }
      return false

    case 'push': {
      const commits = payload.commits || []
      for (const commit of commits) {
        if (await checkRecentAction('git_push', repo, commit.id?.slice(0, 8))) {
          return true
        }
      }
      return false
    }

    default:
      return false
  }
}

// ─── Event Summary ──────────────────────────────────────────────────

const summarizeEvent = (event: string, payload: WebhookPayload): string | null => {
  switch (event) {
    case 'push':
      return `[Gitea Push] ${payload.pusher?.login} pushed ${payload.commits?.length || 0} commits to ${payload.repository?.full_name}:${payload.ref}\n` +
        (payload.commits || []).map((c) => `  - ${c.message.split('\n')[0]}`).join('\n')

    case 'pull_request':
      return `[Gitea PR] ${payload.action}: #${payload.number} "${payload.pull_request?.title}" in ${payload.repository?.full_name}\n` +
        `By ${payload.pull_request?.user?.login} | ${payload.pull_request?.head?.ref} → ${payload.pull_request?.base?.ref}`

    case 'issues':
      return `[Gitea Issue] ${payload.action}: #${payload.issue?.number} "${payload.issue?.title}" in ${payload.repository?.full_name}\n` +
        (payload.issue?.body ? `Body: ${payload.issue.body.slice(0, 500)}` : '')

    case 'issue_comment':
      return `[Gitea Comment] ${payload.action} on #${payload.issue?.number} in ${payload.repository?.full_name}\n` +
        `By ${payload.comment?.user?.login}: ${payload.comment?.body?.slice(0, 500)}`

    default:
      return null
  }
}
