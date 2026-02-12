import { createHmac, timingSafeEqual } from 'node:crypto'
import { getConfig } from './store.js'
import { handleMessage } from './router.js'

const verifySignature = (payload, signature, secret) => {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
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

  const summary = summarizeEvent(event, payload)
  if (!summary) return c.json({ ok: true, skipped: true })

  // Process through the agent loop as a webhook message
  try {
    const apiKey = await getConfig('anthropic_api_key')
    if (!apiKey) return c.json({ ok: true, note: 'Claude not configured' })

    await handleMessage('webhook', event, summary)
    return c.json({ ok: true, processed: event })
  } catch (err) {
    console.error('Webhook processing error:', err.message)
    return c.json({ error: err.message }, 500)
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
