/**
 * MCP Tool — Telegram Send
 *
 * Sends messages to Mauro on Telegram via the bot instance.
 */

import type { Bot } from 'grammy'
import { getConfig } from '../core/store'

let bot: Bot | null = null

export const setBotInstance = (b: Bot): void => {
  bot = b
}

export const telegramTool = {
  name: 'telegram_send',
  description: 'Send a message to Mauro on Telegram. Use for notifications, status updates, PR links, alerts.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Message text (supports Markdown)' },
    },
    required: ['text'],
  },
}

export const runTelegram = async ({ text }: { text: string }): Promise<string> => {
  if (!bot) return 'Telegram bot not initialized'

  const chatId = await getConfig('telegram_chat_id')
  if (!chatId) return 'Telegram chat ID not configured — send /start to the bot first'

  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' })
    return 'Message sent to Mauro on Telegram'
  } catch {
    // Fallback without markdown if it fails
    try {
      await bot.api.sendMessage(chatId, text)
      return 'Message sent (without markdown formatting)'
    } catch (retryErr) {
      throw new Error(`Failed to send Telegram message: ${(retryErr as Error).message}`)
    }
  }
}
