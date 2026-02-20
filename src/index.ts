/**
 * Entry point — boots database, enforcer, HTTP server, and Telegram bot.
 */

import { serve } from '@hono/node-server'
import { connect, disconnect, cleanupOldActions, autoArchiveStale } from '../lib/core/store'
import { initEnforcer } from '../lib/core/enforcer'
import { createApp } from '../lib/api/web'
import { createWSServer } from './server'
import { startTelegram, stopTelegram } from '../lib/api/telegram'
import { initBackup, stopScheduler } from '../lib/backup'
import { startAwmScheduler, stopAwmScheduler } from '../lib/core/awm-scheduler'
import { getConfig } from '../lib/core/store'

const PORT = parseInt(process.env.PORT || '3000', 10)
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const main = async (): Promise<void> => {
  // Connect to database and run migrations
  console.log('Connecting to database...')
  const pool = await connect(DATABASE_URL)
  console.log('Database ready')

  // Initialize task enforcer
  await initEnforcer(pool)
  console.log('Task enforcer ready')

  // Start HTTP server
  const app = createApp()
  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Gigi listening on :${PORT}`)
    console.log(`Open http://localhost:${PORT} for the web UI`)
  })

  // Attach WebSocket server to the same HTTP server
  createWSServer(server)

  // Start Telegram bot (if configured)
  try {
    await startTelegram()
  } catch (err) {
    console.log('Telegram not started:', (err as Error).message)
  }

  // Initialize backup system (if configured via gigi.config.yaml)
  await initBackup()

  // Initialize Always Working Mode (if previously enabled)
  try {
    const awmEnabled = await getConfig('awm_enabled')
    const awmInterval = await getConfig('awm_interval_minutes')
    if (awmEnabled === 'true') {
      startAwmScheduler(parseInt(awmInterval || '15', 10))
    }
  } catch (err) {
    console.log('AWM not started:', (err as Error).message)
  }

  // Cleanup old action logs every 30 minutes
  setInterval(async () => {
    const count = await cleanupOldActions(1)
    if (count > 0) console.log(`Cleaned up ${count} old action logs`)
  }, 30 * 60 * 1000)

  // Auto-archive stale conversations (runs every 6 hours)
  const runAutoArchive = async () => {
    try {
      const enabled = await getConfig('auto_archive_enabled')
      if (enabled !== 'true') return
      const days = parseInt(await getConfig('auto_archive_days') || '7')
      const count = await autoArchiveStale(days)
      if (count > 0) console.log(`Auto-archived ${count} stale conversations (>${days} days)`)
    } catch (err) {
      console.error('Auto-archive failed:', (err as Error).message)
    }
  }
  // Run once on startup, then every 6 hours
  runAutoArchive()
  setInterval(runAutoArchive, 6 * 60 * 60 * 1000)

  console.log('Gigi is alive!')
}

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  console.log('Shutting down...')
  stopAwmScheduler()
  stopScheduler()
  stopTelegram()
  await disconnect()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
