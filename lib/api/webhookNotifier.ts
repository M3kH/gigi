/**
 * Webhook → Telegram Notifier
 *
 * Listens to meaningful webhook events and sends templated Telegram messages.
 * Only notifies for significant events — not every push or edit.
 */

import type { Bot } from 'grammy'
import { getConfig } from '../core/store'

let bot: Bot | null = null

export const setNotifierBot = (b: Bot): void => {
  bot = b
}

interface WebhookPayload {
  action?: string
  repository?: { name?: string; full_name?: string; html_url?: string }
  issue?: { number?: number; title?: string; html_url?: string; user?: { login?: string }; state?: string }
  pull_request?: { number?: number; title?: string; html_url?: string; user?: { login?: string }; merged?: boolean; head?: { ref?: string }; base?: { ref?: string } }
  number?: number
  comment?: { body?: string; user?: { login?: string }; html_url?: string }
  pusher?: { login?: string }
  ref?: string
  commits?: Array<{ message: string }>
  sender?: { login?: string }
}

/**
 * Determine if this webhook event should trigger a Telegram notification.
 * We only notify for significant, actionable events.
 */
const shouldNotify = (event: string, payload: WebhookPayload): boolean => {
  // Skip our own actions (gigi bot user)
  const sender = payload.sender?.login || payload.pusher?.login || ''
  if (sender === 'gigi') return false

  switch (event) {
    case 'issues':
      return payload.action === 'opened' || payload.action === 'closed'
    case 'pull_request':
      return payload.action === 'opened' || payload.pull_request?.merged === true || payload.action === 'closed'
    case 'issue_comment':
      // Only notify for @gigi mentions (the rest is handled by the agent)
      return payload.action === 'created' && /@gigi\b/i.test(payload.comment?.body || '')
    case 'push':
      // Only notify for pushes to main/master
      return payload.ref === 'refs/heads/main' || payload.ref === 'refs/heads/master'
    default:
      return false
  }
}

/**
 * Format a webhook event into a concise Telegram message.
 */
const formatNotification = (event: string, payload: WebhookPayload): string => {
  const repo = payload.repository?.full_name || payload.repository?.name || 'unknown'

  switch (event) {
    case 'issues': {
      const { action, issue } = payload
      if (action === 'opened') {
        return `📋 *New issue* in \`${repo}\`\n[#${issue?.number}: ${escapeMarkdown(issue?.title || '')}](${issue?.html_url})\nby @${issue?.user?.login}`
      }
      if (action === 'closed') {
        return `✅ *Issue closed* in \`${repo}\`\n[#${issue?.number}: ${escapeMarkdown(issue?.title || '')}](${issue?.html_url})`
      }
      break
    }

    case 'pull_request': {
      const pr = payload.pull_request
      const prNum = payload.number || pr?.number
      if (pr?.merged) {
        return `🎉 *PR merged* in \`${repo}\`\n[#${prNum}: ${escapeMarkdown(pr?.title || '')}](${pr?.html_url})\n\`${pr?.head?.ref}\` → \`${pr?.base?.ref}\``
      }
      if (payload.action === 'opened') {
        return `🔀 *New PR* in \`${repo}\`\n[#${prNum}: ${escapeMarkdown(pr?.title || '')}](${pr?.html_url})\n\`${pr?.head?.ref}\` → \`${pr?.base?.ref}\`\nby @${pr?.user?.login}`
      }
      if (payload.action === 'closed') {
        return `❌ *PR closed* in \`${repo}\`\n[#${prNum}: ${escapeMarkdown(pr?.title || '')}](${pr?.html_url})`
      }
      break
    }

    case 'issue_comment': {
      const { issue, comment } = payload
      return `💬 *@gigi mentioned* on issue #${issue?.number} in \`${repo}\`\nby @${comment?.user?.login}\n${comment?.html_url}`
    }

    case 'push': {
      const commits = payload.commits || []
      const branch = payload.ref?.replace('refs/heads/', '') || 'unknown'
      const summary = commits.slice(0, 3).map(c => `• ${c.message.split('\n')[0]}`).join('\n')
      const more = commits.length > 3 ? `\n_...and ${commits.length - 3} more_` : ''
      return `📤 *Push to \`${branch}\`* in \`${repo}\`\n${commits.length} commit(s) by @${payload.pusher?.login}\n${summary}${more}`
    }
  }

  return `🔔 *Webhook* \`${event}\` in \`${repo}\``
}

/**
 * Escape special Markdown characters for Telegram.
 */
const escapeMarkdown = (text: string): string => {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

/**
 * Send a Telegram notification for a webhook event.
 * Returns true if notification was sent, false if skipped.
 */
export const notifyWebhook = async (event: string, payload: WebhookPayload): Promise<boolean> => {
  if (!bot) return false
  if (!shouldNotify(event, payload)) return false

  const chatId = await getConfig('telegram_chat_id')
  if (!chatId) return false

  const message = formatNotification(event, payload)

  try {
    await bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' })
    console.log(`[webhookNotifier] Sent Telegram notification for ${event}`)
    return true
  } catch {
    // Retry without markdown
    try {
      const plainMessage = message.replace(/[*_`\[\]()]/g, '')
      await bot.api.sendMessage(chatId, plainMessage)
      console.log(`[webhookNotifier] Sent Telegram notification (plain) for ${event}`)
      return true
    } catch (retryErr) {
      console.error(`[webhookNotifier] Failed to send notification:`, (retryErr as Error).message)
      return false
    }
  }
}
