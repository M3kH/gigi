/**
 * Backup Scheduler — Periodic + manual backup triggers
 *
 * Parses interval strings (e.g. "6h", "30m", "1d") and runs
 * the backup loop on a timer. Also exposes a manual trigger.
 */

import type { BackupConfig } from './config'
import { resolveRepos } from './sources'
import { mirrorAll, type MirrorRunResult } from './mirror'
import { getConfig } from '../core/store'

// ─── State ──────────────────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null
let isRunning = false
let lastRun: MirrorRunResult | null = null
let currentConfig: BackupConfig | null = null

// ─── Interval Parsing ───────────────────────────────────────────────

/**
 * Parse human-friendly interval strings to milliseconds.
 * Supports: "30s", "5m", "6h", "1d"
 */
export const parseInterval = (interval: string): number => {
  const match = interval.match(/^(\d+)(s|m|h|d)$/)
  if (!match) {
    console.warn(`[backup:scheduler] invalid interval "${interval}", defaulting to 6h`)
    return 6 * 60 * 60 * 1000
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: return 6 * 60 * 60 * 1000
  }
}

// ─── Backup Execution ───────────────────────────────────────────────

/**
 * Run a full backup cycle: resolve sources → mirror to all targets.
 */
export const runBackup = async (config?: BackupConfig): Promise<MirrorRunResult[]> => {
  const cfg = config || currentConfig
  if (!cfg) {
    console.warn('[backup:scheduler] no config loaded, skipping backup')
    return []
  }

  if (isRunning) {
    console.warn('[backup:scheduler] backup already in progress, skipping')
    return []
  }

  isRunning = true
  const results: MirrorRunResult[] = []

  try {
    const giteaUrl = process.env.GITEA_URL || await getConfig('gitea_url') || 'http://localhost:3300'
    const giteaToken = process.env.GITEA_TOKEN || await getConfig('gitea_token') || ''

    if (!giteaToken) {
      console.error('[backup:scheduler] no gitea token available, cannot resolve repos')
      return []
    }

    // Resolve which repos to back up
    console.log('[backup:scheduler] resolving repos from sources...')
    const repos = await resolveRepos(cfg.sources, giteaUrl, giteaToken)
    console.log(`[backup:scheduler] found ${repos.length} repos to mirror`)

    if (repos.length === 0) {
      console.warn('[backup:scheduler] no repos found, nothing to mirror')
      return []
    }

    // Rewrite clone URLs to use the internal Gitea address (the API returns
    // external ROOT_URL which may not be resolvable inside the container)
    for (const repo of repos) {
      if (repo.cloneUrl) {
        try {
          const cloneUrl = new URL(repo.cloneUrl)
          const internalUrl = new URL(giteaUrl)
          cloneUrl.protocol = internalUrl.protocol
          cloneUrl.host = internalUrl.host
          repo.cloneUrl = cloneUrl.toString()
        } catch {
          // Leave clone URL as-is if parsing fails
        }
      }
    }

    // Mirror to each target
    for (const target of cfg.targets) {
      if (target.type === 'git-mirror') {
        const result = await mirrorAll(repos, target, giteaToken)
        results.push(result)
        lastRun = result
      } else {
        console.warn(`[backup:scheduler] unsupported target type: ${(target as { type: string }).type}`)
      }
    }

    return results
  } catch (err) {
    console.error('[backup:scheduler] backup failed:', err)
    return results
  } finally {
    isRunning = false
  }
}

// ─── Scheduler Lifecycle ────────────────────────────────────────────

/**
 * Start the backup scheduler with the given config.
 */
export const startScheduler = (config: BackupConfig): void => {
  currentConfig = config
  const intervalMs = parseInterval(config.schedule.interval)

  console.log(`[backup:scheduler] starting with interval ${config.schedule.interval} (${intervalMs}ms)`)
  console.log(`[backup:scheduler] sources: ${config.sources.length}, targets: ${config.targets.length}`)

  // Run first backup after a delay (give internal Gitea time to start in AIO mode)
  setTimeout(() => {
    runBackup().catch(err => {
      console.error('[backup:scheduler] initial backup failed:', err)
    })
  }, 60_000) // 60 second delay after startup

  // Schedule periodic backups
  schedulerTimer = setInterval(() => {
    runBackup().catch(err => {
      console.error('[backup:scheduler] scheduled backup failed:', err)
    })
  }, intervalMs)

  console.log('[backup:scheduler] scheduler started')
}

/**
 * Stop the backup scheduler.
 */
export const stopScheduler = (): void => {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
    console.log('[backup:scheduler] scheduler stopped')
  }
}

/**
 * Get the status of the backup system.
 */
export const getBackupStatus = (): {
  running: boolean
  lastRun: MirrorRunResult | null
  schedulerActive: boolean
  config: BackupConfig | null
} => ({
  running: isRunning,
  lastRun,
  schedulerActive: schedulerTimer !== null,
  config: currentConfig,
})

/**
 * Run a pre-deploy backup. Called before Gigi redeploys.
 */
export const runPreDeployBackup = async (): Promise<MirrorRunResult[]> => {
  if (!currentConfig?.schedule.before_deploy) {
    console.log('[backup:scheduler] pre-deploy backup disabled in config')
    return []
  }

  console.log('[backup:scheduler] running pre-deploy backup...')
  return runBackup()
}
