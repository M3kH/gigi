import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { healthCheck } from './health.js'
import { getSetupStatus, setupStep } from './setup.js'
import { handleMessage, newConversation, resumeConversation, stopAgent } from './router.js'
import { subscribe } from './events.js'
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
    const status = c.req.query('status') || undefined
    const tag = c.req.query('tag') || undefined
    const convs = await store.listConversations(channel, 20, { status, tag })
    return c.json(convs)
  })

  app.get('/api/conversations/:id/messages', async (c) => {
    const messages = await store.getMessages(c.req.param('id'))
    return c.json(messages)
  })

  app.get('/api/conversations/:id', async (c) => {
    const conv = await store.getConversation(c.req.param('id'))
    if (!conv) return c.json({ error: 'not found' }, 404)
    return c.json(conv)
  })

  app.patch('/api/conversations/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { tags, status, repo, topic } = body
    if (tags) await store.addTags(id, tags)
    const updates = {}
    if (status) updates.status = status
    if (repo) updates.repo = repo
    if (topic) updates.topic = topic
    if (Object.keys(updates).length) await store.updateConversation(id, updates)
    const conv = await store.getConversation(id)
    return c.json(conv)
  })

  // Title edit endpoint
  app.patch('/api/conversations/:id/title', async (c) => {
    const id = c.req.param('id')
    const { title } = await c.req.json()
    if (!title) return c.json({ error: 'title required' }, 400)
    await store.updateConversation(id, { topic: title })
    return c.json({ ok: true })
  })

  app.post('/api/conversations/:id/close', async (c) => {
    await store.closeConversation(c.req.param('id'))
    return c.json({ ok: true })
  })

  app.delete('/api/conversations/:id', async (c) => {
    await store.deleteConversation(c.req.param('id'))
    return c.json({ ok: true })
  })

  app.post('/api/conversations/new', async (c) => {
    newConversation('web', 'default')
    return c.json({ ok: true })
  })

  // Token usage stats for a conversation
  app.get('/api/conversations/:id/usage', async (c) => {
    const usage = await store.getConversationUsage(c.req.param('id'))
    return c.json(usage)
  })

  // Stop a running agent
  app.post('/api/conversations/:id/stop', async (c) => {
    const convId = c.req.param('id')
    const stopped = stopAgent(convId)
    return c.json({ ok: true, stopped })
  })

  // SSE event stream — persistent connection, receives all agent events
  app.get('/api/events', (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (data) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch {}
        }

        // Subscribe to event bus
        const unsubscribe = subscribe(send)

        // Keepalive every 30s
        const keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch {}
        }, 30000)

        // Cleanup on close
        c.req.raw.signal.addEventListener('abort', () => {
          unsubscribe()
          clearInterval(keepalive)
          try { controller.close() } catch {}
        })
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable Nginx buffering if behind proxy
      }
    })
  })

  // Async chat — fire-and-forget, events flow through SSE
  app.post('/api/chat/send', async (c) => {
    const { message, conversationId } = await c.req.json()
    if (!message) return c.json({ error: 'message required' }, 400)

    const channelId = conversationId || 'default'

    // Resume a specific conversation if ID provided
    if (conversationId) {
      resumeConversation('web', channelId, conversationId)
    }

    // Fire and forget — don't await
    handleMessage('web', channelId, message).catch(err => {
      console.error('[web] async chat error:', err.message)
    })

    return c.json({ ok: true })
  })

  // Legacy sync chat endpoint (backward compat)
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

  // Legacy stream endpoint (backward compat)
  app.post('/api/chat/stream', async (c) => {
    const { message } = await c.req.json()
    if (!message) return c.json({ error: 'message required' }, 400)

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial event
          controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'))

          // Get response
          const response = await handleMessage('web', 'default', message)

          // Stream response in chunks
          const text = response.text || ''
          const chunkSize = 20
          for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.slice(i, i + chunkSize)
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`))
            // Small delay to simulate streaming
            await new Promise(resolve => setTimeout(resolve, 10))
          }

          controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'))
          controller.close()
        } catch (err) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable Nginx buffering if behind proxy
      }
    })
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

  // Browser control UI
  app.get('/browser', async (c) => {
    const html = await readFile('web/browser-control.html', 'utf-8')
    return c.html(html)
  })

  return app
}
