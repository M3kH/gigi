import { serve } from '@hono/node-server'
import { connect, disconnect } from './store.js'
import { createApp } from './web.js'
import { startTelegram, stopTelegram } from './telegram.js'

const PORT = process.env.PORT || 3000
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const main = async () => {
  // Connect to database and run migrations
  console.log('Connecting to database...')
  await connect(DATABASE_URL)
  console.log('Database ready')

  // Start HTTP server
  const app = createApp()
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Gigi listening on :${PORT}`)
    console.log(`Open http://localhost:${PORT} for the web UI`)
  })

  // Start Telegram bot (if configured)
  try {
    await startTelegram()
  } catch (err) {
    console.log('Telegram not started:', err.message)
  }

  console.log('Gigi is alive!')
}

// Graceful shutdown
const shutdown = async () => {
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
