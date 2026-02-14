/**
 * API Telegram — Telegram integration types.
 */

export interface TelegramConfig {
  token: string
  chatId: string
}

export interface TelegramMessage {
  text: string
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML'
  chatId?: string
}
