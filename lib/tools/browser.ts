/**
 * MCP Tool — Browser Control
 *
 * Controls headless browser via BrowserManager.
 * Supports navigation, clicking, typing, screenshots, JS evaluation,
 * and element queries.
 *
 * Interactive browser access is handled by the chrome-devtools MCP server,
 * which connects directly to our Chrome container via CDP.
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
  options?: Record<string, unknown>
}

const browserTool = {
  name: 'browser',
  description: 'Control a browser instance for web navigation and interaction',

  async handler({ action, ...params }: BrowserInput): Promise<unknown> {
    // Initialize browser if not already initialized
    if (!browserManager.browser) {
      await browserManager.initialize()
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
      enum: ['navigate', 'click', 'type', 'screenshot', 'evaluate', 'get_elements', 'status'],
    },
    url: { type: 'string', description: 'URL to navigate to (for navigate action)' },
    selector: { type: 'string', description: 'CSS selector for element interaction' },
    text: { type: 'string', description: 'Text to type (for type action)' },
    script: { type: 'string', description: 'JavaScript to evaluate in page context' },
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
  return { success: true, data: screenshotData, format: 'base64' }
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

async function getStatus(): Promise<unknown> {
  return {
    initialized: !!browserManager.browser,
    wsPort: browserManager.config.wsPort,
    wsClients: browserManager.wsClients?.size || 0,
    currentUrl: browserManager.page?.url() || null,
    title: browserManager.page ? await browserManager.page.title() : null,
  }
}

// ─── Agent Tools (convention: agentTools export) ────────────────────

const BrowserActionSchema = z.object({
  action: z.enum([
    'navigate', 'click', 'type', 'screenshot', 'evaluate',
    'get_elements', 'status',
  ]).describe('Browser action to perform'),
  url: z.string().optional().describe('URL to navigate to (for navigate action)'),
  selector: z.string().optional().describe('CSS selector for element interaction'),
  text: z.string().optional().describe('Text to type (for type action)'),
  script: z.string().optional().describe('JavaScript to evaluate in page context'),
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
