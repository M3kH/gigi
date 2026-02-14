/**
 * Core Router — Message routing and conversation management
 *
 * Routes messages from web/telegram/webhook channels, manages sessions,
 * enforces task completion, and handles /issue command tracking.
 */

import { runAgent, type AgentMessage, type EventCallback } from './agent'
import { emit } from './events'
import * as store from './store'
import { enforceCompletion, startTask, markNotified } from './enforcer'

// Active conversations per channel key (e.g. "telegram:12345", "web:uuid")
const active = new Map<string, string>()

// Track running agent processes by conversation ID
const runningAgents = new Map<string, AbortController>()

export const handleMessage = async (
  channel: string,
  channelId: string,
  text: string,
  onEvent?: EventCallback | null
): Promise<{ content: unknown[]; text: string; toolCalls: unknown[]; toolResults: Record<string, string>; sessionId: string | null; usage: unknown }> => {
  const key = `${channel}:${channelId}`

  // Reuse or create conversation
  let convId = active.get(key)
  if (!convId) {
    const conv = await store.createConversation(channel, null)
    convId = conv.id
    active.set(key, convId)
  }

  // Detect /issue command to start task tracking + auto-tag
  const issueMatch = text.match(/\/issue\s+([a-z0-9-]+)#(\d+)/i)
  if (issueMatch) {
    const [, repo, issueNumber] = issueMatch
    await startTask(convId, repo, parseInt(issueNumber, 10))
    console.log(`[router] Started task tracking: ${repo}#${issueNumber}`)
    try {
      await store.addTags(convId, [`${repo}#${issueNumber}`, repo])
      await store.updateConversation(convId, { repo })
    } catch (err) {
      console.warn('[router] Auto-tag failed:', (err as Error).message)
    }
  }

  // Store user message
  await store.addMessage(convId, 'user', [{ type: 'text', text }])

  // Try to get existing session ID for resume
  let sessionId: string | null = null
  try {
    sessionId = await store.getSessionId(convId)
  } catch (err) {
    console.warn('[router] getSessionId failed:', (err as Error).message)
  }

  // Build messages for agent
  let messages: AgentMessage[]
  if (sessionId) {
    messages = [{ role: 'user', content: [{ type: 'text', text }] }]
  } else {
    const history = await store.getMessages(convId)
    messages = history.map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content as AgentMessage['content'],
    }))
  }

  // Wrap onEvent to inject conversationId and broadcast to event bus
  const wrappedOnEvent: EventCallback = (event) => {
    const enriched = { ...event, conversationId: convId } as import('./events').AgentEvent
    try { emit(enriched) } catch (err) {
      console.error('[router] emit error:', (err as Error).message)
    }
    try { if (onEvent) onEvent(enriched) } catch (err) {
      console.error('[router] onEvent error:', (err as Error).message)
    }
  }

  // Emit agent_start
  wrappedOnEvent({ type: 'agent_start', conversationId: convId })

  // Create abort controller for this agent
  const abortController = new AbortController()
  runningAgents.set(convId, abortController)

  let response
  try {
    response = await runAgent(messages, wrappedOnEvent, { sessionId, signal: abortController.signal })
  } catch (err) {
    runningAgents.delete(convId)
    if ((err as Error).name === 'AbortError') {
      console.log(`[router] Agent stopped by user for conversation ${convId}`)
      wrappedOnEvent({ type: 'agent_stopped', conversationId: convId })
      await store.addMessage(convId, 'assistant', [{ type: 'text', text: '⏹️ Stopped by user' }])
      throw new Error('Agent stopped by user')
    }
    throw err
  } finally {
    runningAgents.delete(convId)
  }

  // Store session ID from response
  if (response.sessionId) {
    try {
      await store.setSessionId(convId, response.sessionId)
    } catch (err) {
      console.warn('[router] setSessionId failed:', (err as Error).message)
    }
  }

  // Extract title from first response
  let storedText = response.text
  const titleMatch = response.text.match(/^\[title:\s*(.+?)\]\s*/m)
  if (titleMatch) {
    const title = titleMatch[1].trim()
    storedText = response.text.replace(titleMatch[0], '')
    try {
      await store.updateConversation(convId, { topic: title })
      wrappedOnEvent({ type: 'title_update', conversationId: convId, title })
    } catch (err) {
      console.warn('[router] title update failed:', (err as Error).message)
    }
  }

  // Store assistant response with structured tool data and usage
  const storedContent = [{ type: 'text', text: storedText }]
  await store.addMessage(convId, 'assistant', storedContent, {
    tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
    tool_outputs: Object.keys(response.toolResults).length ? response.toolResults : undefined,
    usage: response.usage || undefined,
  })

  // ENFORCE TASK COMPLETION
  const enforcement = await enforceCompletion(convId)

  if (enforcement) {
    console.log(`[router] Enforcement triggered:`, enforcement.action)

    let enforcementSessionId = response.sessionId
    try {
      enforcementSessionId = await store.getSessionId(convId) || enforcementSessionId
    } catch { /* ignore */ }

    if (enforcement.action === 'code_changed') {
      const followUp = `You made code changes for ${enforcement.repo}#${enforcement.issueNumber}. Complete the task by:\n1. Committing and pushing to a feature branch\n2. Creating a PR via gitea tool\n3. Notifying via telegram_send`

      await store.addMessage(convId, 'user', [{ type: 'text', text: '[ENFORCER] ' + followUp }])

      let messages2: AgentMessage[]
      if (enforcementSessionId) {
        messages2 = [{ role: 'user', content: [{ type: 'text', text: '[ENFORCER] ' + followUp }] }]
      } else {
        messages2 = (await store.getMessages(convId)).map((m) => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content as AgentMessage['content'],
        }))
      }

      const response2 = await runAgent(messages2, wrappedOnEvent, { sessionId: enforcementSessionId })
      if (response2.sessionId) {
        try { await store.setSessionId(convId, response2.sessionId) } catch { /* ignore */ }
        enforcementSessionId = response2.sessionId
      }
      await store.addMessage(convId, 'assistant', response2.content, {
        tool_calls: response2.toolCalls.length ? response2.toolCalls : undefined,
        tool_outputs: Object.keys(response2.toolResults).length ? response2.toolResults : undefined,
        usage: response2.usage || undefined,
      })

      const enforcement2 = await enforceCompletion(convId)
      if (enforcement2?.action === 'needs_notification') {
        await markNotified(convId, enforcement2.repo, enforcement2.issueNumber)
      }
    }

    if (enforcement.action === 'needs_notification') {
      const followUp = `You pushed branch ${enforcement.branch} for ${enforcement.repo}#${enforcement.issueNumber}. Complete the task by sending a Telegram notification with the PR link.`

      await store.addMessage(convId, 'user', [{ type: 'text', text: '[ENFORCER] ' + followUp }])

      let messages2: AgentMessage[]
      if (enforcementSessionId) {
        messages2 = [{ role: 'user', content: [{ type: 'text', text: '[ENFORCER] ' + followUp }] }]
      } else {
        messages2 = (await store.getMessages(convId)).map((m) => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content as AgentMessage['content'],
        }))
      }

      const response2 = await runAgent(messages2, wrappedOnEvent, { sessionId: enforcementSessionId })
      if (response2.sessionId) {
        try { await store.setSessionId(convId, response2.sessionId) } catch { /* ignore */ }
      }
      await store.addMessage(convId, 'assistant', response2.content, {
        tool_calls: response2.toolCalls.length ? response2.toolCalls : undefined,
        tool_outputs: Object.keys(response2.toolResults).length ? response2.toolResults : undefined,
        usage: response2.usage || undefined,
      })

      await markNotified(convId, enforcement.repo, enforcement.issueNumber)
    }
  }

  return { ...response, text: storedText }
}

export const newConversation = (channel: string, channelId: string): void => {
  const key = `${channel}:${channelId}`
  active.delete(key)
}

export const resumeConversation = (channel: string, channelId: string, convId: string): void => {
  const key = `${channel}:${channelId}`
  active.set(key, convId)
}

export const clearConversation = async (channel: string, channelId: string): Promise<void> => {
  const key = `${channel}:${channelId}`
  const convId = active.get(key)
  if (convId) {
    try {
      await store.closeConversation(convId)
    } catch (err) {
      console.warn('[router] closeConversation failed:', (err as Error).message)
    }
  }
  active.delete(key)
}

export const stopAgent = (convId: string): boolean => {
  const controller = runningAgents.get(convId)
  if (controller) {
    controller.abort()
    return true
  }
  return false
}

export const getRunningAgents = (): string[] => [...runningAgents.keys()]
