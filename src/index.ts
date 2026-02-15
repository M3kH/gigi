/**
 * Entry point — boots database, enforcer, HTTP server, and Telegram bot.
 */

import { serve } from '@hono/node-server'
import { connect, disconnect, cleanupOldActions } from '../lib/core/store'
import { initEnforcer } from '../lib/core/enforcer'
import { createApp } from '../lib/api/web'
import { createWSServer } from './server'
import { startTelegram, stopTelegram } from '../lib/api/telegram'

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

  // Cleanup old action logs every 30 minutes
  setInterval(async () => {
    const count = await cleanupOldActions(1)
    if (count > 0) console.log(`Cleaned up ${count} old action logs`)
  }, 30 * 60 * 1000)

  console.log('Gigi is alive!')
}

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  console.log('Shutting down...')
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
