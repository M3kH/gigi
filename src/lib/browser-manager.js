import { chromium } from 'playwright';
import EventEmitter from 'events';
import sharp from 'sharp';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

/**
 * BrowserManager handles both headless automation and interactive browser sessions
 * Supports switching between headless mode and Neko-powered interactive mode
 */
export class BrowserManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      mode: config.mode || 'headless', // 'headless' or 'interactive'
      nekoHost: config.nekoHost || 'localhost',
      nekoPort: config.nekoPort || 8080,
      nekoPassword: config.nekoPassword || 'neko',
      wsPort: config.wsPort || 3001,
      screenshotQuality: config.screenshotQuality || 80,
      ...config
    };

    this.browser = null;
    this.context = null;
    this.page = null;
    this.wsServer = null;
    this.wsClients = new Set();
    this.nekoConnection = null;
  }

  /**
   * Initialize browser based on configured mode
   */
  async initialize() {
    console.log(`Initializing browser in ${this.config.mode} mode...`);

    if (this.config.mode === 'headless') {
      await this.initializeHeadless();
    } else if (this.config.mode === 'interactive') {
      await this.initializeInteractive();
    } else {
      throw new Error(`Unknown browser mode: ${this.config.mode}`);
    }

    // Start WebSocket server for real-time updates
    await this.startWebSocketServer();

    return this;
  }

  /**
   * Initialize headless browser with Playwright
   */
  async initializeHeadless() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-web-security'
      ]
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    });

    this.page = await this.context.newPage();

    // Set up event listeners
    this.page.on('console', msg => this.emit('console', msg));
    this.page.on('pageerror', err => this.emit('error', err));
    this.page.on('request', req => this.emit('request', req));
    this.page.on('response', res => this.emit('response', res));

    // Enable request interception if needed
    if (this.config.interceptRequests) {
      await this.page.route('**/*', async route => {
        const request = route.request();
        this.emit('intercept', request);
        await route.continue();
      });
    }
  }

  /**
   * Initialize interactive browser session with Neko
   */
  async initializeInteractive() {
    // Connect to Neko WebSocket for control
    const nekoWsUrl = `ws://${this.config.nekoHost}:${this.config.nekoPort}/ws`;

    this.nekoConnection = new WebSocket(nekoWsUrl);

    return new Promise((resolve, reject) => {
      this.nekoConnection.on('open', () => {
        console.log('Connected to Neko');

        // Authenticate with Neko
        this.nekoConnection.send(JSON.stringify({
          event: 'login',
          password: this.config.nekoPassword
        }));

        resolve();
      });

      this.nekoConnection.on('error', err => {
        console.error('Neko connection error:', err);
        reject(err);
      });

      this.nekoConnection.on('message', data => {
        const msg = JSON.parse(data.toString());
        this.handleNekoMessage(msg);
      });
    });
  }

  /**
   * Handle messages from Neko
   */
  handleNekoMessage(msg) {
    switch (msg.event) {
      case 'system/admin':
        console.log('Neko admin access granted');
        break;
      case 'screen/resolution':
        this.emit('resolution', msg.data);
        break;
      case 'clipboard/update':
        this.emit('clipboard', msg.data);
        break;
      default:
        this.emit('neko-message', msg);
    }
  }

  /**
   * Start WebSocket server for client connections
   */
  async startWebSocketServer() {
    this.wsServer = new WebSocket.Server({
      port: this.config.wsPort
    });

    this.wsServer.on('connection', (ws, req) => {
      console.log('New WebSocket client connected');
      this.wsClients.add(ws);

      // Send initial state
      this.sendInitialState(ws);

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleClientMessage(ws, msg);
        } catch (err) {
          console.error('Error handling client message:', err);
          ws.send(JSON.stringify({
            type: 'error',
            error: err.message
          }));
        }
      });

      ws.on('close', () => {
        this.wsClients.delete(ws);
      });
    });

    console.log(`WebSocket server listening on port ${this.config.wsPort}`);
  }

  /**
   * Send initial state to newly connected client
   */
  async sendInitialState(ws) {
    const state = {
      type: 'init',
      mode: this.config.mode,
      connected: true
    };

    if (this.config.mode === 'headless' && this.page) {
      state.url = this.page.url();
      state.title = await this.page.title();
      state.screenshot = await this.captureScreenshot();
    }

    ws.send(JSON.stringify(state));
  }

  /**
   * Handle messages from WebSocket clients
   */
  async handleClientMessage(ws, msg) {
    console.log('Client message:', msg.type);

    switch (msg.type) {
      case 'navigate':
        await this.navigate(msg.url, msg.options);
        break;

      case 'click':
        await this.click(msg.selector, msg.options);
        break;

      case 'type':
        await this.type(msg.selector, msg.text, msg.options);
        break;

      case 'screenshot':
        const screenshot = await this.captureScreenshot(msg.options);
        ws.send(JSON.stringify({
          type: 'screenshot',
          data: screenshot
        }));
        break;

      case 'evaluate':
        const result = await this.evaluate(msg.script);
        ws.send(JSON.stringify({
          type: 'result',
          data: result
        }));
        break;

      case 'get-elements':
        const elements = await this.getElements(msg.selector);
        ws.send(JSON.stringify({
          type: 'elements',
          data: elements
        }));
        break;

      case 'neko-control':
        if (this.config.mode === 'interactive') {
          this.nekoConnection.send(JSON.stringify(msg.data));
        }
        break;

      default:
        throw new Error(`Unknown message type: ${msg.type}`);
    }

    // Broadcast state update to all clients
    await this.broadcastState();
  }

  /**
   * Navigate to URL
   */
  async navigate(url, options = {}) {
    if (this.config.mode === 'headless') {
      await this.page.goto(url, {
        waitUntil: options.waitUntil || 'networkidle',
        timeout: options.timeout || 30000
      });
    } else {
      // Send navigation command to Neko
      this.nekoConnection.send(JSON.stringify({
        event: 'control/navigate',
        url: url
      }));
    }
  }

  /**
   * Click element
   */
  async click(selector, options = {}) {
    if (this.config.mode === 'headless') {
      await this.page.click(selector, options);
    } else {
      // Get element position and send click to Neko
      // This would require Neko API extension
      this.emit('warning', 'Click in interactive mode requires element position mapping');
    }
  }

  /**
   * Type text into element
   */
  async type(selector, text, options = {}) {
    if (this.config.mode === 'headless') {
      await this.page.type(selector, text, options);
    } else {
      // Send keyboard input to Neko
      this.nekoConnection.send(JSON.stringify({
        event: 'control/keyboard',
        text: text
      }));
    }
  }

  /**
   * Capture screenshot
   */
  async captureScreenshot(options = {}) {
    if (this.config.mode === 'headless') {
      const buffer = await this.page.screenshot({
        fullPage: options.fullPage || false,
        type: 'jpeg',
        quality: this.config.screenshotQuality
      });

      // Optionally compress with sharp
      if (options.compress) {
        return await sharp(buffer)
          .resize(options.width || 1920)
          .jpeg({ quality: options.quality || 70 })
          .toBuffer();
      }

      return buffer.toString('base64');
    } else {
      // Request screenshot from Neko
      return new Promise((resolve) => {
        this.nekoConnection.once('screenshot', (data) => {
          resolve(data);
        });
        this.nekoConnection.send(JSON.stringify({
          event: 'screen/shot'
        }));
      });
    }
  }

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate(script) {
    if (this.config.mode === 'headless') {
      return await this.page.evaluate(script);
    } else {
      this.emit('warning', 'JavaScript evaluation not available in interactive mode');
      return null;
    }
  }

  /**
   * Get element information
   */
  async getElements(selector) {
    if (this.config.mode === 'headless') {
      return await this.page.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map(el => {
          const rect = el.getBoundingClientRect();
          return {
            tagName: el.tagName,
            text: el.textContent,
            href: el.href,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          };
        });
      }, selector);
    } else {
      return [];
    }
  }

  /**
   * Broadcast current state to all WebSocket clients
   */
  async broadcastState() {
    if (this.wsClients.size === 0) return;

    const state = {
      type: 'state-update',
      mode: this.config.mode,
      timestamp: Date.now()
    };

    if (this.config.mode === 'headless' && this.page) {
      state.url = this.page.url();
      state.title = await this.page.title();
    }

    const message = JSON.stringify(state);
    this.wsClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  /**
   * Switch browser mode
   */
  async switchMode(newMode) {
    if (newMode === this.config.mode) return;

    console.log(`Switching from ${this.config.mode} to ${newMode} mode`);

    // Clean up current mode
    await this.cleanup();

    // Update config
    this.config.mode = newMode;

    // Reinitialize
    await this.initialize();
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    if (this.nekoConnection) {
      this.nekoConnection.close();
      this.nekoConnection = null;
    }

    if (this.wsServer) {
      this.wsClients.forEach(ws => ws.close());
      this.wsServer.close();
      this.wsServer = null;
    }
  }
}

// Export singleton instance
export const browserManager = new BrowserManager();