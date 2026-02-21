/**
 * Integration Test Helpers
 *
 * High-level helpers for creating test data, simulating events,
 * and asserting on thread/conversation state.
 */

import * as store from '../../lib/core/store'
import { signPayload, issueEvent, issueCommentEvent, pullRequestEvent, type WebhookOptions } from './webhook-mock'
import { getTestPool } from './setup'
import { EventCollector } from './ws-client'

// ─── Types ──────────────────────────────────────────────────────────

export interface ThreadEvent {
  channel: string
  role: string
  text: string
  messageType?: string
  extras?: store.MessageExtras
}

export interface ThreadRef {
  tag: string
}

// ─── Thread Creation ────────────────────────────────────────────────

/**
 * Create a test thread (conversation) with events from multiple channels.
 * Returns the conversation and all created messages.
 */
export const createTestThread = async (opts: {
  channel?: string
  topic?: string
  tags?: string[]
  repo?: string
  events?: ThreadEvent[]
} = {}): Promise<{ conversation: store.Conversation; messages: store.Message[] }> => {
  const conv = await store.createConversation(
    opts.channel || 'test',
    opts.topic || 'Test Thread'
  )

  if (opts.tags?.length || opts.repo) {
    await store.updateConversation(conv.id, {
      tags: opts.tags,
      repo: opts.repo,
    })
  }

  const messages: store.Message[] = []

  for (const event of (opts.events || [])) {
    const msg = await store.addMessage(
      conv.id,
      event.role,
      [{ type: 'text', text: event.text }],
      {
        message_type: event.messageType || 'text',
        ...(event.extras || {}),
      }
    )
    messages.push(msg)
  }

  // Re-fetch conversation to get updated tags
  const updated = await store.getConversation(conv.id)
  return { conversation: updated!, messages }
}

/**
 * Create a thread that simulates events from multiple channels:
 * webhook (Gitea), web chat, and system events.
 */
export const createMultiChannelThread = async (opts: {
  repo?: string
  issueNumber?: number
  topic?: string
} = {}): Promise<{ conversation: store.Conversation; messages: store.Message[] }> => {
  const repo = opts.repo || 'test-repo'
  const issueNumber = opts.issueNumber || 42
  const topic = opts.topic || `Issue #${issueNumber}: Test multi-channel`

  return createTestThread({
    channel: 'webhook',
    topic,
    tags: [repo, `${repo}#${issueNumber}`],
    repo,
    events: [
      // Gitea webhook: issue opened
      {
        channel: 'webhook',
        role: 'system',
        text: `📋 Issue #${issueNumber} opened: "${topic}" by @testuser`,
        messageType: 'webhook',
      },
      // Web chat: user asks about the issue
      {
        channel: 'web',
        role: 'user',
        text: `Can you look into issue #${issueNumber}?`,
        messageType: 'text',
      },
      // Agent response
      {
        channel: 'web',
        role: 'assistant',
        text: `I'll investigate issue #${issueNumber} now.`,
        messageType: 'text',
        extras: {
          usage: {
            inputTokens: 500,
            outputTokens: 100,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.005,
          },
        },
      },
    ],
  })
}

// ─── Webhook Simulation ─────────────────────────────────────────────

/**
 * Simulate a webhook POST to the webhook handler.
 * This directly calls routeWebhook instead of going through HTTP,
 * which is faster and doesn't require a running server.
 */
export const simulateWebhook = async (
  event: string,
  payload: import('../../lib/api/webhooks').WebhookPayload
): Promise<import('../../lib/api/webhookRouter').WebhookResult | null> => {
  const { routeWebhook } = await import('../../lib/api/webhookRouter')
  return routeWebhook(event, payload)
}

/**
 * Simulate a webhook with the mock helpers (generates valid payload).
 */
export const simulateWebhookEvent = async (
  type: 'issue' | 'issue_comment' | 'pull_request',
  opts: WebhookOptions = {}
): Promise<import('../../lib/api/webhookRouter').WebhookResult | null> => {
  let request
  switch (type) {
    case 'issue':
      request = issueEvent(opts)
      break
    case 'issue_comment':
      request = issueCommentEvent(opts)
      break
    case 'pull_request':
      request = pullRequestEvent(opts)
      break
  }
  return simulateWebhook(request.event, request.payload)
}

// ─── Web Message Simulation ─────────────────────────────────────────

/**
 * Simulate a web chat message being sent to an existing thread.
 * Adds the message directly to the conversation (doesn't invoke the agent).
 */
export const simulateWebMessage = async (
  conversationId: string,
  text: string,
  role: string = 'user'
): Promise<store.Message> => {
  return store.addMessage(
    conversationId,
    role,
    [{ type: 'text', text }],
    { message_type: 'text' }
  )
}

// ─── Assertions ─────────────────────────────────────────────────────

/**
 * Assert that a thread contains the expected event sequence.
 * Checks role and text content (substring match).
 */
export const assertThreadEvents = async (
  conversationId: string,
  expected: Array<{ role: string; textContains: string }>
): Promise<void> => {
  const messages = await store.getMessages(conversationId)

  if (messages.length < expected.length) {
    throw new Error(
      `Expected at least ${expected.length} messages, got ${messages.length}.\n` +
      `Messages: ${messages.map(m => `[${m.role}] ${extractText(m.content)?.slice(0, 80)}`).join('\n')}`
    )
  }

  for (let i = 0; i < expected.length; i++) {
    const msg = messages[i]
    const exp = expected[i]
    const text = extractText(msg.content)

    if (msg.role !== exp.role) {
      throw new Error(
        `Message ${i}: expected role "${exp.role}", got "${msg.role}"`
      )
    }
    if (!text.includes(exp.textContains)) {
      throw new Error(
        `Message ${i}: expected text containing "${exp.textContains}", got "${text.slice(0, 200)}"`
      )
    }
  }
}

/**
 * Assert that a conversation has the expected tags.
 */
export const assertThreadTags = async (
  conversationId: string,
  expectedTags: string[]
): Promise<void> => {
  const conv = await store.getConversation(conversationId)
  if (!conv) throw new Error(`Conversation ${conversationId} not found`)

  const missing = expectedTags.filter(t => !conv.tags.includes(t))
  if (missing.length > 0) {
    throw new Error(
      `Missing tags: [${missing.join(', ')}]. Actual: [${conv.tags.join(', ')}]`
    )
  }
}

/**
 * Assert conversation status.
 */
export const assertThreadStatus = async (
  conversationId: string,
  expectedStatus: string
): Promise<void> => {
  const conv = await store.getConversation(conversationId)
  if (!conv) throw new Error(`Conversation ${conversationId} not found`)

  if (conv.status !== expectedStatus) {
    throw new Error(
      `Expected status "${expectedStatus}", got "${conv.status}"`
    )
  }
}

// ─── Event Bus Helper ───────────────────────────────────────────────

/**
 * Create an event collector subscribed to the event bus.
 * Returns the collector and an unsubscribe function.
 */
export const collectEvents = async (): Promise<{
  collector: EventCollector
  unsubscribe: () => void
}> => {
  const { subscribe } = await import('../../lib/core/events')
  const collector = new EventCollector()
  const unsubscribe = subscribe(collector.listener())
  return { collector, unsubscribe }
}

// ─── Utility ────────────────────────────────────────────────────────

const extractText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n')
  }
  return ''
}

/**
 * Wait for a condition to become true (poll-based).
 */
export const waitUntil = async (
  condition: () => Promise<boolean> | boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`)
}
