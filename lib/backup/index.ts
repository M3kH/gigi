/**
 * Backup Module — Barrel Export
 *
 * Configurable backup system for mirroring Gitea repos.
 * v1: git-mirror with org-wide source selection.
 */

export { loadBackupConfig, interpolateEnvVars, parseSimpleYaml } from './config'
export type { BackupConfig, BackupSource, BackupTarget, MirrorTarget } from './config'

export { resolveRepos } from './sources'
export type { RepoInfo } from './sources'

export { mirrorRepo, mirrorAll } from './mirror'
export type { MirrorResult, MirrorRunResult } from './mirror'

export {
  startScheduler,
  stopScheduler,
  runBackup,
  runPreDeployBackup,
  getBackupStatus,
  parseInterval,
} from './scheduler'

// ─── Bootstrap ──────────────────────────────────────────────────────

import { loadBackupConfig } from './config'
import { startScheduler } from './scheduler'

/**
 * Initialize the backup system.
 * Call this from the main entry point after other services are ready.
 */
export const initBackup = async (): Promise<void> => {
  try {
    const config = await loadBackupConfig()
    if (!config) {
      console.log('[backup] no config found, backup system disabled')
      return
    }

    startScheduler(config)
    console.log('[backup] backup system initialized')
  } catch (err) {
    console.error('[backup] failed to initialize:', err)
  }
}
