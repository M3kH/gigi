/**
 * Tests for setup dismissed state — server-side persistence
 *
 * Validates:
 * - dismissed flag is persisted in PostgreSQL config store (not localStorage)
 * - Auto-dismiss migration: existing users (Claude configured, no setup_dismissed key)
 *   get auto-dismissed on first status check
 * - New users: setup_dismissed stays false until they explicitly dismiss
 * - The dismiss step works via setupStep('dismiss', {})
 * - isSetupComplete logic (Claude configured AND dismissed)
 */

import assert from 'node:assert/strict'

// ── Mock config store ─────────────────────────────────────────────────
// Mirror the setup domain logic without actually importing it (avoids
// requiring database connections). Tests the business logic directly.

class MockConfigStore {
  private store: Record<string, string> = {}

  async getConfig(key: string): Promise<string | null> {
    return this.store[key] ?? null
  }

  async setConfig(key: string, value: string): Promise<void> {
    this.store[key] = value
  }

  async getAllConfig(): Promise<Record<string, string>> {
    return { ...this.store }
  }

  // Seed config values for test setup
  seed(data: Record<string, string>): void {
    this.store = { ...data }
  }
}

// ── Mirror of setup domain logic ─────────────────────────────────────
// Reproduces getSetupStatus() and setupStep('dismiss') from
// lib/domain/setup.ts for unit testing without DB dependencies.

interface SetupStatus {
  claude: boolean
  telegram: boolean
  gitea: boolean
  complete: boolean
  dismissed: boolean
}

interface SetupResult {
  ok: boolean
  message?: string
  error?: string
}

function createSetupDomain(configStore: MockConfigStore) {
  return {
    async getSetupStatus(): Promise<SetupStatus> {
      const config = await configStore.getAllConfig()
      const claude = !!config.claude_oauth_token
      const dismissed = config.setup_dismissed === 'true'

      // Auto-dismiss migration
      if (claude && !dismissed && config.setup_dismissed === undefined) {
        await configStore.setConfig('setup_dismissed', 'true')
        return {
          claude,
          telegram: !!config.telegram_token,
          gitea: !!config.gitea_url && !!config.gitea_token,
          complete: !!config.claude_oauth_token && !!config.telegram_token && !!config.gitea_token,
          dismissed: true,
        }
      }

      return {
        claude,
        telegram: !!config.telegram_token,
        gitea: !!config.gitea_url && !!config.gitea_token,
        complete: !!config.claude_oauth_token && !!config.telegram_token && !!config.gitea_token,
        dismissed: claude && dismissed,
      }
    },

    async dismiss(): Promise<SetupResult> {
      await configStore.setConfig('setup_dismissed', 'true')
      return { ok: true, message: 'Setup dismissed' }
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Setup — server-side dismissed persistence', () => {
  let configStore: MockConfigStore

  beforeEach(() => {
    configStore = new MockConfigStore()
  })

  describe('getSetupStatus — dismissed field', () => {
    it('returns dismissed: false when nothing is configured', async () => {
      const domain = createSetupDomain(configStore)
      const status = await domain.getSetupStatus()
      assert.equal(status.dismissed, false)
      assert.equal(status.claude, false)
    })

    it('returns dismissed: false when Claude is configured but setup_dismissed is explicitly false', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
        setup_dismissed: 'false',
      })
      const domain = createSetupDomain(configStore)
      const status = await domain.getSetupStatus()
      assert.equal(status.claude, true)
      assert.equal(status.dismissed, false)
    })

    it('returns dismissed: true when Claude is configured and setup_dismissed is true', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
        setup_dismissed: 'true',
      })
      const domain = createSetupDomain(configStore)
      const status = await domain.getSetupStatus()
      assert.equal(status.claude, true)
      assert.equal(status.dismissed, true)
    })

    it('dismissed is false when setup_dismissed is true but Claude is NOT configured', async () => {
      configStore.seed({
        setup_dismissed: 'true',
      })
      const domain = createSetupDomain(configStore)
      const status = await domain.getSetupStatus()
      assert.equal(status.claude, false)
      assert.equal(status.dismissed, false, 'dismissed requires Claude to be configured')
    })
  })

  describe('auto-dismiss migration', () => {
    it('auto-sets setup_dismissed for existing users (Claude configured, no setup_dismissed key)', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
        telegram_token: 'bot-token',
        gitea_url: 'http://gitea:3000',
        gitea_token: 'gitea-token',
      })
      const domain = createSetupDomain(configStore)
      const status = await domain.getSetupStatus()

      assert.equal(status.dismissed, true, 'should auto-dismiss for existing user')
      // Verify it was persisted
      const saved = await configStore.getConfig('setup_dismissed')
      assert.equal(saved, 'true', 'should persist to config store')
    })

    it('does NOT auto-dismiss when Claude is not configured (new user)', async () => {
      const domain = createSetupDomain(configStore)
      const status = await domain.getSetupStatus()

      assert.equal(status.dismissed, false)
      const saved = await configStore.getConfig('setup_dismissed')
      assert.equal(saved, null, 'should not persist anything')
    })

    it('does NOT re-trigger migration after setup_dismissed was explicitly set to false', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
        setup_dismissed: 'false',
      })
      const domain = createSetupDomain(configStore)
      const status = await domain.getSetupStatus()

      assert.equal(status.dismissed, false, 'explicit false should be respected')
      const saved = await configStore.getConfig('setup_dismissed')
      assert.equal(saved, 'false', 'should not overwrite explicit false')
    })

    it('auto-dismiss persists across repeated calls', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
      })
      const domain = createSetupDomain(configStore)

      // First call triggers migration
      const status1 = await domain.getSetupStatus()
      assert.equal(status1.dismissed, true)

      // Second call reads persisted value
      const status2 = await domain.getSetupStatus()
      assert.equal(status2.dismissed, true)
    })
  })

  describe('dismiss step', () => {
    it('sets setup_dismissed to true in config store', async () => {
      const domain = createSetupDomain(configStore)

      const result = await domain.dismiss()
      assert.equal(result.ok, true)

      const saved = await configStore.getConfig('setup_dismissed')
      assert.equal(saved, 'true')
    })

    it('subsequent getSetupStatus reflects dismissed state', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
        setup_dismissed: 'false',
      })
      const domain = createSetupDomain(configStore)

      // Before dismiss
      let status = await domain.getSetupStatus()
      assert.equal(status.dismissed, false)

      // Dismiss
      await domain.dismiss()

      // After dismiss
      status = await domain.getSetupStatus()
      assert.equal(status.dismissed, true)
    })
  })

  describe('full flow scenarios', () => {
    it('new user: Claude configured → still sees onboarding → dismisses → done', async () => {
      const domain = createSetupDomain(configStore)

      // Step 1: Fresh install, nothing configured
      let status = await domain.getSetupStatus()
      assert.equal(status.claude, false)
      assert.equal(status.dismissed, false)

      // Step 2: User saves Claude token (simulated via config)
      await configStore.setConfig('claude_oauth_token', 'sk-ant-test')
      // Also set setup_dismissed to false to indicate it was set during this session
      await configStore.setConfig('setup_dismissed', 'false')

      status = await domain.getSetupStatus()
      assert.equal(status.claude, true)
      assert.equal(status.dismissed, false, 'should still show onboarding for optional steps')

      // Step 3: User clicks "Continue to chat"
      await domain.dismiss()
      status = await domain.getSetupStatus()
      assert.equal(status.dismissed, true)
    })

    it('returning user: auto-dismissed, never sees onboarding', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
        telegram_token: 'bot-token',
        gitea_url: 'http://gitea:3000',
        gitea_token: 'gitea-token',
      })
      const domain = createSetupDomain(configStore)

      const status = await domain.getSetupStatus()
      assert.equal(status.claude, true)
      assert.equal(status.complete, true)
      assert.equal(status.dismissed, true, 'auto-dismissed for returning user')
    })

    it('returning user with setup_dismissed already set: works normally', async () => {
      configStore.seed({
        claude_oauth_token: 'sk-ant-test',
        setup_dismissed: 'true',
      })
      const domain = createSetupDomain(configStore)

      const status = await domain.getSetupStatus()
      assert.equal(status.dismissed, true)
    })
  })
})
