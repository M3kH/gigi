/**
 * MCP Tool — Browser Control
 *
 * Controls headless/interactive browser via BrowserManager.
 * Supports navigation, clicking, typing, screenshots, JS evaluation,
 * element queries, and mode switching.
 */

import { z } from 'zod'
import { BrowserManager, browserManager } from './browser-manager'
import type { AgentTool } from '../core/registry'

interface BrowserInput {
  action: string
  url?: string
  selector?: string
  text?: string
  script?: string
  mode?: 'headless' | 'interactive'
  options?: Record<string, unknown>
}

const browserTool = {
  name: 'browser',
  description: 'Control a browser instance for web navigation and interaction',

  async handler({ action, ...params }: BrowserInput): Promise<unknown> {
    // Initialize browser if not already initialized
    if (!browserManager.browser && !browserManager.nekoConnection) {
      const mode = process.env.BROWSER_MODE || 'headless'
      await browserManager.initialize()
      browserManager.config.mode = mode
    }

    switch (action) {
      case 'navigate':
        return await navigate(params.url!, params.options)
      case 'click':
        return await click(params.selector!, params.options)
      case 'type':
        return await type(params.selector!, params.text!, params.options)
      case 'screenshot':
        return await screenshot(params.options)
      case 'evaluate':
        return await evaluate(params.script!)
      case 'get_elements':
        return await getElements(params.selector!)
      case 'switch_mode':
        return await switchMode(params.mode!)
      case 'status':
        return await getStatus()
      default:
        throw new Error(`Unknown browser action: ${action}`)
    }
  },

  parameters: {
    action: {
      type: 'string',
      required: true,
      enum: ['navigate', 'click', 'type', 'screenshot', 'evaluate', 'get_elements', 'switch_mode', 'status'],
    },
    url: { type: 'string', description: 'URL to navigate to (for navigate action)' },
    selector: { type: 'string', description: 'CSS selector for element interaction' },
    text: { type: 'string', description: 'Text to type (for type action)' },
    script: { type: 'string', description: 'JavaScript to evaluate in page context' },
    mode: { type: 'string', enum: ['headless', 'interactive'], description: 'Browser mode to switch to' },
    options: { type: 'object', description: 'Additional options for the action' },
  },
}

export default browserTool

async function navigate(url: string, options: Record<string, unknown> = {}): Promise<unknown> {
  if (!url) throw new Error('URL is required for navigation')
  await browserManager.navigate(url, options)
  return {
    success: true,
    url: browserManager.page?.url() || url,
    title: browserManager.page ? await browserManager.page.title() : null,
    mode: browserManager.config.mode,
  }
}

async function click(selector: string, options: Record<string, unknown> = {}): Promise<unknown> {
  if (!selector) throw new Error('Selector is required for clicking')
  await browserManager.click(selector, options)
  return { success: true, selector, action: 'clicked' }
}

async function type(selector: string, text: string, options: Record<string, unknown> = {}): Promise<unknown> {
  if (!selector || text === undefined) throw new Error('Selector and text are required for typing')
  await browserManager.type(selector, text, options)
  return { success: true, selector, text, action: 'typed' }
}

async function screenshot(options: Record<string, unknown> = {}): Promise<unknown> {
  const screenshotData = await browserManager.captureScreenshot(options)
  return { success: true, data: screenshotData, format: 'base64', mode: browserManager.config.mode }
}

async function evaluate(script: string): Promise<unknown> {
  if (!script) throw new Error('Script is required for evaluation')
  const result = await browserManager.evaluate(script)
  return { success: true, result, script }
}

async function getElements(selector: string): Promise<unknown> {
  if (!selector) throw new Error('Selector is required')
  const elements = await browserManager.getElements(selector)
  return { success: true, selector, count: elements.length, elements }
}

async function switchMode(mode: 'headless' | 'interactive'): Promise<unknown> {
  if (!mode || !['headless', 'interactive'].includes(mode)) {
    throw new Error('Valid mode (headless or interactive) is required')
  }
  await browserManager.switchMode(mode)
  return { success: true, currentMode: mode }
}

async function getStatus(): Promise<unknown> {
  const status: Record<string, unknown> = {
    mode: browserManager.config.mode,
    initialized: !!(browserManager.browser || browserManager.nekoConnection),
    wsPort: browserManager.config.wsPort,
    wsClients: browserManager.wsClients?.size || 0,
  }

  if (browserManager.config.mode === 'headless' && browserManager.page) {
    status.currentUrl = browserManager.page.url()
    status.title = await browserManager.page.title()
  } else if (browserManager.config.mode === 'interactive') {
    status.nekoConnected = browserManager.nekoConnection?.readyState === 1
    status.nekoHost = browserManager.config.nekoHost
    status.nekoPort = browserManager.config.nekoPort
  }

  return status
}

// ─── Agent Tools (convention: agentTools export) ────────────────────

const BrowserActionSchema = z.object({
  action: z.enum([
    'navigate', 'click', 'type', 'screenshot', 'evaluate',
    'get_elements', 'switch_mode', 'status',
  ]).describe('Browser action to perform'),
  url: z.string().optional().describe('URL to navigate to (for navigate action)'),
  selector: z.string().optional().describe('CSS selector for element interaction'),
  text: z.string().optional().describe('Text to type (for type action)'),
  script: z.string().optional().describe('JavaScript to evaluate in page context'),
  mode: z.enum(['headless', 'interactive']).optional().describe('Browser mode to switch to'),
  options: z.record(z.string(), z.unknown()).optional().describe('Additional options for the action'),
})

export const agentTools: AgentTool[] = [
  {
    name: 'browser',
    description: 'Control a browser instance for web navigation and interaction',
    schema: BrowserActionSchema,
    handler: browserTool.handler,
    context: 'server',
    permission: 'browser.control',
  },
]
