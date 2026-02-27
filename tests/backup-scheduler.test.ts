/**
 * Tests for lib/backup/scheduler.ts — backup scheduler lifecycle
 *
 * Tests runBackup, startScheduler, stopScheduler, getBackupStatus,
 * and runPreDeployBackup with mocked dependencies.
 */

import assert from 'node:assert/strict'
import { vi } from 'vitest'

// Mock dependencies
vi.mock('../lib/backup/sources', () => ({
  resolveRepos: vi.fn(async () => [
    { owner: 'idea', name: 'gigi', cloneUrl: 'http://localhost:3300/idea/gigi.git', description: '', fullName: 'idea/gigi' },
  ]),
}))

vi.mock('../lib/backup/mirror', () => ({
  mirrorAll: vi.fn(async () => ({
    target: 'test-mirror',
    total: 1,
    success: 1,
    failed: 0,
    errors: [],
    duration: 100,
  })),
}))

vi.mock('../lib/core/store', () => ({
  getConfig: vi.fn(async () => null),
}))

describe('backup scheduler', () => {
  let parseInterval: (interval: string) => number
  let runBackup: (config?: unknown) => Promise<unknown[]>
  let startScheduler: (config: unknown) => void
  let stopScheduler: () => void
  let getBackupStatus: () => { running: boolean; lastRun: unknown; schedulerActive: boolean; config: unknown }
  let runPreDeployBackup: () => Promise<unknown[]>
  let resolveRepos: ReturnType<typeof vi.fn>
  let mirrorAll: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()

    // Re-mock after resetModules
    vi.mock('../lib/backup/sources', () => ({
      resolveRepos: vi.fn(async () => [
        { owner: 'idea', name: 'gigi', cloneUrl: 'http://localhost:3300/idea/gigi.git', description: '', fullName: 'idea/gigi' },
      ]),
    }))

    vi.mock('../lib/backup/mirror', () => ({
      mirrorAll: vi.fn(async () => ({
        target: 'test-mirror',
        total: 1,
        success: 1,
        failed: 0,
        errors: [],
        duration: 100,
      })),
    }))

    vi.mock('../lib/core/store', () => ({
      getConfig: vi.fn(async () => null),
    }))

    const scheduler = await import('../lib/backup/scheduler')
    parseInterval = scheduler.parseInterval
    runBackup = scheduler.runBackup as unknown as typeof runBackup
    startScheduler = scheduler.startScheduler as unknown as typeof startScheduler
    stopScheduler = scheduler.stopScheduler
    getBackupStatus = scheduler.getBackupStatus as unknown as typeof getBackupStatus
    runPreDeployBackup = scheduler.runPreDeployBackup as unknown as typeof runPreDeployBackup

    const sources = await import('../lib/backup/sources')
    const mirror = await import('../lib/backup/mirror')
    resolveRepos = sources.resolveRepos as ReturnType<typeof vi.fn>
    mirrorAll = mirror.mirrorAll as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  describe('parseInterval', () => {
    it('parses seconds', () => {
      assert.equal(parseInterval('30s'), 30_000)
    })

    it('parses minutes', () => {
      assert.equal(parseInterval('5m'), 300_000)
    })

    it('parses hours', () => {
      assert.equal(parseInterval('6h'), 21_600_000)
    })

    it('parses days', () => {
      assert.equal(parseInterval('1d'), 86_400_000)
    })

    it('defaults to 6h for invalid input', () => {
      assert.equal(parseInterval('invalid'), 21_600_000)
    })

    it('defaults to 6h for empty string', () => {
      assert.equal(parseInterval(''), 21_600_000)
    })
  })

  describe('getBackupStatus', () => {
    it('returns initial status', () => {
      const status = getBackupStatus()
      assert.equal(status.running, false)
      assert.equal(status.lastRun, null)
      assert.equal(status.schedulerActive, false)
      assert.equal(status.config, null)
    })
  })

  describe('runBackup', () => {
    it('returns empty when no config loaded', async () => {
      const results = await runBackup()
      assert.deepEqual(results, [])
    })

    it('runs backup with explicit config', async () => {
      process.env.GITEA_TOKEN = 'test-token'
      const config = {
        sources: [{ org: 'idea' }],
        targets: [{ type: 'git-mirror', name: 'test', url: 'https://backup.example.com', auth: 'token', token: 'xxx' }],
        schedule: { interval: '6h', before_deploy: false },
      }

      const results = await runBackup(config)
      assert.equal(results.length, 1)
      assert.ok(resolveRepos.mock.calls.length > 0)
      assert.ok(mirrorAll.mock.calls.length > 0)
      delete process.env.GITEA_TOKEN
    })

    it('skips when no gitea token available', async () => {
      delete process.env.GITEA_TOKEN
      const config = {
        sources: [{ org: 'idea' }],
        targets: [{ type: 'git-mirror', name: 'test', url: 'https://backup.example.com', auth: 'token', token: 'xxx' }],
        schedule: { interval: '6h', before_deploy: false },
      }

      const results = await runBackup(config)
      assert.deepEqual(results, [])
    })

    it('skips unsupported target types', async () => {
      process.env.GITEA_TOKEN = 'test-token'
      const config = {
        sources: [{ org: 'idea' }],
        targets: [{ type: 'unsupported-type', name: 'test', url: 'https://x.com', auth: 'none' }],
        schedule: { interval: '6h', before_deploy: false },
      }

      const results = await runBackup(config)
      assert.deepEqual(results, [])
      delete process.env.GITEA_TOKEN
    })

    it('returns empty when no repos found', async () => {
      process.env.GITEA_TOKEN = 'test-token'
      resolveRepos.mockResolvedValueOnce([])
      const config = {
        sources: [{ org: 'idea' }],
        targets: [{ type: 'git-mirror', name: 'test', url: 'https://x.com', auth: 'token', token: 'xxx' }],
        schedule: { interval: '6h', before_deploy: false },
      }

      const results = await runBackup(config)
      assert.deepEqual(results, [])
      delete process.env.GITEA_TOKEN
    })
  })

  describe('startScheduler / stopScheduler', () => {
    it('starts and stops the scheduler', () => {
      const config = {
        sources: [{ org: 'idea' }],
        targets: [{ type: 'git-mirror', name: 'test', url: 'https://x.com', auth: 'token', token: 'xxx' }],
        schedule: { interval: '1h', before_deploy: false },
      }

      startScheduler(config)

      const status = getBackupStatus()
      assert.equal(status.schedulerActive, true)
      assert.deepEqual(status.config, config)

      stopScheduler()

      const statusAfterStop = getBackupStatus()
      assert.equal(statusAfterStop.schedulerActive, false)
    })

    it('stopScheduler is safe to call when not running', () => {
      // Should not throw
      stopScheduler()
      stopScheduler()
    })
  })

  describe('runPreDeployBackup', () => {
    it('returns empty when no config loaded', async () => {
      const results = await runPreDeployBackup()
      assert.deepEqual(results, [])
    })

    it('returns empty when before_deploy is disabled', async () => {
      const config = {
        sources: [{ org: 'idea' }],
        targets: [{ type: 'git-mirror', name: 'test', url: 'https://x.com', auth: 'token', token: 'xxx' }],
        schedule: { interval: '1h', before_deploy: false },
      }

      startScheduler(config)
      const results = await runPreDeployBackup()
      assert.deepEqual(results, [])
    })
  })
})
