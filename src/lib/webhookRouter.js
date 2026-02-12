import * as store from '../store.js'

/**
 * Routes webhook events to appropriate chat conversations based on tags.
 * Creates new conversations for new issues/PRs, appends system messages to existing chats.
 */

export const routeWebhook = async (event, payload) => {
  const tags = extractTags(event, payload)
  if (!tags.length) return null

  // Lookup existing conversation by tags
  let conversation = await findConversationByTags(tags)

  // Auto-create conversation for new issues/PRs
  if (!conversation && shouldAutoCreate(event, payload)) {
    conversation = await createConversationForWebhook(event, payload, tags)
  }

  if (!conversation) {
    console.log(`[webhookRouter] No conversation found for tags:`, tags)
    return null
  }

  // Format and append system message
  const systemMessage = formatWebhookEvent(event, payload)
  await store.addMessage(conversation.id, 'system', [{ type: 'text', text: systemMessage }], {
    message_type: 'webhook'
  })

  // Auto-close conversation if issue/PR closed
  if (shouldAutoClose(event, payload, conversation)) {
    await store.closeConversation(conversation.id)
    console.log(`[webhookRouter] Auto-closed conversation ${conversation.id}`)
  }

  return { conversationId: conversation.id, tags, systemMessage }
}

const extractTags = (event, payload) => {
  const tags = []
  const repo = payload.repository?.name

  if (!repo) return tags

  tags.push(repo)

  switch (event) {
    case 'issues':
      if (payload.issue?.number) {
        tags.push(`${repo}#${payload.issue.number}`)
      }
      break
    case 'issue_comment':
      if (payload.issue?.number) {
        tags.push(`${repo}#${payload.issue.number}`)
      }
      break
    case 'pull_request':
      if (payload.number || payload.pull_request?.number) {
        const prNum = payload.number || payload.pull_request.number
        tags.push(`${repo}#${prNum}`)
        tags.push(`pr#${prNum}`)
      }
      break
  }

  return tags
}

const findConversationByTags = async (tags) => {
  // Try each tag, prioritizing specific tags (issue#N, pr#N) over general (repo)
  const prioritized = [...tags].sort((a, b) => {
    const aSpecific = a.includes('#')
    const bSpecific = b.includes('#')
    if (aSpecific && !bSpecific) return -1
    if (!aSpecific && bSpecific) return 1
    return 0
  })

  for (const tag of prioritized) {
    const conversations = await store.findByTag(tag)
    // Return the most recent open or active conversation
    const match = conversations.find(c => c.status === 'open' || c.status === 'active')
    if (match) return match
  }

  return null
}

const shouldAutoCreate = (event, payload) => {
  return (
    (event === 'issues' && payload.action === 'opened') ||
    (event === 'pull_request' && payload.action === 'opened')
  )
}

const createConversationForWebhook = async (event, payload, tags) => {
  const repo = payload.repository?.name
  let topic = null

  if (event === 'issues') {
    topic = `Issue #${payload.issue.number}: ${payload.issue.title}`
  } else if (event === 'pull_request') {
    const prNum = payload.number || payload.pull_request?.number
    topic = `PR #${prNum}: ${payload.pull_request.title}`
  }

  const conversation = await store.createConversation('webhook', topic)
  await store.updateConversation(conversation.id, {
    tags,
    repo,
    status: 'open'
  })

  console.log(`[webhookRouter] Created conversation ${conversation.id} for ${topic}`)
  return conversation
}

const shouldAutoClose = (event, payload, conversation) => {
  if (conversation.status === 'closed') return false

  return (
    (event === 'issues' && payload.action === 'closed') ||
    (event === 'pull_request' && (payload.action === 'closed' || payload.pull_request?.merged))
  )
}

const formatWebhookEvent = (event, payload) => {
  const repo = payload.repository?.full_name || payload.repository?.name

  switch (event) {
    case 'issues':
      return formatIssueEvent(payload, repo)
    case 'issue_comment':
      return formatIssueCommentEvent(payload, repo)
    case 'pull_request':
      return formatPREvent(payload, repo)
    case 'push':
      return formatPushEvent(payload, repo)
    default:
      return `[Webhook] ${event} in ${repo}`
  }
}

const formatIssueEvent = (payload, repo) => {
  const { action, issue } = payload
  const emoji = {
    opened: '📋',
    closed: '✅',
    reopened: '🔄',
    edited: '✏️'
  }[action] || '📋'

  return `${emoji} Issue #${issue.number} ${action}: "${issue.title}" by @${issue.user?.login}\n${payload.issue?.html_url || ''}`
}

const formatIssueCommentEvent = (payload, repo) => {
  const { action, issue, comment } = payload
  const commentPreview = comment?.body?.slice(0, 200) || ''

  return `💬 @${comment?.user?.login} commented on issue #${issue.number}:\n"${commentPreview}${commentPreview.length >= 200 ? '...' : ''}"\n${comment?.html_url || ''}`
}

const formatPREvent = (payload, repo) => {
  const { action, pull_request, number } = payload
  const pr = pull_request
  const prNum = number || pr?.number

  const emoji = {
    opened: '🔀',
    closed: pr?.merged ? '✅' : '❌',
    synchronized: '🔄',
    merged: '✅',
    reopened: '🔄'
  }[action] || '🔀'

  const status = pr?.merged ? 'merged' : action
  return `${emoji} PR #${prNum} ${status}: "${pr?.title}" by @${pr?.user?.login}\n${pr?.head?.ref || ''} → ${pr?.base?.ref || ''}\n${pr?.html_url || ''}`
}

const formatPushEvent = (payload, repo) => {
  const commits = payload.commits || []
  const commitSummary = commits.slice(0, 3).map(c => `  • ${c.message.split('\n')[0]}`).join('\n')
  const moreText = commits.length > 3 ? `\n  ... and ${commits.length - 3} more` : ''

  return `📤 @${payload.pusher?.login} pushed ${commits.length} commit(s) to ${payload.ref}:\n${commitSummary}${moreText}`
}
