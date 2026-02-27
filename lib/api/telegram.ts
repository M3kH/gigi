/**
 * API — Telegram Bot Integration
 *
 * Grammy-based Telegram bot with thread-aware commands, message handling,
 * chat locking, and auto-retry for incomplete work.
 *
 * Thread Commands:
 *   /switch <repo#N|"name"> — Bind to a thread by ref or fuzzy name match
 *   /threads               — List latest 10 active threads
 *   /thread                — Show which thread you're currently in
 *   /fork                  — Fork current thread into a sub-thread
 *   /compact               — Compact/summarize current thread
 *
 * Legacy Commands:
 *   /start, /new, /resume, /clear, /status
 */

import { Bot, type Context } from 'grammy'
import { getConfig, setConfig } from '../core/store'
import * as store from '../core/store'
import {
  handleMessage,
  newConversation,
  resumeConversation,
  clearConversation,
  switchToThread,
  getCurrentThread,
} from '../core/router'
import * as threads from '../core/threads'
import { compactThread, shouldCompact } from '../core/thread-compact'
import { setBotInstance } from '../tools/telegram'
import { setNotifierBot } from './webhookNotifier'

let bot: Bot | null = null

/** Status emoji for thread display */
const statusEmoji = (status: string): string => {
  switch (status) {
    case 'active': return '🟢'
    case 'paused': return '⏸'
    case 'stopped': return '✅'
    case 'archived': return '📦'
    default: return '⚪'
  }
}

/** Format a thread for display as a single line */
const formatThread = (t: threads.ThreadWithRefs): string => {
  const emoji = statusEmoji(t.status)
  const topic = t.topic || '(untitled)'
  const refs = t.refs
    .filter(r => r.number)
    .map(r => `${r.ref_type === 'pr' ? 'PR' : r.ref_type === 'issue' ? '#' : ''}${r.number}`)
    .join(', ')
  const refsStr = refs ? ` [${refs}]` : ''
  const depth = t.parent_thread_id ? ' ↳' : ''
  return `${depth}${emoji} ${topic}${refsStr}`
}

/** Safe Telegram reply — falls back to plain text on Markdown parse failure */
const safeReply = async (ctx: Context, text: string): Promise<void> => {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' })
  } catch {
    await ctx.reply(text)
  }
}

/** Send long messages with chunking (Telegram 4096 char limit) */
const sendLong = async (ctx: Context, text: string): Promise<void> => {
  if (text.length <= 4096) {
    await safeReply(ctx, text)
  } else {
    for (let i = 0; i < text.length; i += 4096) {
      await ctx.reply(text.slice(i, i + 4096))
    }
  }
}

export const startTelegram = async (): Promise<Bot | null> => {
  const token = await getConfig('telegram_token')
  if (!token) return null

  console.log('Telegram bot starting...')

  bot = new Bot(token)
  setBotInstance(bot)
  setNotifierBot(bot)

  // Verify token works before setting up handlers
  try {
    const me = await bot.api.getMe()
    console.log(`Telegram bot authenticated as @${me.username}`)
  } catch (err) {
    console.error('Telegram bot auth failed:', (err as Error).message)
    throw err
  }

  // Lock to the operator's chat ID
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

  // ── Legacy Commands ─────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    await ctx.reply('Hey! Gigi here. What can I do for you?')
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

  // ── Thread Commands ─────────────────────────────────────────────────

  /**
   * /threads — List latest active threads with status + refs
   */
  bot.command('threads', async (ctx) => {
    try {
      const allThreads = await threads.listThreads({ archived: false, limit: 10 })
      if (allThreads.length === 0) {
        await ctx.reply('No active threads.')
        return
      }

      // Enrich with refs
      const enriched: threads.ThreadWithRefs[] = []
      for (const t of allThreads) {
        const full = await threads.getThread(t.id)
        if (full) enriched.push(full)
      }

      const lines = enriched.map((t, i) => `${i + 1}. ${formatThread(t)}`)
      const current = await getCurrentThread('telegram', String(ctx.chat.id))
      const currentLine = current ? `\n\n📍 Current: ${current.topic || current.id.slice(0, 8)}` : ''

      await safeReply(ctx, `🧵 *Active Threads*\n\n${lines.join('\n')}${currentLine}`)
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`)
    }
  })

  /**
   * /thread — Show which thread you're currently bound to
   */
  bot.command('thread', async (ctx) => {
    try {
      const current = await getCurrentThread('telegram', String(ctx.chat.id))
      if (!current) {
        await ctx.reply('No active thread. Messages go to a new conversation.')
        return
      }

      const topic = current.topic || '(untitled)'
      const status = `${statusEmoji(current.status)} ${current.status}`
      const refs = current.refs
        .filter(r => r.number)
        .map(r => `${r.ref_type}${r.repo ? ' ' + r.repo : ''}#${r.number}`)
        .join(', ')
      const refsLine = refs ? `\n🔗 Refs: ${refs}` : ''

      // Show parent/children
      let lineageInfo = ''
      try {
        const lineage = await threads.getThreadLineage(current.id)
        if (lineage.parent) {
          lineageInfo += `\n↩ Parent: ${lineage.parent.topic || lineage.parent.id.slice(0, 8)}`
        }
        if (lineage.children.length > 0) {
          lineageInfo += `\n🔀 Children: ${lineage.children.length}`
        }
      } catch { /* lineage unavailable */ }

      await safeReply(ctx, `📍 *Current Thread*\n\n${topic}\nStatus: ${status}${refsLine}${lineageInfo}`)
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`)
    }
  })

  /**
   * /switch <repo#N|"name"> — Bind Telegram to a specific thread
   *
   * Examples:
   *   /switch gigi#234     → Find thread linked to issue gigi#234
   *   /switch JWT auth     → Fuzzy match thread by topic
   */
  bot.command('switch', async (ctx) => {
    const chatId = String(ctx.chat.id)
    const arg = ctx.match?.trim()

    if (!arg) {
      await ctx.reply('Usage: /switch gigi#234 or /switch "thread topic"')
      return
    }

    try {
      // Try parsing as repo#number reference
      const refMatch = arg.match(/^([a-z0-9._-]+)#(\d+)$/i)
      if (refMatch) {
        const [, repo, num] = refMatch
        const issueNum = parseInt(num, 10)

        // Try issue ref first, then PR
        let thread = await threads.findThreadByRef(repo, 'issue', issueNum)
        if (!thread) {
          thread = await threads.findThreadByRef(repo, 'pr', issueNum)
        }

        if (!thread) {
          await ctx.reply(`No thread found for ${repo}#${num}. Try /threads to see available threads.`)
          return
        }

        const { thread: switched } = await switchToThread('telegram', chatId, thread.id)
        await safeReply(ctx, `🔀 Switched to: *${switched.topic || switched.id.slice(0, 8)}*`)
        return
      }

      // Fuzzy match by topic
      const allThreads = await threads.listThreads({ archived: false, limit: 50 })
      const query = arg.toLowerCase()
      const match = allThreads.find(t =>
        t.topic?.toLowerCase().includes(query)
      )

      if (!match) {
        await ctx.reply(`No thread matching "${arg}". Try /threads to see available threads.`)
        return
      }

      const { thread: switched } = await switchToThread('telegram', chatId, match.id)
      await safeReply(ctx, `🔀 Switched to: *${switched.topic || switched.id.slice(0, 8)}*`)
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`)
    }
  })

  /**
   * /fork [topic] — Fork current thread into a sub-thread
   */
  bot.command('fork', async (ctx) => {
    const chatId = String(ctx.chat.id)
    const topic = ctx.match?.trim() || undefined

    try {
      const current = await getCurrentThread('telegram', chatId)
      if (!current) {
        await ctx.reply('No active thread to fork. Send a message first or /switch to a thread.')
        return
      }

      const forked = await threads.forkThread(current.id, { topic, compact: true })
      await switchToThread('telegram', chatId, forked.id)

      const parentName = current.topic || current.id.slice(0, 8)
      const forkName = forked.topic || forked.id.slice(0, 8)
      await safeReply(ctx, `🔀 Forked from "${parentName}" → *${forkName}*\n\nNow talking in the sub-thread.`)
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`)
    }
  })

  /**
   * /compact — Compact/summarize the current thread
   */
  bot.command('compact', async (ctx) => {
    try {
      const current = await getCurrentThread('telegram', String(ctx.chat.id))
      if (!current) {
        await ctx.reply('No active thread to compact.')
        return
      }

      const check = await shouldCompact(current.id, 10)
      if (!check.shouldCompact) {
        await ctx.reply(`Thread is small enough (${check.eventCount} events). No compaction needed.`)
        return
      }

      await ctx.reply(`Compacting thread (${check.eventCount} events)...`)
      const result = await compactThread(current.id, { keep_recent: 5 })
      await safeReply(ctx, `✅ Compacted ${result.compacted_count} events into a summary.`)
    } catch (err) {
      await ctx.reply(`Error: ${(err as Error).message}`)
    }
  })

  // ── Message Handling ────────────────────────────────────────────────

  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat.id)
    const text = ctx.message.text

    const oauthToken = await getConfig('claude_oauth_token')
    if (!oauthToken) {
      await ctx.reply('Claude is not configured yet. Open the web UI to complete setup.')
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
        await sendLong(ctx, finalReply)
      } else {
        await sendLong(ctx, reply)
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
