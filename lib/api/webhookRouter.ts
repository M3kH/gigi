/**
 * API — Webhook Router
 *
 * Routes Gitea webhook events to chat conversations by tag matching.
 * Auto-creates conversations for new issues/PRs, invokes agent on @gigi mentions.
 */

import * as store from '../core/store'
import { runAgent } from '../core/agent'
import { emit } from '../core/events'
import { notifyWebhook } from './webhookNotifier'

import type { AgentMessage } from '../core/agent'
import type { WebhookPayload, WebhookResult } from './webhooks'

// ─── Main Router ────────────────────────────────────────────────────

export const routeWebhook = async (event: string, payload: WebhookPayload): Promise<WebhookResult | null> => {
  const tags = extractTags(event, payload)
  if (!tags.length) return null

  let conversation = await findConversationByTags(tags)

  if (!conversation && shouldAutoCreate(event, payload)) {
    conversation = await createConversationForWebhook(event, payload, tags)
  }

  if (!conversation) {
    console.log(`[webhookRouter] No conversation found for tags:`, tags)
    return null
  }

  const systemMessage = formatWebhookEvent(event, payload)
  await store.addMessage(conversation.id, 'system', [{ type: 'text', text: systemMessage }], {
    message_type: 'webhook',
  })

  // Send Telegram notification for significant events (fire-and-forget)
  notifyWebhook(event, payload).catch(err =>
    console.warn('[webhookRouter] Telegram notification failed:', (err as Error).message)
  )

  const shouldInvokeAgent = await checkAndInvokeAgent(event, payload, conversation.id, systemMessage)

  if (shouldAutoClose(event, payload, conversation)) {
    await store.stopThread(conversation.id)
    emit({ type: 'thread_status', conversationId: conversation.id, status: 'stopped' })
    console.log(`[webhookRouter] Auto-stopped conversation ${conversation.id}`)
  }

  return { conversationId: conversation.id, tags, systemMessage, agentInvoked: shouldInvokeAgent }
}

// ─── Tag Extraction ─────────────────────────────────────────────────

const extractTags = (event: string, payload: WebhookPayload): string[] => {
  const tags: string[] = []
  const repo = payload.repository?.name
  if (!repo) return tags

  tags.push(repo)

  switch (event) {
    case 'issues':
      if (payload.issue?.number) tags.push(`${repo}#${payload.issue.number}`)
      break
    case 'issue_comment':
      if (payload.issue?.number) {
        tags.push(`${repo}#${payload.issue.number}`)
        // PR comments arrive as issue_comment — also tag with pr# for lookup
        if (payload.issue?.pull_request) tags.push(`pr#${payload.issue.number}`)
      }
      break
    case 'pull_request': {
      const prNum = payload.number || payload.pull_request?.number
      if (prNum) {
        tags.push(`${repo}#${prNum}`)
        tags.push(`pr#${prNum}`)
      }
      break
    }
    case 'pull_request_review_comment':
      if (payload.pull_request?.number) {
        tags.push(`${repo}#${payload.pull_request.number}`)
        tags.push(`pr#${payload.pull_request.number}`)
      }
      break
  }

  return tags
}

// ─── Conversation Lookup ────────────────────────────────────────────

const findConversationByTags = async (tags: string[]): Promise<store.Conversation | null> => {
  const prioritized = [...tags].sort((a, b) => {
    const aSpecific = a.includes('#')
    const bSpecific = b.includes('#')
    if (aSpecific && !bSpecific) return -1
    if (!aSpecific && bSpecific) return 1
    return 0
  })

  for (const tag of prioritized) {
    const conversations = await store.findByTag(tag)
    const match = conversations.find((c) => c.status === 'active' || c.status === 'paused')
    if (match) return match
  }

  return null
}

const shouldAutoCreate = (event: string, payload: WebhookPayload): boolean => {
  return (
    (event === 'issues' && payload.action === 'opened') ||
    (event === 'pull_request' && payload.action === 'opened')
  )
}

const createConversationForWebhook = async (
  event: string,
  payload: WebhookPayload,
  tags: string[]
): Promise<store.Conversation> => {
  const repo = payload.repository?.name
  let topic: string | null = null

  if (event === 'issues') {
    topic = `Issue #${payload.issue!.number}: ${payload.issue!.title}`
  } else if (event === 'pull_request') {
    const prNum = payload.number || payload.pull_request?.number
    topic = `PR #${prNum}: ${payload.pull_request!.title}`
  }

  const conversation = await store.createConversation('webhook', topic)
  await store.updateConversation(conversation.id, {
    tags,
    repo: repo,
    status: 'paused',
  })

  console.log(`[webhookRouter] Created conversation ${conversation.id} for ${topic}`)
  return conversation
}

const shouldAutoClose = (event: string, payload: WebhookPayload, conversation: store.Conversation): boolean => {
  if (conversation.status === 'stopped' || conversation.status === 'archived') return false
  return (
    (event === 'issues' && payload.action === 'closed') ||
    (event === 'pull_request' && (payload.action === 'closed' || payload.pull_request?.merged === true))
  )
}

// ─── Event Formatting ───────────────────────────────────────────────

const formatWebhookEvent = (event: string, payload: WebhookPayload): string => {
  const repo = payload.repository?.full_name || payload.repository?.name

  switch (event) {
    case 'issues':
      return formatIssueEvent(payload)
    case 'issue_comment':
      return formatIssueCommentEvent(payload)
    case 'pull_request':
      return formatPREvent(payload)
    case 'pull_request_review_comment':
      return formatPRReviewCommentEvent(payload)
    case 'push':
      return formatPushEvent(payload)
    default:
      return `[Webhook] ${event} in ${repo}`
  }
}

const formatIssueEvent = (payload: WebhookPayload): string => {
  const { action, issue } = payload
  const emoji: Record<string, string> = { opened: '📋', closed: '✅', reopened: '🔄', edited: '✏️' }
  return `${emoji[action!] || '📋'} Issue #${issue!.number} ${action}: "${issue!.title}" by @${issue?.user?.login}\n${issue?.html_url || ''}`
}

const formatIssueCommentEvent = (payload: WebhookPayload): string => {
  const { issue, comment } = payload
  const commentPreview = comment?.body?.slice(0, 200) || ''
  return `💬 @${comment?.user?.login} commented on issue #${issue!.number}:\n"${commentPreview}${commentPreview.length >= 200 ? '...' : ''}"\n${comment?.html_url || ''}`
}

const formatPREvent = (payload: WebhookPayload): string => {
  const { action, pull_request, number } = payload
  const pr = pull_request
  const prNum = number || pr?.number
  const emoji: Record<string, string> = {
    opened: '🔀',
    closed: pr?.merged ? '✅' : '❌',
    synchronized: '🔄',
    merged: '✅',
    reopened: '🔄',
  }
  const status = pr?.merged ? 'merged' : action
  return `${emoji[action!] || '🔀'} PR #${prNum} ${status}: "${pr?.title}" by @${pr?.user?.login}\n${pr?.head?.ref || ''} → ${pr?.base?.ref || ''}\n${pr?.html_url || ''}`
}

const formatPushEvent = (payload: WebhookPayload): string => {
  const commits = payload.commits || []
  const commitSummary = commits.slice(0, 3).map((c) => `  • ${c.message.split('\n')[0]}`).join('\n')
  const moreText = commits.length > 3 ? `\n  ... and ${commits.length - 3} more` : ''
  return `📤 @${payload.pusher?.login} pushed ${commits.length} commit(s) to ${payload.ref}:\n${commitSummary}${moreText}`
}

const formatPRReviewCommentEvent = (payload: WebhookPayload): string => {
  const { comment, pull_request } = payload
  const commentPreview = comment?.body?.slice(0, 200) || ''
  return `💬 @${comment?.user?.login} commented on PR #${pull_request!.number}:\n"${commentPreview}${commentPreview.length >= 200 ? '...' : ''}"\n${comment?.html_url || ''}`
}

// ─── @gigi Mention Handler ──────────────────────────────────────────

const checkAndInvokeAgent = async (
  event: string,
  payload: WebhookPayload,
  conversationId: string,
  systemMessage: string
): Promise<boolean> => {
  // In Gitea, comments on PRs arrive as 'issue_comment' (PRs are issues internally).
  // 'pull_request_review_comment' covers inline code review comments.
  // Note: 'pull_request' event never has action='commented' — that was dead code.
  const isComment = (
    (event === 'issue_comment' && payload.action === 'created') ||
    (event === 'pull_request_review_comment' && payload.action === 'created')
  )

  if (!isComment) return false

  const comment = payload.comment?.body || ''
  const author = payload.comment?.user?.login || ''

  const gigiMentioned = /@gigi\b/i.test(comment)
  if (!gigiMentioned || author === 'gigi') return false

  console.log(`[webhookRouter] @gigi mentioned by @${author} in conversation ${conversationId}`)

  try {
    const userMessage = comment.replace(/@gigi\b/gi, '').trim()
    const isTestFailure = userMessage.includes('Tests failed') && userMessage.includes('Test output')

    let contextMessage = `[GitHub Comment from @${author}]\n${userMessage}\n\nContext: ${systemMessage}`

    if (isTestFailure) {
      contextMessage += '\n\nNOTE: This is a test failure notification from the CI system. You should:\n1. Analyze the test output to understand what failed\n2. Look at the relevant test files and source code\n3. Create a fix and push it to the PR branch\n4. The tests will automatically re-run after your push'
    }

    await store.addMessage(conversationId, 'user', [{ type: 'text', text: contextMessage }], {
      message_type: 'github_mention',
      github_user: author,
    } as store.MessageExtras)

    const history = await store.getMessages(conversationId)
    const messages: AgentMessage[] = history.map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content as AgentMessage['content'],
    }))

    const onEvent = (event: Record<string, unknown>): void => {
      emit({ ...event, conversationId } as import('../core/events').AgentEvent)
    }

    onEvent({ type: 'agent_start', conversationId })

    const response = await runAgent(messages, onEvent)

    await store.addMessage(conversationId, 'assistant', [{ type: 'text', text: response.text }], {
      tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
      tool_outputs: Object.keys(response.toolResults).length ? response.toolResults : undefined,
      triggered_by: 'github_mention',
    } as store.MessageExtras)

    if (response.sessionId) {
      try {
        await store.setSessionId(conversationId, response.sessionId)
      } catch (err) {
        console.warn('[webhookRouter] Failed to store session ID:', (err as Error).message)
      }
    }

    console.log(`[webhookRouter] Agent completed response for @gigi mention in conversation ${conversationId}`)
    return true

  } catch (err) {
    console.error(`[webhookRouter] Failed to invoke agent for conversation ${conversationId}:`, err)

    await store.addMessage(conversationId, 'system', [{
      type: 'text',
      text: `❌ Failed to process @gigi mention: ${(err as Error).message}`,
    }], {
      message_type: 'error',
    })

    return false
  }
}
