/**
 * Cross-Channel Response Routing
 *
 * Determines how agent responses should be delivered across channels.
 * Each response has a primary channel (originating) and optional
 * cross-channel notifications.
 *
 * See issue #45 for full specification.
 */

import type { ThreadEventChannel } from './threads'

// ── Types ────────────────────────────────────────────────────────────

export type NotifyCondition = 'always' | 'significant' | 'never'

export interface ResponseRouting {
  /** Always respond on originating channel */
  primary: ThreadEventChannel
  /** Optional cross-post to other channels */
  notify?: ThreadEventChannel[]
  /** Condition for cross-posting */
  notifyCondition?: NotifyCondition
}

export interface DeliveryMetadata {
  /** Channels this message was delivered to */
  delivered_to: ThreadEventChannel[]
  /** Whether this was cross-posted to a non-primary channel */
  cross_posted: boolean
  /** Channel-specific IDs (e.g., telegram_msg_id) */
  telegram_msg_id?: number
  /** The originating channel that triggered this response */
  originating_channel?: ThreadEventChannel
}

export interface NotificationRule {
  /** Which channel types trigger notifications */
  sourceChannels: ThreadEventChannel[]
  /** Which channels to notify */
  targetChannels: ThreadEventChannel[]
  /** When to notify */
  condition: NotifyCondition
  /** Human-readable description */
  description: string
}

// ── Default Notification Rules ───────────────────────────────────────

/**
 * Default notification rules:
 * - Webhook events on telegram-originated threads -> notify via telegram
 * - Everything else -> respond only on originating channel
 */
export const DEFAULT_NOTIFICATION_RULES: NotificationRule[] = [
  {
    sourceChannels: ['webhook', 'gitea_comment', 'gitea_review'],
    targetChannels: ['telegram'],
    condition: 'significant',
    description: 'Notify on Telegram when webhook events arrive on threads with Telegram activity',
  },
]

// ── Routing Logic ────────────────────────────────────────────────────

/**
 * Determine response routing for a given channel and context.
 *
 * @param originatingChannel - The channel the message came from
 * @param threadChannels - All channels that have been used in this thread
 * @param rules - Notification rules to apply (defaults to DEFAULT_NOTIFICATION_RULES)
 */
export const determineRouting = (
  originatingChannel: ThreadEventChannel,
  threadChannels: ThreadEventChannel[],
  rules: NotificationRule[] = DEFAULT_NOTIFICATION_RULES,
): ResponseRouting => {
  const routing: ResponseRouting = {
    primary: originatingChannel,
  }

  // Check each rule to see if cross-posting is needed
  const notifyChannels = new Set<ThreadEventChannel>()

  for (const rule of rules) {
    // Does this rule apply to the originating channel?
    if (!rule.sourceChannels.includes(originatingChannel)) continue

    // Check if any target channels have been active in this thread
    for (const target of rule.targetChannels) {
      if (target === originatingChannel) continue // Don't cross-post to self
      if (threadChannels.includes(target)) {
        notifyChannels.add(target)
        routing.notifyCondition = routing.notifyCondition ?? rule.condition
      }
    }
  }

  if (notifyChannels.size > 0) {
    routing.notify = [...notifyChannels]
  }

  return routing
}

/**
 * Check if an event is "significant" enough for cross-channel notification.
 *
 * Significant events include:
 * - PR opened/merged/closed
 * - Issue opened/closed
 * - Comments with @gigi mentions
 * - Agent responses that include PR/issue links
 *
 * Non-significant events:
 * - Push events
 * - Simple status updates
 * - System events
 */
export const isSignificantEvent = (
  messageType: string,
  content: string,
  metadata?: Record<string, unknown>,
): boolean => {
  // Webhook events for issue/PR lifecycle are significant
  if (messageType === 'webhook') {
    const event = metadata?.event as string | undefined
    const action = metadata?.action as string | undefined

    if (event === 'issues' && (action === 'opened' || action === 'closed')) return true
    if (event === 'pull_request' && (action === 'opened' || action === 'closed')) return true
    if (event === 'issue_comment' || event === 'pull_request_review_comment') return true
    if (event === 'push') return false

    return false
  }

  // Agent responses mentioning PRs or issues are significant
  if (content.includes('PR #') || content.includes('PR created') || content.includes('PR merged')) return true
  if (content.includes('issue #') || content.includes('issue created')) return true

  // Comments mentioning @gigi are significant
  if (/@gigi\b/i.test(content)) return true

  return false
}

/**
 * Build delivery metadata for a thread event.
 */
export const buildDeliveryMetadata = (
  originatingChannel: ThreadEventChannel,
  deliveredTo: ThreadEventChannel[],
  extras?: Record<string, unknown>,
): DeliveryMetadata => {
  return {
    delivered_to: deliveredTo,
    cross_posted: deliveredTo.length > 1 || (deliveredTo.length === 1 && deliveredTo[0] !== originatingChannel),
    originating_channel: originatingChannel,
    ...extras,
  }
}

/**
 * Get the unique set of channels that have events in a thread.
 * Used to determine which channels are "active" in a thread.
 */
export const getThreadActiveChannels = async (
  threadId: string,
  getPool: () => import('pg').Pool,
): Promise<ThreadEventChannel[]> => {
  const pool = getPool()
  const { rows } = await pool.query(
    `SELECT DISTINCT channel FROM thread_events
     WHERE thread_id = $1 AND is_compacted = false
     ORDER BY channel`,
    [threadId]
  )
  return rows.map(r => r.channel as ThreadEventChannel)
}
