/**
 * API — CI Router
 *
 * Handles workflow_run and workflow_job webhook events.
 * When CI fails on a PR authored by gigi, auto-invokes the agent to fix it.
 *
 * Flow:
 * 1. Parse the workflow event payload
 * 2. If conclusion=failure, find the associated PR
 * 3. Check if the PR author is "gigi" (only auto-fix our own PRs)
 * 4. Check retry guard rails
 * 5. Fetch CI logs
 * 6. Find or create a conversation for the PR
 * 7. Invoke the agent with failure context
 */

import * as store from '../core/store'
import * as threads from '../core/threads'
import { runAgent } from '../core/agent'
import { emit } from '../core/events'
import { notifyTelegram } from './webhookNotifier'
import {
  parseWorkflowRunPayload,
  parseWorkflowJobPayload,
  fetchRunLogs,
  findPRForRun,
  shouldAutoFix,
  trackFixAttempt,
  resetFixAttempts,
  getFixAttempts,
  buildCIFailureMessage,
  MAX_FIX_ATTEMPTS,
  type CIRunInfo,
} from '../core/ci-monitor'

import type { AgentMessage } from '../core/agent'
import type { WebhookPayload } from './webhooks'

// ─── Types ───────────────────────────────────────────────────────────

export interface CIRouteResult {
  /** What action was taken */
  action: 'ignored' | 'success_reset' | 'not_gigi_pr' | 'max_retries' | 'agent_invoked' | 'agent_failed'
  /** The run conclusion */
  conclusion?: string
  /** PR number if identified */
  prNumber?: number
  /** Conversation ID if agent was invoked */
  conversationId?: string
}

// ─── Main Router ────────────────────────────────────────────────────

export async function routeWorkflowEvent(
  event: string,
  payload: WebhookPayload,
): Promise<CIRouteResult> {
  // Parse the payload based on event type
  const rawPayload = payload as unknown as Record<string, unknown>
  const runInfo: CIRunInfo | null =
    event === 'workflow_run'
      ? parseWorkflowRunPayload(rawPayload)
      : event === 'workflow_job'
        ? parseWorkflowJobPayload(rawPayload)
        : null

  if (!runInfo) {
    return { action: 'ignored' }
  }

  console.log(
    `[ciRouter] ${event}: ${runInfo.workflowName} on ${runInfo.owner}/${runInfo.repo}@${runInfo.branch} → ${runInfo.conclusion}`
  )

  // On success, reset the retry counter for this PR
  if (runInfo.conclusion === 'success') {
    if (runInfo.prNumber) {
      resetFixAttempts(runInfo.owner, runInfo.repo, runInfo.prNumber)
      console.log(`[ciRouter] CI passed — reset fix counter for PR #${runInfo.prNumber}`)
    } else {
      // Try to find the PR by branch to reset counter
      const pr = await findPRForRun(runInfo.owner, runInfo.repo, runInfo.branch)
      if (pr) {
        resetFixAttempts(runInfo.owner, runInfo.repo, pr.number)
        console.log(`[ciRouter] CI passed — reset fix counter for PR #${pr.number}`)
      }
    }
    return { action: 'success_reset', conclusion: 'success', prNumber: runInfo.prNumber }
  }

  // Only act on failures
  if (runInfo.conclusion !== 'failure') {
    return { action: 'ignored', conclusion: runInfo.conclusion }
  }

  // Find the associated PR
  let prNumber = runInfo.prNumber
  let prAuthor: string | undefined
  let prTitle: string | undefined

  if (!prNumber) {
    const pr = await findPRForRun(runInfo.owner, runInfo.repo, runInfo.branch)
    if (pr) {
      prNumber = pr.number
      prAuthor = pr.author
      prTitle = pr.title
    }
  } else {
    // We have the PR number but need the author
    const pr = await findPRForRun(runInfo.owner, runInfo.repo, runInfo.branch)
    if (pr) {
      prAuthor = pr.author
      prTitle = pr.title
    }
  }

  if (!prNumber) {
    console.log(`[ciRouter] No PR found for branch ${runInfo.branch} — ignoring CI failure`)
    return { action: 'ignored', conclusion: 'failure' }
  }

  runInfo.prNumber = prNumber

  // Only auto-fix PRs authored by gigi
  if (prAuthor !== 'gigi') {
    console.log(`[ciRouter] PR #${prNumber} authored by ${prAuthor}, not gigi — skipping auto-fix`)
    return { action: 'not_gigi_pr', conclusion: 'failure', prNumber }
  }

  // Check retry guard rails
  if (!shouldAutoFix(runInfo.owner, runInfo.repo, prNumber)) {
    const attempts = getFixAttempts(runInfo.owner, runInfo.repo, prNumber)
    console.warn(
      `[ciRouter] Max fix attempts (${attempts}/${MAX_FIX_ATTEMPTS}) reached for PR #${prNumber} — notifying operator`
    )

    // Notify operator that auto-fix has given up
    await notifyOperatorCIGaveUp(runInfo, prNumber, prTitle)

    return { action: 'max_retries', conclusion: 'failure', prNumber }
  }

  // ── Auto-fix path ────────────────────────────────────────────────

  const attempt = trackFixAttempt(runInfo.owner, runInfo.repo, prNumber)
  console.log(
    `[ciRouter] CI failure on gigi's PR #${prNumber} — starting auto-fix (attempt ${attempt}/${MAX_FIX_ATTEMPTS})`
  )

  // Fetch CI logs
  const logs = await fetchRunLogs(runInfo.owner, runInfo.repo, runInfo.runId)

  // Build the failure context message
  const failureMessage = buildCIFailureMessage(runInfo, logs, attempt)

  // Find or create conversation for this PR
  try {
    const result = await invokeAgentForCIFix(runInfo, prNumber, failureMessage)
    return {
      action: 'agent_invoked',
      conclusion: 'failure',
      prNumber,
      conversationId: result.conversationId,
    }
  } catch (err) {
    console.error(`[ciRouter] Failed to invoke agent for CI fix:`, (err as Error).message)

    // Notify operator of the failure to auto-fix
    await notifyOperatorCIError(runInfo, prNumber, (err as Error).message)

    return { action: 'agent_failed', conclusion: 'failure', prNumber }
  }
}

// ─── Agent Invocation ───────────────────────────────────────────────

async function invokeAgentForCIFix(
  runInfo: CIRunInfo,
  prNumber: number,
  failureMessage: string,
): Promise<{ conversationId: string }> {
  // Look for existing conversation for this PR
  const tag = `${runInfo.repo}#${prNumber}`
  const prTag = `pr#${prNumber}`

  let conversation: store.Conversation | undefined
  let threadId: string | null = null

  // Try thread_refs first
  const thread = await threads.findThreadByRef(runInfo.repo, 'pr', prNumber)
  if (thread?.conversation_id) {
    const conv = await store.getConversation(thread.conversation_id)
    if (conv && (conv.status === 'active' || conv.status === 'paused')) {
      conversation = conv
      threadId = thread.id
    }
  }

  // Fall back to tag-based lookup
  if (!conversation) {
    const convs = await store.findByTag(tag)
    conversation = convs.find(c => c.status === 'active' || c.status === 'paused')
    if (!conversation) {
      const prConvs = await store.findByTag(prTag)
      conversation = prConvs.find(c => c.status === 'active' || c.status === 'paused')
    }
  }

  // Create new conversation if none exists
  if (!conversation) {
    conversation = await store.createConversation('webhook', `CI Fix: PR #${prNumber} in ${runInfo.repo}`)
    await store.updateConversation(conversation.id, {
      tags: [runInfo.repo, tag, prTag],
      repo: runInfo.repo,
      status: 'active',
    })

    // Create a thread for it
    const newThread = await threads.createThread({
      topic: `CI Fix: PR #${prNumber} in ${runInfo.repo}`,
      conversation_id: conversation.id,
      status: 'active',
    })
    threadId = newThread.id

    await threads.addThreadRef(newThread.id, {
      ref_type: 'pr',
      repo: runInfo.repo,
      number: prNumber,
      status: 'open',
    })
  }

  // Add the failure message to the conversation
  await store.addMessage(conversation.id, 'user', [{ type: 'text', text: failureMessage }], {
    message_type: 'ci_failure',
  } as store.MessageExtras)

  // Store as thread event
  if (threadId) {
    try {
      await threads.addThreadEvent(threadId, {
        channel: 'webhook',
        direction: 'inbound',
        actor: 'gitea-actions',
        content: [{ type: 'text', text: failureMessage }],
        message_type: 'ci_failure',
        metadata: {
          run_id: runInfo.runId,
          conclusion: runInfo.conclusion,
          workflow: runInfo.workflowName,
        },
      })
    } catch { /* ignore */ }
  }

  emit({ type: 'conversation_updated', conversationId: conversation.id, reason: 'ci_failure' })

  // Invoke the agent
  const history = await store.getMessages(conversation.id)
  const messages: AgentMessage[] = history.map(m => ({
    role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content as AgentMessage['content'],
  }))

  const onEvent = (agentEvent: Record<string, unknown>): void => {
    emit({ ...agentEvent, conversationId: conversation!.id } as import('../core/events').AgentEvent)
  }

  onEvent({ type: 'agent_start', conversationId: conversation.id })

  const response = await runAgent(messages, onEvent)

  // Store the agent's response
  await store.addMessage(conversation.id, 'assistant', [{ type: 'text', text: response.text }], {
    tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
    tool_outputs: Object.keys(response.toolResults).length ? response.toolResults : undefined,
    triggered_by: 'ci_failure',
  } as store.MessageExtras)

  // Store agent response as thread event
  if (threadId) {
    try {
      await threads.addThreadEvent(threadId, {
        channel: 'webhook',
        direction: 'outbound',
        actor: 'gigi',
        content: [{ type: 'text', text: response.text }],
        message_type: 'text',
        usage: response.usage || undefined,
        metadata: { triggered_by: 'ci_failure' },
      })
    } catch { /* ignore */ }
  }

  // Save session ID for continuation
  if (response.sessionId) {
    try {
      await store.setSessionId(conversation.id, response.sessionId)
      if (threadId) {
        await threads.setThreadSession(threadId, response.sessionId)
      }
    } catch (err) {
      console.warn('[ciRouter] Failed to store session ID:', (err as Error).message)
    }
  }

  console.log(`[ciRouter] Agent completed CI fix attempt for PR #${prNumber} in conversation ${conversation.id}`)
  return { conversationId: conversation.id }
}

// ─── Operator Notifications ─────────────────────────────────────────

async function notifyOperatorCIGaveUp(
  runInfo: CIRunInfo,
  prNumber: number,
  prTitle?: string,
): Promise<void> {
  const title = prTitle || `PR #${prNumber}`
  const message = [
    `⚠️ **CI Auto-fix gave up** on ${runInfo.owner}/${runInfo.repo}`,
    '',
    `PR: #${prNumber} — ${title}`,
    `Workflow: ${runInfo.workflowName}`,
    `Branch: ${runInfo.branch}`,
    runInfo.htmlUrl ? `Run: ${runInfo.htmlUrl}` : '',
    '',
    `Reached max fix attempts (${MAX_FIX_ATTEMPTS}). Manual intervention needed.`,
  ].filter(Boolean).join('\n')

  await notifyTelegram(message)
}

async function notifyOperatorCIError(
  runInfo: CIRunInfo,
  prNumber: number,
  errorMsg: string,
): Promise<void> {
  const message = [
    `❌ **CI Auto-fix error** on ${runInfo.owner}/${runInfo.repo}#${prNumber}`,
    `Error: ${errorMsg}`,
    runInfo.htmlUrl ? `Run: ${runInfo.htmlUrl}` : '',
  ].filter(Boolean).join('\n')

  await notifyTelegram(message)
}
