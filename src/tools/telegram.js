import { getConfig } from '../store.js'

let bot = null

export const setBotInstance = (b) => { bot = b }

export const telegramTool = {
  name: 'telegram_send',
  description: 'Send a message to Mauro on Telegram. Use for notifications, status updates, PR links, alerts.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Message text (supports Markdown)' }
    },
    required: ['text']
  }
}

export const runTelegram = async ({ text }) => {
  if (!bot) return 'Telegram bot not initialized'

  const chatId = await getConfig('telegram_chat_id')
  if (!chatId) return 'Telegram chat ID not configured — send /start to the bot first'

  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' })
    return 'Message sent to Mauro on Telegram'
  } catch (err) {
    // Fallback without markdown if it fails
    try {
      await bot.api.sendMessage(chatId, text)
      return 'Message sent (without markdown formatting)'
    } catch (retryErr) {
      throw new Error(`Failed to send Telegram message: ${retryErr.message}`)
    }
  }
}
