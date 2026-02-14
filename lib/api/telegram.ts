/**
 * API — Telegram Bot Integration
 *
 * Grammy-based Telegram bot with commands, message handling,
 * chat locking, and auto-retry for incomplete work.
 */

import { Bot } from 'grammy'
import { getConfig, setConfig } from '../core/store'
import * as store from '../core/store'
import { handleMessage, newConversation, resumeConversation, clearConversation } from '../core/router'
import { setBotInstance } from '../tools/telegram'

let bot: Bot | null = null

export const startTelegram = async (): Promise<Bot | null> => {
  const token = await getConfig('telegram_token')
  if (!token) return null

  console.log('Telegram bot starting...')

  bot = new Bot(token)
  setBotInstance(bot)

  // Verify token works before setting up handlers
  try {
    const me = await bot.api.getMe()
    console.log(`Telegram bot authenticated as @${me.username}`)
  } catch (err) {
    console.error('Telegram bot auth failed:', (err as Error).message)
    throw err
  }

  // Lock to Mauro's chat ID
  bot.use(async (ctx, next) => {
    const chatId = String(ctx.chat?.id)
    const stored = await getConfig('telegram_chat_id')

    if (!stored) {
      await setConfig('telegram_chat_id', chatId)
      await ctx.reply('Locked to this chat. Gigi is ready!')
      return
    }

    if (chatId !== stored) {
      await ctx.reply('Unauthorized.')
      return
    }

    await next()
  })

  bot.command('start', async (ctx) => {
    await ctx.reply('Hey Mauro! Gigi here. What can I do for you?')
  })

  bot.command('new', async (ctx) => {
    newConversation('telegram', String(ctx.chat.id))
    await ctx.reply('Started a fresh conversation.')
  })

  bot.command('resume', async (ctx) => {
    const chatId = String(ctx.chat.id)
    const arg = ctx.match?.trim() || 'latest'

    try {
      let conv
      if (arg === 'latest') {
        conv = await store.findLatest('telegram')
      } else {
        const matches = await store.findByTag(arg)
        conv = matches[0] ?? null
      }

      if (!conv) {
        await ctx.reply('No matching conversation found.')
        return
      }

      resumeConversation('telegram', chatId, conv.id)
      const tags = conv.tags?.length ? conv.tags.join(', ') : 'none'
      const date = new Date(conv.updated_at).toLocaleDateString()
      await ctx.reply(`Resumed conversation from ${date} (tags: ${tags})`)
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`)
    }
  })

  bot.command('clear', async (ctx) => {
    const chatId = String(ctx.chat.id)
    await clearConversation('telegram', chatId)
    await ctx.reply('Conversation closed.')
  })

  bot.command('status', async (ctx) => {
    const { healthCheck } = await import('../core/health.js')
    const status = await healthCheck()
    const lines = Object.entries(status.checks)
      .map(([k, v]) => `${v === 'ok' || v === 'configured' ? '✅' : '❌'} ${k}: ${v}`)
    await ctx.reply(`Phase: ${status.phase}\n${lines.join('\n')}`)
  })

  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat.id)
    const text = ctx.message.text

    const oauthToken = await getConfig('claude_oauth_token')
    if (!oauthToken) {
      await ctx.reply('Claude is not configured yet. Open claude.cluster.local to complete setup.')
      return
    }

    await ctx.reply('👀 On it...')

    let keepTyping = true
    const typingInterval = setInterval(() => {
      if (keepTyping) ctx.replyWithChatAction('typing').catch(() => {})
    }, 5000)
    await ctx.replyWithChatAction('typing')

    try {
      const response = await handleMessage('telegram', chatId, text)
      keepTyping = false
      clearInterval(typingInterval)

      const reply = response.text || '(no response)'

      const hasUnfinishedWork = reply.includes('Let me') ||
                                reply.includes('I will') ||
                                reply.includes('I should') ||
                                (reply.includes('PR') && !reply.includes('http://'))

      if (hasUnfinishedWork) {
        await ctx.reply('⚠️ Looks like I got stuck mid-task. Let me complete it now...')
        const continuation = await handleMessage('telegram', chatId, 'Continue and complete the task: create PR and send notification.')
        const finalReply = continuation.text || '(completed)'
        await ctx.reply(finalReply, { parse_mode: 'Markdown' }).catch(() => ctx.reply(finalReply))
      } else {
        if (reply.length <= 4096) {
          await ctx.reply(reply, { parse_mode: 'Markdown' }).catch(() => ctx.reply(reply))
        } else {
          for (let i = 0; i < reply.length; i += 4096) {
            await ctx.reply(reply.slice(i, i + 4096))
          }
        }
      }
    } catch (err) {
      keepTyping = false
      clearInterval(typingInterval)
      await ctx.reply(`Error: ${(err as Error).message}`)
    }
  })

  bot.catch((err) => {
    console.error('Telegram bot error:', (err as Error).message)
  })

  bot.start({
    onStart: () => console.log('Telegram bot polling started'),
  }).catch((err) => {
    console.error('Telegram bot polling crashed:', err.message)
  })

  return bot
}

export const stopTelegram = (): void => { bot?.stop() }
