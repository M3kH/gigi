/**
 * Browser Manager — Headless browser automation
 *
 * Singleton manager supporting Playwright headless mode.
 * Interactive browser access is provided via Chrome DevTools Protocol (CDP)
 * through the chrome-devtools MCP server — not managed here.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import EventEmitter from 'events'
import sharp from 'sharp'
import WebSocket, { WebSocketServer } from 'ws'

interface BrowserConfig {
  wsPort: number
  screenshotQuality: number
  interceptRequests?: boolean
  [key: string]: unknown
}

export class BrowserManager extends EventEmitter {
  config: BrowserConfig
  browser: Browser | null = null
  context: BrowserContext | null = null
  page: Page | null = null
  wsServer: WebSocketServer | null = null
  wsClients: Set<WebSocket> = new Set()

  constructor(config: Partial<BrowserConfig> = {}) {
    super()
    this.config = {
      wsPort: config.wsPort || 3001,
      screenshotQuality: config.screenshotQuality || 80,
      ...config,
    }
  }

  async initialize(): Promise<this> {
    console.log('Initializing headless browser...')
    await this.initializeHeadless()
    await this.startWebSocketServer()
    return this
  }

  private async initializeHeadless(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process',
        '--disable-web-security',
      ],
    })

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    })

    this.page = await this.context.newPage()
    this.page.on('console', (msg) => this.emit('console', msg))
    this.page.on('pageerror', (err) => this.emit('error', err))
    this.page.on('request', (req) => this.emit('request', req))
    this.page.on('response', (res) => this.emit('response', res))

    if (this.config.interceptRequests) {
      await this.page.route('**/*', async (route) => {
        this.emit('intercept', route.request())
        await route.continue()
      })
    }
  }

  private async startWebSocketServer(): Promise<void> {
    this.wsServer = new WebSocketServer({ port: this.config.wsPort })
    this.wsServer.on('connection', (ws) => {
      console.log('New WebSocket client connected')
      this.wsClients.add(ws)
      this.sendInitialState(ws)

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString())
          await this.handleClientMessage(ws, msg)
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: (err as Error).message }))
        }
      })

      ws.on('close', () => { this.wsClients.delete(ws) })
    })
    console.log(`WebSocket server listening on port ${this.config.wsPort}`)
  }

  private async sendInitialState(ws: WebSocket): Promise<void> {
    const state: Record<string, unknown> = { type: 'init', mode: 'headless', connected: true }
    if (this.page) {
      state.url = this.page.url()
      state.title = await this.page.title()
      state.screenshot = await this.captureScreenshot()
    }
    ws.send(JSON.stringify(state))
  }

  private async handleClientMessage(ws: WebSocket, msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'navigate': await this.navigate(msg.url as string, msg.options as Record<string, unknown>); break
      case 'click': await this.click(msg.selector as string, msg.options as Record<string, unknown>); break
      case 'type': await this.type(msg.selector as string, msg.text as string, msg.options as Record<string, unknown>); break
      case 'screenshot': {
        const ss = await this.captureScreenshot(msg.options as Record<string, unknown>)
        ws.send(JSON.stringify({ type: 'screenshot', data: ss }))
        break
      }
      case 'evaluate': {
        const result = await this.evaluate(msg.script as string)
        ws.send(JSON.stringify({ type: 'result', data: result }))
        break
      }
      case 'get-elements': {
        const elements = await this.getElements(msg.selector as string)
        ws.send(JSON.stringify({ type: 'elements', data: elements }))
        break
      }
      default:
        throw new Error(`Unknown message type: ${msg.type}`)
    }
    await this.broadcastState()
  }

  async navigate(url: string, options: Record<string, unknown> = {}): Promise<void> {
    await this.page!.goto(url, {
      waitUntil: (options.waitUntil as 'networkidle') || 'networkidle',
      timeout: (options.timeout as number) || 30000,
    })
  }

  async click(selector: string, options: Record<string, unknown> = {}): Promise<void> {
    await this.page!.click(selector, options)
  }

  async type(selector: string, text: string, options: Record<string, unknown> = {}): Promise<void> {
    await this.page!.type(selector, text, options)
  }

  async captureScreenshot(options: Record<string, unknown> = {}): Promise<string | Buffer> {
    const buffer = await this.page!.screenshot({
      fullPage: (options.fullPage as boolean) || false,
      type: 'jpeg',
      quality: this.config.screenshotQuality,
    })

    if (options.compress) {
      return await sharp(buffer)
        .resize((options.width as number) || 1920)
        .jpeg({ quality: (options.quality as number) || 70 })
        .toBuffer()
    }
    return buffer.toString('base64')
  }

  async evaluate(script: string): Promise<unknown> {
    return await this.page!.evaluate(script)
  }

  async getElements(selector: string): Promise<Array<Record<string, unknown>>> {
    return await this.page!.evaluate((sel: string) => {
      const elements = document.querySelectorAll(sel)
      return Array.from(elements).map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          tagName: el.tagName,
          text: el.textContent,
          href: (el as HTMLAnchorElement).href,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }
      })
    }, selector)
  }

  private async broadcastState(): Promise<void> {
    if (this.wsClients.size === 0) return
    const state: Record<string, unknown> = { type: 'state-update', mode: 'headless', timestamp: Date.now() }
    if (this.page) {
      state.url = this.page.url()
      state.title = await this.page.title()
    }
    const message = JSON.stringify(state)
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(message)
    })
  }

  async cleanup(): Promise<void> {
    if (this.browser) { await this.browser.close(); this.browser = null }
    if (this.wsServer) {
      this.wsClients.forEach((ws) => ws.close())
      this.wsServer.close()
      this.wsServer = null
    }
  }
}

export const browserManager = new BrowserManager()
