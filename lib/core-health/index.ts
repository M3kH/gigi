/**
 * Core Health — health check types.
 */

export interface HealthStatus {
  ok: boolean
  uptime: number
  memory: {
    rss: string
    heapUsed: string
    heapTotal: string
  }
  checks: {
    database: 'ok' | 'failed'
    git_credentials: 'configured' | 'not_configured'
    claude: 'configured' | 'not_configured'
    telegram: 'configured' | 'not_configured'
    gitea: 'configured' | 'not_configured'
  }
  phase: 'setup' | 'partial' | 'ready'
}
