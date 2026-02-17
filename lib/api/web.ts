/**
 * API — Web Server (Hono)
 *
 * HTTP endpoints for health, setup, conversations, chat,
 * webhooks, and static file serving.
 */

import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { healthCheck } from '../core/health'
import { getSetupStatus, setupStep } from '../domain/setup'
import { handleMessage, newConversation, resumeConversation, stopAgent, getRunningAgents } from '../core/router'
import { getBackupStatus, runBackup } from '../backup'
import { handleWebhook } from './webhooks'
import { createGiteaProxy } from './gitea-proxy'
import { askUser } from '../core/ask-user'
import * as store from '../core/store'

export const createApp = (): Hono => {
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
    const { tags, status: bodyStatus, repo, topic } = body
    if (tags) await store.addTags(id, tags)
    const updates: store.ConversationUpdate = {}
    if (bodyStatus) updates.status = bodyStatus
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

  app.post('/api/conversations/new', async () => {
    newConversation('web', 'default')
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
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

  // Running agents (for UI reconnect after SSE drop)
  app.get('/api/agents/running', (c) => {
    return c.json(getRunningAgents())
  })

  // Async chat — fire-and-forget, events flow through WebSocket
  app.post('/api/chat/send', async (c) => {
    const { message, conversationId, context } = await c.req.json()
    if (!message) return c.json({ error: 'message required' }, 400)

    let resolvedConvId = conversationId
    const channelId = conversationId || 'default'

    if (conversationId) {
      resumeConversation('web', channelId, conversationId)
    } else {
      // Create conversation upfront so we can return the ID immediately
      const conv = await store.createConversation('web', null)
      resolvedConvId = conv.id
      resumeConversation('web', channelId, resolvedConvId)
    }

    handleMessage('web', channelId, message, null, context).catch((err) => {
      console.error('[web] async chat error:', (err as Error).message)
    })

    return c.json({ ok: true, conversationId: resolvedConvId })
  })

  // Legacy sync chat endpoint (backward compat)
  app.post('/api/chat', async (c) => {
    const { message } = await c.req.json()
    if (!message) return c.json({ error: 'message required' }, 400)

    try {
      const response = await handleMessage('web', 'default', message)
      return c.json({ response: response.text })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  // Legacy stream endpoint (backward compat)
  app.post('/api/chat/stream', async (c) => {
    const { message } = await c.req.json()
    if (!message) return c.json({ error: 'message required' }, 400)

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'))
          const response = await handleMessage('web', 'default', message)
          const text = response.text || ''
          const chunkSize = 20
          for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.slice(i, i + chunkSize)
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`))
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'))
          controller.close()
        } catch (err) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: (err as Error).message })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  })

  // Browser status (noVNC availability + auto-connect URL)
  app.get('/api/browser/status', async (c) => {
    const browserMode = process.env.BROWSER_MODE || 'headless'
    const viewUrl = process.env.BROWSER_VIEW_URL

    if (!viewUrl || browserMode === 'headless') {
      return c.json({ available: false })
    }

    // Selenium standalone serves a self-contained noVNC viewer on port 7900.
    // Caddy routes /browser/* directly to browser:7900, stripping the prefix.
    const browserUrl = `${viewUrl}?autoconnect=true&resize=scale`

    return c.json({
      mode: browserMode,
      browserUrl,
      available: true,
    })
  })

  // Internal: ask-user bridge (MCP process → main process → frontend)
  app.post('/api/internal/ask-user', async (c) => {
    const body = await c.req.json<{ questionId: string; question: string; options?: string[] }>()
    const { questionId, question, options } = body

    if (!questionId || !question) {
      return c.json({ error: 'questionId and question are required' }, 400)
    }

    // Find the active conversation from running agents
    const running = getRunningAgents()
    const conversationId = running.length > 0 ? running[0] : undefined

    const answer = await askUser(questionId, question, options, conversationId)
    return c.json({ answer })
  })

  // Backup system status + manual trigger
  app.get('/api/backup/status', (c) => {
    const status = getBackupStatus()
    return c.json({
      running: status.running,
      schedulerActive: status.schedulerActive,
      lastRun: status.lastRun,
      config: status.config ? {
        sources: status.config.sources.length,
        targets: status.config.targets.length,
        interval: status.config.schedule.interval,
      } : null,
    })
  })

  app.post('/api/backup/trigger', async (c) => {
    const status = getBackupStatus()
    if (status.running) {
      return c.json({ error: 'backup already in progress' }, 409)
    }
    // Fire and forget — runs in background
    runBackup().catch(err => {
      console.error('[api:backup] manual trigger failed:', err)
    })
    return c.json({ ok: true, message: 'backup started' })
  })

  // Gitea proxy endpoints (for frontend SPA)
  app.route('/api/gitea', createGiteaProxy())

  // Webhook endpoint
  app.post('/webhook/gitea', handleWebhook)

  // Setup page
  app.get('/setup', async (c) => {
    const html = await readFile('web/setup.html', 'utf-8')
    return c.html(html)
  })

  // Legacy static assets
  app.use('/static/*', serveStatic({ root: './' }))

  // Browser view is handled directly by Caddy → browser:7900 (noVNC)
  // No Hono proxy needed — Caddy handles HTTP + WebSocket natively

  // Legacy vanilla UI (deprecated — kept at /legacy for backward compat)
  app.get('/legacy', async (c) => {
    const html = await readFile('web/index.html', 'utf-8')
    return c.html(html)
  })

  // ── Svelte SPA (primary UI) ─────────────────────────────────────────
  // Vite builds to dist/app/ — serve all static assets (JS, CSS, images, etc.)
  // Falls through to next handler when file not found
  app.use('/*', serveStatic({ root: './dist/app' }))

  app.use('/shoelace/*', serveStatic({
    root: './node_modules/@shoelace-style/shoelace/dist',
    rewriteRequestPath: (p: string) => p.replace('/shoelace', ''),
  }))

  // Serve the Svelte SPA (onboarding is handled client-side)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serveSPA = async (c: any) => {
    const html = await readFile('dist/app/index.html', 'utf-8').catch(() => null)
    if (!html) {
      // Fallback to legacy UI if SPA not built yet
      const legacy = await readFile('web/index.html', 'utf-8')
      return c.html(legacy)
    }
    return c.html(html)
  }

  // ── Gitea UI proxy (iframe embedding) ──────────────────────────────
  // Forwards /gitea/* to Gitea (which serves at /gitea/ subpath via ROOT_URL)
  // Injects auth token so the user appears logged in
  app.all('/gitea/*', async (c) => {
    const giteaUrl = process.env.GITEA_URL || await store.getConfig('gitea_url') || 'http://192.168.1.80:3000'
    const giteaToken = process.env.GITEA_TOKEN || await store.getConfig('gitea_token')
    const giteaPassword = process.env.GITEA_PASSWORD || await store.getConfig('gitea_password')
    const path = c.req.path.replace(/^\/gitea/, '') || '/'
    const query = c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?')) : ''
    const targetUrl = `${giteaUrl}${path}${query}`

    const headers = new Headers()
    // Forward relevant headers
    for (const key of ['cookie', 'content-type', 'accept', 'accept-language', 'x-csrf-token']) {
      const val = c.req.header(key)
      if (val) headers.set(key, val)
    }

    // Reverse proxy auth — Gitea trusts X-WEBAUTH-USER for session creation
    // The iframe shows the human user's session (admin), not the AI (gigi)
    const adminUser = process.env.ADMIN_USER || await store.getConfig('admin_user') || 'mauro'
    headers.set('X-WEBAUTH-USER', adminUser)

    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
    const body = hasBody ? await c.req.arrayBuffer() : undefined
    const resp = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body,
      redirect: 'manual',
    })

    // Forward response headers (use append for Set-Cookie)
    const respHeaders = new Headers()
    const skipHeaders = new Set(['transfer-encoding', 'content-encoding'])
    for (const [k, v] of resp.headers.entries()) {
      if (skipHeaders.has(k.toLowerCase())) continue
      if (k.toLowerCase() === 'location') {
        // Gitea redirects use ROOT_URL paths (e.g. /gitea/idea/repo)
        // which already match our proxy prefix — pass through as-is
        respHeaders.set(k, v)
      } else if (k.toLowerCase() === 'set-cookie') {
        respHeaders.append(k, v)
      } else {
        respHeaders.set(k, v)
      }
    }

    // Gitea pages are missing the footer (index.js + closing tags) due to a
    // custom template override. For HTML responses, buffer the body and append
    // the missing script tag so Vue components (Actions log viewer etc.) work.
    const contentType = resp.headers.get('content-type') || ''
    if (contentType.includes('text/html') && c.req.method === 'GET') {
      const html = await resp.text()
      if (!html.includes('/js/index.js') && html.includes('<!DOCTYPE html')) {
        // Extract asset version from the page (e.g. from webcomponents.js?v=1.24.7)
        const versionMatch = html.match(/assets\/js\/webcomponents\.js\?v=([^"&]+)/)
        const version = versionMatch?.[1] || '1.24.7'
        const assetPrefix = '/gitea/assets'
        const footer = `\n<script src="${assetPrefix}/js/index.js?v=${version}"></script>\n</body>\n</html>`
        respHeaders.delete('content-length')
        return new Response(html + footer, {
          status: resp.status,
          headers: respHeaders,
        })
      }
      return new Response(html, { status: resp.status, headers: respHeaders })
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders,
    })
  })

  // Root route — now serves the Svelte app
  app.get('/', async (c) => serveSPA(c))

  // SPA catch-all — serves index.html for any unmatched GET route (client-side routing)
  app.get('*', async (c) => serveSPA(c))

  return app
}
