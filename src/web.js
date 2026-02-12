import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { healthCheck } from './health.js'
import { getSetupStatus, setupStep } from './setup.js'
import { handleMessage, newConversation } from './router.js'
import { handleWebhook } from './webhooks.js'
import * as store from './store.js'

export const createApp = () => {
  const app = new Hono()

  // Health
  app.get('/health', async (c) => {
    const status = await healthCheck()
    return c.json(status, status.ok ? 200 : 503)
  })

  // Setup API
  app.get('/api/setup/status', async (c) => {
    const status = await getSetupStatus()
    return c.json(status)
  })

  app.post('/api/setup/:step', async (c) => {
    const step = c.req.param('step')
    const data = await c.req.json()
    const result = await setupStep(step, data)
    return c.json(result, result.ok ? 200 : 400)
  })

  // Chat API
  app.get('/api/conversations', async (c) => {
    const channel = c.req.query('channel') || null
    const convs = await store.listConversations(channel)
    return c.json(convs)
  })

  app.get('/api/conversations/:id/messages', async (c) => {
    const messages = await store.getMessages(c.req.param('id'))
    return c.json(messages)
  })

  app.post('/api/conversations/new', async (c) => {
    newConversation('web', 'default')
    return c.json({ ok: true })
  })

  app.post('/api/chat', async (c) => {
    const { message } = await c.req.json()
    if (!message) return c.json({ error: 'message required' }, 400)

    try {
      const response = await handleMessage('web', 'default', message)
      return c.json({ response: response.text })
    } catch (err) {
      return c.json({ error: err.message }, 500)
    }
  })

  // Webhook endpoint
  app.post('/webhook/gitea', handleWebhook)

  // Serve web UI
  app.get('/', async (c) => {
    const status = await getSetupStatus()
    const file = status.claude ? 'web/index.html' : 'web/setup.html'
    const html = await readFile(file, 'utf-8')
    return c.html(html)
  })

  app.get('/setup', async (c) => {
    const html = await readFile('web/setup.html', 'utf-8')
    return c.html(html)
  })

  app.use('/static/*', serveStatic({ root: './' }))

  return app
}
