/**
 * Core Health Check
 *
 * Reports service status: uptime, memory, component readiness, and phase.
 */

import { getConfig } from './store'
import { execSync } from 'node:child_process'

export interface HealthStatus {
  ok: boolean
  uptime: number
  memory: {
    rss: string
    heapUsed: string
    heapTotal: string
  }
  checks: Record<string, string>
  phase: 'setup' | 'partial' | 'ready'
}

const startTime = Date.now()

export const healthCheck = async (): Promise<HealthStatus> => {
  const status: HealthStatus = {
    ok: true,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory: {
      rss: '0MB',
      heapUsed: '0MB',
      heapTotal: '0MB',
    },
    checks: {},
    phase: 'ready',
  }

  // Memory usage
  const mem = process.memoryUsage()
  status.memory = {
    rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
  }

  // Git credentials
  try {
    execSync('git config user.name && git config user.email', { encoding: 'utf-8', stdio: 'pipe' })
    status.checks.git_credentials = 'configured'
  } catch {
    status.checks.git_credentials = 'not_configured'
  }

  // Database
  try {
    await getConfig('_health')
    status.checks.database = 'ok'
  } catch {
    status.checks.database = 'failed'
    status.ok = false
  }

  // Claude OAuth
  const oauthToken = await getConfig('claude_oauth_token').catch(() => null)
  status.checks.claude = oauthToken ? 'configured' : 'not_configured'

  // Telegram
  const tgToken = await getConfig('telegram_token').catch(() => null)
  status.checks.telegram = tgToken ? 'configured' : 'not_configured'

  // Gitea
  const giteaToken = await getConfig('gitea_token').catch(() => null)
  status.checks.gitea = giteaToken ? 'configured' : 'not_configured'

  // Phase
  if (!oauthToken) status.phase = 'setup'
  else if (!tgToken || !giteaToken) status.phase = 'partial'
  else status.phase = 'ready'

  return status
}
