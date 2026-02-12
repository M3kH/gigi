import { createHmac, timingSafeEqual } from 'node:crypto'
import { getConfig, checkRecentAction } from './store.js'
import { handleMessage } from './router.js'
import { routeWebhook } from './lib/webhookRouter.js'

const verifySignature = (payload, signature, secret) => {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  try {
    // Both signature and expected are hex strings, compare as buffers
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    )
  } catch {
    return false
  }
}

export const handleWebhook = async (c) => {
  const secret = await getConfig('webhook_secret')
  const body = await c.req.text()
  const signature = c.req.header('x-gitea-signature') || ''
  const event = c.req.header('x-gitea-event') || 'unknown'

  if (secret && !verifySignature(body, signature, secret)) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const payload = JSON.parse(body)
  console.log(`Webhook: ${event}`, payload.action || '')

  // Filter self-generated events
  const isSelfGenerated = await isSelfEvent(event, payload)
  if (isSelfGenerated) {
    console.log(`Skipping self-generated ${event}`)
    return c.json({ ok: true, skipped: 'self-generated' })
  }

  // Route webhook to chat context
  try {
    const result = await routeWebhook(event, payload)

    if (result) {
      console.log(`[webhook] Routed ${event} to conversation ${result.conversationId}`)
      return c.json({
        ok: true,
        processed: event,
        conversationId: result.conversationId,
        tags: result.tags
      })
    }

    // Fallback: if no chat routing, process through agent as before
    const summary = summarizeEvent(event, payload)
    if (!summary) return c.json({ ok: true, skipped: true })

    const apiKey = await getConfig('anthropic_api_key')
    if (!apiKey) return c.json({ ok: true, note: 'Claude not configured' })

    await handleMessage('webhook', event, summary)
    return c.json({ ok: true, processed: event, fallback: true })
  } catch (err) {
    console.error('Webhook processing error:', err.message)
    return c.json({ error: err.message }, 500)
  }
}

const isSelfEvent = async (event, payload) => {
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

    case 'push':
      // Check if push matches recent commit
      const commits = payload.commits || []
      for (const commit of commits) {
        if (await checkRecentAction('git_push', repo, commit.id?.slice(0, 8))) {
          return true
        }
      }
      return false

    default:
      return false
  }
}

const summarizeEvent = (event, payload) => {
  switch (event) {
    case 'push':
      return `[Gitea Push] ${payload.pusher?.login} pushed ${payload.commits?.length || 0} commits to ${payload.repository?.full_name}:${payload.ref}\n` +
        (payload.commits || []).map(c => `  - ${c.message.split('\n')[0]}`).join('\n')

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
      return null // Ignore other events
  }
}
