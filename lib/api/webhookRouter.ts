/**
 * API — Webhook Router
 *
 * Routes Gitea webhook events to threads via thread_refs lookup.
 * Falls back to legacy tag-based conversation lookup for backward compat.
 * Auto-creates threads for new issues/PRs, invokes agent on @gigi mentions.
 */

import * as store from '../core/store'
import * as threads from '../core/threads'
import { runAgent } from '../core/agent'
import { emit } from '../core/events'
import { notifyWebhook, notifyThreadEvent } from './webhookNotifier'
import {
  determineRouting,
  isSignificantEvent,
  buildDeliveryMetadata,
  getThreadActiveChannels,
} from '../core/response-routing'

import type { AgentMessage } from '../core/agent'
import type { WebhookPayload, WebhookResult } from './webhooks'

// ─── Ref Extraction ─────────────────────────────────────────────────

interface WebhookRef {
  repo: string
  ref_type: 'issue' | 'pr'
  number: number
}

/**
 * Extract structured refs from a webhook payload.
 * Returns the refs that should be used for thread lookup.
 */
const extractRefs = (event: string, payload: WebhookPayload): WebhookRef[] => {
  const refs: WebhookRef[] = []
  const repo = payload.repository?.name
  if (!repo) return refs

  switch (event) {
    case 'issues':
      if (payload.issue?.number) {
        refs.push({ repo, ref_type: 'issue', number: payload.issue.number })
      }
      break
    case 'issue_comment':
      if (payload.issue?.number) {
        // PR comments arrive as issue_comment — check if it's a PR
        if (payload.issue?.pull_request) {
          refs.push({ repo, ref_type: 'pr', number: payload.issue.number })
        } else {
          refs.push({ repo, ref_type: 'issue', number: payload.issue.number })
        }
      }
      break
    case 'pull_request': {
      const prNum = payload.number || payload.pull_request?.number
      if (prNum) {
        refs.push({ repo, ref_type: 'pr', number: prNum })
      }
      break
    }
    case 'pull_request_review_comment':
      if (payload.pull_request?.number) {
        refs.push({ repo, ref_type: 'pr', number: payload.pull_request.number })
      }
      break
  }

  return refs
}

// ─── Legacy Tag Extraction (backward compat) ─────────────────────────

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

// ─── Thread + Conversation Resolution ────────────────────────────────

/**
 * Find a conversation by thread_refs first, then fall back to tag-based lookup.
 * This is the hybrid approach during migration: thread_refs are preferred,
 * but old conversations that predate the thread model are still found by tags.
 */
const findConversation = async (
  refs: WebhookRef[],
  tags: string[]
): Promise<{ conversation: store.Conversation; threadId: string | null } | null> => {
  // 1. Try thread_refs lookup (preferred — unified model)
  for (const ref of refs) {
    const thread = await threads.findThreadByRef(ref.repo, ref.ref_type, ref.number)
    if (thread && thread.conversation_id) {
      const conv = await store.getConversation(thread.conversation_id)
      if (conv && (conv.status === 'active' || conv.status === 'paused')) {
        console.log(`[webhookRouter] Found thread ${thread.id} via ref ${ref.repo}/${ref.ref_type}#${ref.number}`)
        return { conversation: conv, threadId: thread.id }
      }
    }
  }

  // 2. Fall back to legacy tag-based lookup
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
    if (match) {
      // Check if this conversation has a linked thread
      const pool = store.getPool()
      const { rows } = await pool.query(
        'SELECT id FROM threads WHERE conversation_id = $1 LIMIT 1',
        [match.id]
      )
      const threadId = rows[0]?.id || null
      return { conversation: match, threadId }
    }
  }

  return null
}

const shouldAutoCreate = (event: string, payload: WebhookPayload): boolean => {
  return (
    (event === 'issues' && payload.action === 'opened') ||
    (event === 'pull_request' && payload.action === 'opened')
  )
}

/**
 * Create a conversation + thread for a new webhook event.
 * Links the thread to the issue/PR via thread_refs.
 */
const createForWebhook = async (
  event: string,
  payload: WebhookPayload,
  tags: string[],
  refs: WebhookRef[]
): Promise<{ conversation: store.Conversation; threadId: string }> => {
  const repo = payload.repository?.name
  let topic: string | null = null

  if (event === 'issues' || (event === 'issue_comment' && !payload.issue?.pull_request)) {
    topic = `Issue #${payload.issue!.number}: ${payload.issue!.title}`
  } else if (event === 'pull_request') {
    const prNum = payload.number || payload.pull_request?.number
    topic = `PR #${prNum}: ${payload.pull_request!.title}`
  } else if (event === 'issue_comment' && payload.issue?.pull_request) {
    topic = `PR #${payload.issue!.number}: ${payload.issue!.title}`
  } else if (event === 'pull_request_review_comment' && payload.pull_request) {
    topic = `PR #${payload.pull_request.number}: ${payload.pull_request.title}`
  }

  // Create conversation (backward compat)
  const conversation = await store.createConversation('webhook', topic)
  await store.updateConversation(conversation.id, {
    tags,
    repo: repo,
    status: 'paused',
  })

  // Create thread linked to conversation
  const thread = await threads.createThread({
    topic: topic ?? undefined,
    conversation_id: conversation.id,
    status: 'paused',
  })

  // Add thread_refs for each extracted ref
  for (const ref of refs) {
    const url = ref.ref_type === 'issue'
      ? payload.issue?.html_url
      : payload.pull_request?.html_url
    await threads.addThreadRef(thread.id, {
      ref_type: ref.ref_type,
      repo: ref.repo,
      number: ref.number,
      url: url || undefined,
      status: 'open',
    })
  }

  console.log(`[webhookRouter] Created conversation ${conversation.id} + thread ${thread.id} for ${topic}`)
  return { conversation, threadId: thread.id }
}

const shouldAutoClose = (event: string, payload: WebhookPayload, conversation: store.Conversation): boolean => {
  if (conversation.status === 'stopped' || conversation.status === 'archived') return false
  return (
    (event === 'issues' && payload.action === 'closed') ||
    (event === 'pull_request' && (payload.action === 'closed' || payload.pull_request?.merged === true))
  )
}

// ─── Main Router ────────────────────────────────────────────────────

export const routeWebhook = async (event: string, payload: WebhookPayload): Promise<WebhookResult | null> => {
  const refs = extractRefs(event, payload)
  const tags = extractTags(event, payload)
  if (!tags.length && !refs.length) return null

  let result = await findConversation(refs, tags)
  let threadId: string | null = null

  if (!result && shouldAutoCreate(event, payload)) {
    const created = await createForWebhook(event, payload, tags, refs)
    result = { conversation: created.conversation, threadId: created.threadId }
  }

  // Auto-create conversation if @gigi is mentioned in a comment on an untracked issue/PR.
  // This handles cases where the issue was created before the webhook system existed,
  // or where the creation event was filtered (e.g., self-generated by gigi).
  if (!result) {
    const hasGigiMention = (
      (event === 'issue_comment' || event === 'pull_request_review_comment') &&
      payload.action === 'created' &&
      /@gigi\b/i.test(payload.comment?.body || '') &&
      payload.comment?.user?.login !== 'gigi'
    )

    if (hasGigiMention && refs.length > 0) {
      console.log(`[webhookRouter] Auto-creating conversation for @gigi mention on untracked ${refs[0].ref_type}#${refs[0].number}`)
      const created = await createForWebhook(event, payload, tags, refs)
      result = { conversation: created.conversation, threadId: created.threadId }
    }
  }

  if (!result) {
    console.log(`[webhookRouter] No conversation found for refs:`, refs, 'tags:', tags)
    return null
  }

  const { conversation } = result
  threadId = result.threadId

  // Update thread_ref status when issues/PRs are closed/merged
  if (event === 'issues' && payload.action === 'closed' && refs.length > 0) {
    for (const ref of refs) {
      try {
        await threads.updateThreadRefStatus(ref.repo, ref.ref_type, ref.number, 'closed')
      } catch { /* ignore */ }
    }
  }
  if (event === 'pull_request' && refs.length > 0) {
    const prStatus = payload.pull_request?.merged ? 'merged' : payload.action === 'closed' ? 'closed' : null
    if (prStatus) {
      for (const ref of refs) {
        try {
          await threads.updateThreadRefStatus(ref.repo, ref.ref_type, ref.number, prStatus)
        } catch { /* ignore */ }
      }
    }
  }

  const systemMessage = formatWebhookEvent(event, payload)

  // Store in messages table (backward compat)
  await store.addMessage(conversation.id, 'system', [{ type: 'text', text: systemMessage }], {
    message_type: 'webhook',
  })

  // Notify frontend that this conversation has new messages
  emit({ type: 'conversation_updated', conversationId: conversation.id, reason: 'webhook_message' })

  // Store as thread event with delivery metadata
  if (threadId) {
    try {
      // Determine cross-channel routing for this webhook event
      const threadChannels = await getThreadActiveChannels(threadId, store.getPool)
      const routing = determineRouting('webhook', threadChannels)

      const deliveredTo: threads.ThreadEventChannel[] = ['webhook']

      // Check if we should cross-post to other channels
      const shouldCrossPost = routing.notify && routing.notify.length > 0 && (
        routing.notifyCondition === 'always' ||
        (routing.notifyCondition === 'significant' && isSignificantEvent(
          'webhook',
          systemMessage,
          { event, action: payload.action },
        ))
      )

      if (shouldCrossPost && routing.notify) {
        deliveredTo.push(...routing.notify)
      }

      const deliveryMeta = buildDeliveryMetadata('webhook', deliveredTo)

      await threads.addThreadEvent(threadId, {
        channel: 'webhook',
        direction: 'inbound',
        actor: payload.sender?.login || payload.pusher?.login || 'system',
        content: [{ type: 'text', text: systemMessage }],
        message_type: 'webhook',
        metadata: { event, action: payload.action, delivery: deliveryMeta },
      })

      // Cross-channel notification: send thread-aware Telegram notification
      // This is different from the generic notifyWebhook — it includes thread context
      if (shouldCrossPost && routing.notify?.includes('telegram')) {
        const thread = await threads.getThread(threadId)
        notifyThreadEvent(event, payload, thread?.topic || null).catch(err =>
          console.warn('[webhookRouter] Cross-channel Telegram notification failed:', (err as Error).message)
        )
      }
    } catch (err) {
      console.warn('[webhookRouter] Thread event failed:', (err as Error).message)
    }
  }

  // Send generic Telegram notification for significant events (fire-and-forget)
  // This fires for ALL webhook events regardless of thread — existing behavior
  notifyWebhook(event, payload).catch(err =>
    console.warn('[webhookRouter] Telegram notification failed:', (err as Error).message)
  )

  const shouldInvokeAgent = await checkAndInvokeAgent(event, payload, conversation.id, systemMessage, threadId)

  if (shouldAutoClose(event, payload, conversation)) {
    await store.stopThread(conversation.id)
    if (threadId) {
      try { await threads.updateThreadStatus(threadId, 'stopped') } catch { /* ignore */ }
    }
    emit({ type: 'thread_status', conversationId: conversation.id, status: 'stopped' })
    console.log(`[webhookRouter] Auto-stopped conversation ${conversation.id}`)
  }

  return { conversationId: conversation.id, tags, systemMessage, agentInvoked: shouldInvokeAgent }
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
  systemMessage: string,
  threadId: string | null
): Promise<boolean> => {
  // In Gitea, comments on PRs arrive as 'issue_comment' (PRs are issues internally).
  // 'pull_request_review_comment' covers inline code review comments.
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

    // Also store as thread event
    if (threadId) {
      try {
        await threads.addThreadEvent(threadId, {
          channel: 'gitea_comment',
          direction: 'inbound',
          actor: `@${author}`,
          content: [{ type: 'text', text: contextMessage }],
          message_type: 'text',
          metadata: { event, github_user: author },
        })
      } catch { /* ignore */ }
    }

    const history = await store.getMessages(conversationId)
    const messages: AgentMessage[] = history.map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content as AgentMessage['content'],
    }))

    const onEvent = (agentEvent: Record<string, unknown>): void => {
      emit({ ...agentEvent, conversationId } as import('../core/events').AgentEvent)
    }

    onEvent({ type: 'agent_start', conversationId })

    const response = await runAgent(messages, onEvent)

    await store.addMessage(conversationId, 'assistant', [{ type: 'text', text: response.text }], {
      tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
      tool_outputs: Object.keys(response.toolResults).length ? response.toolResults : undefined,
      triggered_by: 'github_mention',
    } as store.MessageExtras)

    // Store agent response as thread event with delivery metadata
    if (threadId) {
      try {
        const deliveryMeta = buildDeliveryMetadata('gitea_comment', ['gitea_comment'])
        await threads.addThreadEvent(threadId, {
          channel: 'gitea_comment',
          direction: 'outbound',
          actor: 'gigi',
          content: [{ type: 'text', text: response.text }],
          message_type: 'text',
          usage: response.usage || undefined,
          metadata: { delivery: deliveryMeta },
        })
      } catch { /* ignore */ }
    }

    if (response.sessionId) {
      try {
        await store.setSessionId(conversationId, response.sessionId)
        if (threadId) {
          await threads.setThreadSession(threadId, response.sessionId)
        }
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
