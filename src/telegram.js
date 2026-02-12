import { Bot } from 'grammy'
import { getConfig, setConfig } from './store.js'
import { handleMessage, newConversation } from './router.js'
import { setBotInstance } from './tools/telegram.js'

let bot = null

export const startTelegram = async () => {
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
    console.error('Telegram bot auth failed:', err.message)
    throw err
  }

  // Lock to Mauro's chat ID
  bot.use(async (ctx, next) => {
    const chatId = String(ctx.chat?.id)
    const stored = await getConfig('telegram_chat_id')

    if (!stored) {
      // First interaction — capture chat ID
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

  bot.command('status', async (ctx) => {
    const { healthCheck } = await import('./health.js')
    const status = await healthCheck()
    const lines = Object.entries(status.checks)
      .map(([k, v]) => `${v === 'ok' || v === 'configured' ? '✅' : '❌'} ${k}: ${v}`)
    await ctx.reply(`Phase: ${status.phase}\n${lines.join('\n')}`)
  })

  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat.id)
    const text = ctx.message.text

    // Check if Claude is configured
    const oauthToken = await getConfig('claude_oauth_token')
    if (!oauthToken) {
      await ctx.reply('Claude is not configured yet. Open claude.cluster.local to complete setup.')
      return
    }

    // Keep sending typing indicator every 5 seconds while processing
    let keepTyping = true
    const typingInterval = setInterval(() => {
      if (keepTyping) ctx.replyWithChatAction('typing').catch(() => {})
    }, 5000)
    await ctx.replyWithChatAction('typing')

    try {
      const response = await handleMessage('telegram', chatId, text)
      keepTyping = false
      clearInterval(typingInterval)

      // Telegram has a 4096 char limit
      const reply = response.text || '(no response)'
      if (reply.length <= 4096) {
        await ctx.reply(reply, { parse_mode: 'Markdown' }).catch(() =>
          ctx.reply(reply) // fallback without markdown
        )
      } else {
        // Split into chunks
        for (let i = 0; i < reply.length; i += 4096) {
          await ctx.reply(reply.slice(i, i + 4096))
        }
      }
    } catch (err) {
      keepTyping = false
      clearInterval(typingInterval)
      await ctx.reply(`Error: ${err.message}`)
    }
  })

  bot.catch((err) => {
    console.error('Telegram bot error:', err.message)
  })

  // Start polling — don't await (it blocks forever), but catch errors
  bot.start({
    onStart: () => console.log('Telegram bot polling started'),
  }).catch((err) => {
    console.error('Telegram bot polling crashed:', err.message)
  })

  return bot
}

export const stopTelegram = () => bot?.stop()
