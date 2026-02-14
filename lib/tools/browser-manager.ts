/**
 * Browser Manager — Headless & interactive browser automation
 *
 * Singleton manager supporting Playwright headless mode and
 * Neko-powered interactive mode with WebSocket relay.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import EventEmitter from 'events'
import sharp from 'sharp'
import WebSocket, { WebSocketServer } from 'ws'

interface BrowserConfig {
  mode: string
  nekoHost: string
  nekoPort: number
  nekoPassword: string
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
  nekoConnection: WebSocket | null = null

  constructor(config: Partial<BrowserConfig> = {}) {
    super()
    this.config = {
      mode: config.mode || 'headless',
      nekoHost: config.nekoHost || 'localhost',
      nekoPort: config.nekoPort || 8080,
      nekoPassword: config.nekoPassword || 'neko',
      wsPort: config.wsPort || 3001,
      screenshotQuality: config.screenshotQuality || 80,
      ...config,
    }
  }

  async initialize(): Promise<this> {
    console.log(`Initializing browser in ${this.config.mode} mode...`)

    if (this.config.mode === 'headless') {
      await this.initializeHeadless()
    } else if (this.config.mode === 'interactive') {
      await this.initializeInteractive()
    } else {
      throw new Error(`Unknown browser mode: ${this.config.mode}`)
    }

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

  private async initializeInteractive(): Promise<void> {
    const nekoWsUrl = `ws://${this.config.nekoHost}:${this.config.nekoPort}/ws`
    this.nekoConnection = new WebSocket(nekoWsUrl)

    return new Promise<void>((resolve, reject) => {
      this.nekoConnection!.on('open', () => {
        console.log('Connected to Neko')
        this.nekoConnection!.send(JSON.stringify({ event: 'login', password: this.config.nekoPassword }))
        resolve()
      })
      this.nekoConnection!.on('error', (err) => {
        console.error('Neko connection error:', err)
        reject(err)
      })
      this.nekoConnection!.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        this.handleNekoMessage(msg)
      })
    })
  }

  private handleNekoMessage(msg: { event: string; data?: unknown }): void {
    switch (msg.event) {
      case 'system/admin':
        console.log('Neko admin access granted')
        break
      case 'screen/resolution':
        this.emit('resolution', msg.data)
        break
      case 'clipboard/update':
        this.emit('clipboard', msg.data)
        break
      default:
        this.emit('neko-message', msg)
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
    const state: Record<string, unknown> = { type: 'init', mode: this.config.mode, connected: true }
    if (this.config.mode === 'headless' && this.page) {
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
      case 'neko-control':
        if (this.config.mode === 'interactive') {
          this.nekoConnection!.send(JSON.stringify(msg.data))
        }
        break
      default:
        throw new Error(`Unknown message type: ${msg.type}`)
    }
    await this.broadcastState()
  }

  async navigate(url: string, options: Record<string, unknown> = {}): Promise<void> {
    if (this.config.mode === 'headless') {
      await this.page!.goto(url, {
        waitUntil: (options.waitUntil as 'networkidle') || 'networkidle',
        timeout: (options.timeout as number) || 30000,
      })
    } else {
      this.nekoConnection!.send(JSON.stringify({ event: 'control/navigate', url }))
    }
  }

  async click(selector: string, options: Record<string, unknown> = {}): Promise<void> {
    if (this.config.mode === 'headless') {
      await this.page!.click(selector, options)
    } else {
      this.emit('warning', 'Click in interactive mode requires element position mapping')
    }
  }

  async type(selector: string, text: string, options: Record<string, unknown> = {}): Promise<void> {
    if (this.config.mode === 'headless') {
      await this.page!.type(selector, text, options)
    } else {
      this.nekoConnection!.send(JSON.stringify({ event: 'control/keyboard', text }))
    }
  }

  async captureScreenshot(options: Record<string, unknown> = {}): Promise<string | Buffer> {
    if (this.config.mode === 'headless') {
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
    } else {
      return new Promise<string>((resolve) => {
        this.nekoConnection!.once('screenshot', (data: string) => resolve(data))
        this.nekoConnection!.send(JSON.stringify({ event: 'screen/shot' }))
      })
    }
  }

  async evaluate(script: string): Promise<unknown> {
    if (this.config.mode === 'headless') {
      return await this.page!.evaluate(script)
    }
    this.emit('warning', 'JavaScript evaluation not available in interactive mode')
    return null
  }

  async getElements(selector: string): Promise<Array<Record<string, unknown>>> {
    if (this.config.mode === 'headless') {
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
    return []
  }

  private async broadcastState(): Promise<void> {
    if (this.wsClients.size === 0) return
    const state: Record<string, unknown> = { type: 'state-update', mode: this.config.mode, timestamp: Date.now() }
    if (this.config.mode === 'headless' && this.page) {
      state.url = this.page.url()
      state.title = await this.page.title()
    }
    const message = JSON.stringify(state)
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(message)
    })
  }

  async switchMode(newMode: string): Promise<void> {
    if (newMode === this.config.mode) return
    console.log(`Switching from ${this.config.mode} to ${newMode} mode`)
    await this.cleanup()
    this.config.mode = newMode
    await this.initialize()
  }

  async cleanup(): Promise<void> {
    if (this.browser) { await this.browser.close(); this.browser = null }
    if (this.nekoConnection) { this.nekoConnection.close(); this.nekoConnection = null }
    if (this.wsServer) {
      this.wsClients.forEach((ws) => ws.close())
      this.wsServer.close()
      this.wsServer = null
    }
  }
}

export const browserManager = new BrowserManager()
