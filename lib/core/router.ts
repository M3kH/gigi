/**
 * Core Router — Unified thread-based message routing
 *
 * Routes messages from web/telegram/webhook channels through a unified
 * thread model. Each conversation is backed by a thread that supports
 * cross-channel refs, events, and auto-linking.
 *
 * Backward compatible: conversations + messages tables are still written
 * alongside threads + thread_events. The conversation ID remains the
 * primary key for all external APIs and events.
 */

import { runAgent, type AgentMessage, type EventCallback } from './agent'
import { emit } from './events'
import * as store from './store'
import * as threads from './threads'
import { enforceCompletion, startTask, markNotified } from './enforcer'
import { detectUnfinishedWork } from './completion-detector'
import { buildThreadContext, shouldCompact, type BuildContextResult } from './thread-compact'
import type { ViewContext } from './protocol'
import { createGiteaClient } from '../api-gitea'
import { classifyMessage, type RoutingDecision } from './llm-router'
import {
  determineRouting,
  isSignificantEvent,
  buildDeliveryMetadata,
  getThreadActiveChannels,
} from './response-routing'

// Active conversations per channel key (e.g. "telegram:12345", "web:uuid")
const active = new Map<string, string>()

// Helper to extract plain text from JSONB message content
const extractMessageText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n\n')
  }
  return ''
}

// Track running agent processes by conversation ID
const runningAgents = new Map<string, AbortController>()

// ── Thread Resolution ────────────────────────────────────────────────

/**
 * Find or create a thread linked to a conversation.
 * This is the core of unified routing — every conversation gets a thread.
 */
const resolveThread = async (convId: string, channel: string): Promise<string> => {
  // Check if conversation already has a linked thread
  const pool = store.getPool()
  const { rows } = await pool.query(
    'SELECT id FROM threads WHERE conversation_id = $1 LIMIT 1',
    [convId]
  )

  if (rows[0]) return rows[0].id

  // Create a new thread linked to this conversation
  const thread = await threads.createThread({
    conversation_id: convId,
    status: 'paused',
  })

  console.log(`[router] Created thread ${thread.id} for conversation ${convId} (channel: ${channel})`)
  return thread.id
}

/**
 * After agent completes, scan tool calls for PR/issue creation
 * and auto-link them as thread_refs.
 */
const autoLinkRefs = async (
  threadId: string,
  toolCalls: unknown[],
  toolResults: Record<string, string>
): Promise<void> => {
  try {
    for (const tc of toolCalls as Array<{ name: string; input?: Record<string, unknown> }>) {
      // Detect gitea tool calls that create PRs or issues
      if (tc.name === 'mcp__gigi-tools__gitea' && tc.input) {
        const input = tc.input as Record<string, unknown>
        const action = input.action as string

        if (action === 'create_pr' && input.repo) {
          // Find the PR number from the tool result
          const resultKey = Object.keys(toolResults).find(k =>
            toolResults[k]?.includes('"number"')
          )
          if (resultKey) {
            try {
              const result = JSON.parse(toolResults[resultKey])
              if (result.number) {
                await threads.addThreadRef(threadId, {
                  ref_type: 'pr',
                  repo: input.repo as string,
                  number: result.number,
                  url: result.html_url || null,
                  status: 'open',
                })
                console.log(`[router] Auto-linked PR ${input.repo}#${result.number} to thread ${threadId}`)
              }
            } catch { /* result not parseable */ }
          }
        }

        if (action === 'create_issue' && input.repo) {
          const resultKey = Object.keys(toolResults).find(k =>
            toolResults[k]?.includes('"number"')
          )
          if (resultKey) {
            try {
              const result = JSON.parse(toolResults[resultKey])
              if (result.number) {
                await threads.addThreadRef(threadId, {
                  ref_type: 'issue',
                  repo: input.repo as string,
                  number: result.number,
                  url: result.html_url || null,
                  status: 'open',
                })
                console.log(`[router] Auto-linked issue ${input.repo}#${result.number} to thread ${threadId}`)
              }
            } catch { /* result not parseable */ }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[router] Auto-link failed:', (err as Error).message)
  }
}

// ── View Context Enrichment ──────────────────────────────────────────

const getGiteaClient = async () => {
  const baseUrl = process.env.GITEA_URL || await store.getConfig('gitea_url') || 'http://localhost:3300'
  const token = process.env.GITEA_TOKEN || await store.getConfig('gitea_token')
  if (!token) return null
  return createGiteaClient(baseUrl, token)
}

/**
 * Enrich message with a brief context reference — NOT full inline content.
 * The agent can use its tools to fetch details as needed, keeping context lean.
 */
const enrichWithContext = async (text: string, context: ViewContext): Promise<string> => {
  try {
    const gitea = await getGiteaClient()
    if (!gitea) return text

    if (context.type === 'issue' && context.owner && context.repo && context.number) {
      const issue = await gitea.issues.get(context.owner, context.repo, context.number)
      return `[Viewing issue ${context.owner}/${context.repo}#${context.number}: "${issue.title}" (${issue.state})]\n${text}`
    }

    if (context.type === 'pull' && context.owner && context.repo && context.number) {
      const pr = await gitea.pulls.get(context.owner, context.repo, context.number)
      return `[Viewing PR ${context.owner}/${context.repo}#${context.number}: "${pr.title}" (${pr.state}) ${pr.head?.ref || ''} → ${pr.base?.ref || ''}]\n${text}`
    }

    if (context.type === 'file' && context.owner && context.repo && context.filepath) {
      return `[Viewing file ${context.owner}/${context.repo}/${context.filepath}${context.branch ? ` (branch: ${context.branch})` : ''}]\n${text}`
    }

    if (context.type === 'commit' && context.owner && context.repo && context.commitSha) {
      return `[Viewing commit ${context.owner}/${context.repo}@${context.commitSha.slice(0, 12)}]\n${text}`
    }

    if (context.type === 'repo' && context.owner && context.repo) {
      return `[Viewing repository ${context.owner}/${context.repo}]\n${text}`
    }

    if (context.type === 'actions' && context.owner && context.repo) {
      const run = context.subId ? ` run #${context.subId}` : ''
      return `[Viewing Actions${run} for ${context.owner}/${context.repo}]\n${text}`
    }

    if (context.type === 'releases' && context.owner && context.repo) {
      return `[Viewing releases for ${context.owner}/${context.repo}]\n${text}`
    }

    if (context.type === 'wiki' && context.owner && context.repo) {
      return `[Viewing wiki for ${context.owner}/${context.repo}]\n${text}`
    }

    if (context.type === 'org' && context.owner) {
      return `[Viewing org ${context.owner}]\n${text}`
    }

    if (context.type === 'admin') {
      return `[Viewing admin panel]\n${text}`
    }

    // Generic fallback for other sub-pages (milestones, labels, settings, etc.)
    if (context.owner && context.repo) {
      return `[Viewing ${context.type} for ${context.owner}/${context.repo}]\n${text}`
    }
  } catch (err) {
    console.warn('[router] Context enrichment failed:', (err as Error).message)
  }

  return text
}

// ── Message Handling ─────────────────────────────────────────────────

export const handleMessage = async (
  channel: string,
  channelId: string,
  text: string,
  onEvent?: EventCallback | null,
  context?: ViewContext
): Promise<{ content: unknown[]; text: string; toolCalls: unknown[]; toolResults: Record<string, string>; sessionId: string | null; usage: unknown }> => {
  const key = `${channel}:${channelId}`

  // Reuse or create conversation
  let convId = active.get(key)
  if (!convId) {
    const conv = await store.createConversation(channel, null)
    convId = conv.id
    active.set(key, convId)
  }

  // Resolve the thread for this conversation
  const threadId = await resolveThread(convId, channel)

  // Detect /issue command to start task tracking + auto-tag + auto-ref
  const issueMatch = text.match(/\/issue\s+([a-z0-9-]+)#(\d+)/i)
  if (issueMatch) {
    const [, repo, issueNumber] = issueMatch
    const issueNum = parseInt(issueNumber, 10)
    await startTask(convId, repo, issueNum)
    console.log(`[router] Started task tracking: ${repo}#${issueNumber}`)
    try {
      await store.addTags(convId, [`${repo}#${issueNumber}`, repo])
      await store.updateConversation(convId, { repo })
    } catch (err) {
      console.warn('[router] Auto-tag failed:', (err as Error).message)
    }
    // Add thread ref for the issue being tracked
    try {
      await threads.addThreadRef(threadId, {
        ref_type: 'issue',
        repo,
        number: issueNum,
        status: 'open',
      })
      console.log(`[router] Added thread ref: ${repo}#${issueNumber}`)
    } catch (err) {
      console.warn('[router] Thread ref failed:', (err as Error).message)
    }
  }

  // Enrich message with view context (if provided)
  const enrichedText = context ? await enrichWithContext(text, context) : text

  // Store user message in both conversations (backward compat) and thread_events
  await store.addMessage(convId, 'user', [{ type: 'text', text: enrichedText }])
  try {
    await threads.addThreadEvent(threadId, {
      channel: channel as threads.ThreadEventChannel,
      direction: 'inbound',
      actor: 'user',
      content: [{ type: 'text', text: enrichedText }],
      message_type: 'text',
    })
  } catch (err) {
    console.warn('[router] Thread event (user) failed:', (err as Error).message)
  }

  // ── LLM Routing: classify message complexity ──────────────────
  // /issue commands always get complex routing (they trigger task tracking)
  const routing: RoutingDecision = issueMatch
    ? { complexity: 'complex', model: 'claude-opus-4-6', reason: '/issue command', includeTools: true, maxTurns: 50, useMinimalPrompt: false }
    : classifyMessage(text)

  console.log(`[router] Message classified: ${routing.complexity} (${routing.model}) — ${routing.reason}`)

  // Try to get existing session ID for resume
  // Note: if we have an existing session, we MUST use the same model that created it
  let sessionId: string | null = null
  try {
    sessionId = await store.getSessionId(convId)
    if (sessionId) {
      // Existing session -> always use Opus (session was created with Opus)
      // Don't downgrade mid-conversation -- it would lose context
      routing.model = 'claude-opus-4-6'
      routing.useMinimalPrompt = false
      routing.includeTools = true
      routing.maxTurns = 50
      console.log(`[router] Existing session detected — upgrading to Opus for session continuity`)
    }
  } catch (err) {
    console.warn('[router] getSessionId failed:', (err as Error).message)
  }

  // Build messages for agent using unified thread context (issue #43)
  // The thread context includes events from ALL channels with attribution,
  // linked refs, and compacted summaries when available.
  let messages: AgentMessage[]
  let contextInfo: BuildContextResult | null = null
  if (sessionId) {
    // Existing session: Claude SDK has context, just send the new message
    messages = [{ role: 'user', content: [{ type: 'text', text: enrichedText }] }]
  } else {
    // No session: build full thread context from thread_events
    try {
      contextInfo = await buildThreadContext(threadId)
      messages = contextInfo.messages as AgentMessage[]

      const channelNote = contextInfo.channels.length > 1
        ? ` across channels: ${contextInfo.channels.join(', ')}`
        : ''
      console.log(`[router] Thread context: ${contextInfo.eventCount} events, ~${contextInfo.estimatedTokens} tokens${channelNote}`)

      // Check if thread needs compaction (non-blocking)
      if (contextInfo.eventCount > 15) {
        const compactCheck = await shouldCompact(threadId, 20)
        if (compactCheck.shouldCompact) {
          console.warn(`[router] ⚠️ Thread may need compaction: ${compactCheck.reason}`)
        }
      }
    } catch (err) {
      // Fallback to old conversation-based context if thread context fails
      console.warn('[router] Thread context build failed, falling back to conversation history:', (err as Error).message)
      const history = await store.getMessages(convId)
      messages = history.map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content as AgentMessage['content'],
      }))
    }
  }

  // Wrap onEvent to inject conversationId and channel, then broadcast.
  // agent_done is deferred — the agent emits it before router stores the message,
  // so we hold it and re-emit after the DB write to avoid a race where the frontend
  // calls loadMessages() before the response is persisted.
  let deferredAgentDone: import('./events').AgentEvent | null = null
  const flushDeferredDone = () => {
    if (!deferredAgentDone) return
    const ev = deferredAgentDone
    deferredAgentDone = null
    try { emit(ev) } catch { /* ignore */ }
    try { if (onEvent) onEvent(ev) } catch { /* ignore */ }
  }
  const wrappedOnEvent: EventCallback = (event) => {
    const enriched: import('./events').AgentEvent = { ...event, type: event.type as string, conversationId: convId, channel }
    if (event.type === 'agent_done') {
      deferredAgentDone = enriched
      return
    }
    try { emit(enriched) } catch (err) {
      console.error('[router] emit error:', (err as Error).message)
    }
    try { if (onEvent) onEvent(enriched) } catch (err) {
      console.error('[router] onEvent error:', (err as Error).message)
    }
  }

  // ── Budget check (non-blocking warning) ────────────────────────
  try {
    const budgetStr = await store.getConfig('budget_usd')
    if (budgetStr) {
      const periodStr = await store.getConfig('budget_period_days') || '7'
      const check = await store.checkBudget(parseFloat(budgetStr), parseInt(periodStr))
      if (check.overBudget) {
        console.warn(`[router] ⚠️ OVER BUDGET: $${check.periodSpend.toFixed(2)} / $${check.budgetUSD} (${check.percentUsed.toFixed(0)}%)`)
        // Emit a budget warning event to the UI
        const budgetEvent = { type: 'budget_warning', conversationId: convId, ...check } as import('./events').AgentEvent
        try { emit(budgetEvent) } catch { /* ignore */ }
      }
    }
  } catch (err) {
    console.warn('[router] Budget check failed:', (err as Error).message)
  }

  // Emit agent_start + activate thread (both conversation and thread tables)
  wrappedOnEvent({ type: 'agent_start', conversationId: convId })
  try {
    await store.activateThread(convId)
    await threads.updateThreadStatus(threadId, 'active')
    wrappedOnEvent({ type: 'thread_status', conversationId: convId, status: 'active' })
  } catch (err) {
    console.warn('[router] activateThread failed:', (err as Error).message)
  }

  // Create abort controller for this agent
  const abortController = new AbortController()
  runningAgents.set(convId, abortController)

  let response
  try {
    response = await runAgent(messages, wrappedOnEvent, { sessionId, signal: abortController.signal, routing })
  } catch (err) {
    runningAgents.delete(convId)
    if ((err as Error).name === 'AbortError') {
      console.log(`[router] Agent stopped by user for conversation ${convId}`)
      wrappedOnEvent({ type: 'agent_stopped', conversationId: convId })
      const stopContent = [{ type: 'text' as const, text: '⏹️ Stopped by user' }]
      await store.addMessage(convId, 'assistant', stopContent)
      try {
        await threads.addThreadEvent(threadId, {
          channel: channel as threads.ThreadEventChannel,
          direction: 'outbound',
          actor: 'gigi',
          content: stopContent,
          message_type: 'text',
        })
      } catch { /* ignore */ }
      try {
        await store.pauseThread(convId)
        await threads.updateThreadStatus(threadId, 'paused')
        wrappedOnEvent({ type: 'thread_status', conversationId: convId, status: 'paused' })
      } catch { /* ignore */ }
      throw new Error('Agent stopped by user')
    }
    // Emit agent_done with error so the frontend unblocks (clears Stop button, loading state)
    console.error('[router] Agent crashed:', (err as Error).stack || (err as Error).message)
    wrappedOnEvent({ type: 'agent_done', conversationId: convId, isError: true })
    const errorContent = [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }]
    try {
      await store.addMessage(convId, 'assistant', errorContent)
    } catch { /* ignore */ }
    try {
      await threads.addThreadEvent(threadId, {
        channel: channel as threads.ThreadEventChannel,
        direction: 'outbound',
        actor: 'gigi',
        content: errorContent,
        message_type: 'text',
      })
    } catch { /* ignore */ }
    try {
      await store.pauseThread(convId)
      await threads.updateThreadStatus(threadId, 'paused')
    } catch { /* ignore */ }
    // Flush AFTER error persistence so frontend finds data when it re-fetches
    flushDeferredDone()
    throw err
  } finally {
    runningAgents.delete(convId)
  }

  // Pause thread (agent done with this turn)
  try {
    await store.pauseThread(convId)
    await threads.updateThreadStatus(threadId, 'paused')
    wrappedOnEvent({ type: 'thread_status', conversationId: convId, status: 'paused' })
  } catch (err) {
    console.warn('[router] pauseThread failed:', (err as Error).message)
  }

  // Store session ID from response (both conversation and thread)
  if (response.sessionId) {
    try {
      await store.setSessionId(convId, response.sessionId)
      await threads.setThreadSession(threadId, response.sessionId)
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
      await threads.updateThreadTopic(threadId, title)
      wrappedOnEvent({ type: 'title_update', conversationId: convId, title })
    } catch (err) {
      console.warn('[router] title update failed:', (err as Error).message)
    }
  }

  // Store assistant response with interleaved content (text + tool_use blocks in order)
  // This preserves the text/tool interleaving so reload matches live rendering.
  // Strip the [title:] tag from the first text block if present.
  const storedContent = response.interleavedContent.length > 0
    ? response.interleavedContent.map((block, i) => {
        if (i === 0 && block.type === 'text' && titleMatch) {
          return { ...block, text: block.text.replace(titleMatch[0], '') }
        }
        return block
      })
    : [{ type: 'text', text: storedText }]
  await store.addMessage(convId, 'assistant', storedContent, {
    tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
    tool_outputs: Object.keys(response.toolResults).length ? response.toolResults : undefined,
    usage: response.usage || undefined,
  })

  // ── Response Routing: determine delivery channels ──────────────
  const threadChannels = await getThreadActiveChannels(threadId, store.getPool)
  const responseRouting = determineRouting(
    channel as threads.ThreadEventChannel,
    threadChannels,
  )

  // Build delivery metadata — start with primary channel
  const deliveredTo: threads.ThreadEventChannel[] = [responseRouting.primary]
  const deliveryMeta = buildDeliveryMetadata(
    channel as threads.ThreadEventChannel,
    deliveredTo,
  )

  // Store assistant response as thread event with delivery metadata
  try {
    await threads.addThreadEvent(threadId, {
      channel: channel as threads.ThreadEventChannel,
      direction: 'outbound',
      actor: 'gigi',
      content: storedContent,
      message_type: 'text',
      usage: response.usage || undefined,
      metadata: { delivery: deliveryMeta },
    })
  } catch (err) {
    console.warn('[router] Thread event (assistant) failed:', (err as Error).message)
  }

  // Flush deferred agent_done AFTER both message and thread event are persisted —
  // the frontend's loadMessages() and getThreadEvents() will find data in the database.
  flushDeferredDone()

  // Auto-link any PRs/issues created by the agent
  if (response.toolCalls.length > 0) {
    await autoLinkRefs(threadId, response.toolCalls, response.toolResults)
  }

  // MAXTURNS CONTINUATION: If the agent hit the turn limit, resume to let it finish
  if (response.stopReason === 'max_turns' && response.sessionId) {
    console.log(`[router] Agent hit maxTurns — continuing conversation to completion`)
    const continuationSessionId = response.sessionId
    try {
      await store.setSessionId(convId, continuationSessionId)
      await threads.setThreadSession(threadId, continuationSessionId)
    } catch { /* ignore */ }

    const continueMsg = '[SYSTEM] You hit the turn limit before completing your task. Please wrap up: summarize what you accomplished, what remains, and provide any final answers or PR links.'
    await store.addMessage(convId, 'user', [{ type: 'text', text: continueMsg }])

    const contMessages: AgentMessage[] = [{ role: 'user', content: [{ type: 'text', text: continueMsg }] }]
    try {
      const contResponse = await runAgent(contMessages, wrappedOnEvent, { sessionId: continuationSessionId, signal: abortController.signal })
      if (contResponse.sessionId) {
        try {
          await store.setSessionId(convId, contResponse.sessionId)
          await threads.setThreadSession(threadId, contResponse.sessionId)
        } catch { /* ignore */ }
      }
      const contText = contResponse.text
      await store.addMessage(convId, 'assistant', [{ type: 'text', text: contText }], {
        tool_calls: contResponse.toolCalls.length ? contResponse.toolCalls : undefined,
        tool_outputs: Object.keys(contResponse.toolResults).length ? contResponse.toolResults : undefined,
        usage: contResponse.usage || undefined,
      })
      flushDeferredDone()
      // Auto-link from continuation too
      if (contResponse.toolCalls.length > 0) {
        await autoLinkRefs(threadId, contResponse.toolCalls, contResponse.toolResults)
      }
      // Update the main response text with the continuation
      storedText = storedText + '\n\n' + contText
    } catch (err) {
      console.warn('[router] maxTurns continuation failed:', (err as Error).message)
    }
  }

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
        try {
          await store.setSessionId(convId, response2.sessionId)
          await threads.setThreadSession(threadId, response2.sessionId)
        } catch { /* ignore */ }
        enforcementSessionId = response2.sessionId
      }
      await store.addMessage(convId, 'assistant', response2.content, {
        tool_calls: response2.toolCalls.length ? response2.toolCalls : undefined,
        tool_outputs: Object.keys(response2.toolResults).length ? response2.toolResults : undefined,
        usage: response2.usage || undefined,
      })
      flushDeferredDone()
      // Auto-link from enforcement response
      if (response2.toolCalls.length > 0) {
        await autoLinkRefs(threadId, response2.toolCalls, response2.toolResults)
      }

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
        try {
          await store.setSessionId(convId, response2.sessionId)
          await threads.setThreadSession(threadId, response2.sessionId)
        } catch { /* ignore */ }
      }
      await store.addMessage(convId, 'assistant', response2.content, {
        tool_calls: response2.toolCalls.length ? response2.toolCalls : undefined,
        tool_outputs: Object.keys(response2.toolResults).length ? response2.toolResults : undefined,
        usage: response2.usage || undefined,
      })
      flushDeferredDone()

      await markNotified(convId, enforcement.repo, enforcement.issueNumber)
    }
  }

  // HEURISTIC COMPLETION CHECK — catches unfinished work the enforcer misses
  // (e.g. agent described intent but didn't follow through, or no /issue tracking was set up)
  if (!enforcement) {
    const detection = detectUnfinishedWork(storedText, response.toolCalls.length > 0)
    if (detection.hasUnfinishedWork && detection.followUpPrompt) {
      console.log(`[router] Unfinished work detected:`, detection.signals)

      const followUp = `[SYSTEM — Completion Check] ${detection.followUpPrompt}`
      await store.addMessage(convId, 'user', [{ type: 'text', text: followUp }])

      let completionSessionId = response.sessionId
      try {
        completionSessionId = await store.getSessionId(convId) || completionSessionId
      } catch { /* ignore */ }

      const completionMessages: AgentMessage[] = completionSessionId
        ? [{ role: 'user', content: [{ type: 'text', text: followUp }] }]
        : (await store.getMessages(convId)).map((m) => ({
            role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content as AgentMessage['content'],
          }))

      try {
        const completionResponse = await runAgent(completionMessages, wrappedOnEvent, { sessionId: completionSessionId })
        if (completionResponse.sessionId) {
          try {
            await store.setSessionId(convId, completionResponse.sessionId)
            await threads.setThreadSession(threadId, completionResponse.sessionId)
          } catch { /* ignore */ }
        }
        const completionText = completionResponse.text
        await store.addMessage(convId, 'assistant', [{ type: 'text', text: completionText }], {
          tool_calls: completionResponse.toolCalls.length ? completionResponse.toolCalls : undefined,
          tool_outputs: Object.keys(completionResponse.toolResults).length ? completionResponse.toolResults : undefined,
          usage: completionResponse.usage || undefined,
        })
        // Auto-link from completion response
        if (completionResponse.toolCalls.length > 0) {
          await autoLinkRefs(threadId, completionResponse.toolCalls, completionResponse.toolResults)
        }
        storedText = storedText + '\n\n' + completionText
        console.log(`[router] Completion follow-up finished`)
      } catch (err) {
        console.warn('[router] Completion follow-up failed:', (err as Error).message)
      }
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
