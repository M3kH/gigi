/**
 * Tests for setup dismissed state persistence (setup.svelte.ts logic)
 *
 * Validates:
 * - dismissed flag persists across page reloads via localStorage
 * - Auto-dismiss works for returning users (Claude already configured on page load)
 * - Auto-dismiss does NOT trigger during initial setup (after submitSetup)
 * - isSetupComplete requires both Claude configured AND dismissed
 *
 * Since the store uses Svelte 5 runes ($state), we mirror the core logic here
 * to test it with the Node.js test runner — same pattern as setup-telegram.test.ts.
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Mock localStorage ────────────────────────────────────────────────

class MockLocalStorage {
  private store: Record<string, string> = {}

  getItem(key: string): string | null {
    return this.store[key] ?? null
  }

  setItem(key: string, value: string): void {
    this.store[key] = value
  }

  removeItem(key: string): void {
    delete this.store[key]
  }

  clear(): void {
    this.store = {}
  }
}

// ── Mirror of setup store logic ──────────────────────────────────────
// Reproduces the logic from web/app/lib/stores/setup.svelte.ts
// without Svelte runes, for testability.

interface SetupStatus {
  claude: boolean
  telegram: boolean
  gitea: boolean
  complete: boolean
}

function createSetupStore(localStorage: MockLocalStorage) {
  let status: SetupStatus | null = null
  let dismissed = localStorage.getItem('setup_dismissed') === 'true'

  return {
    // Simulates checkSetup() — accepts a status response instead of fetching
    checkSetup(apiResponse: SetupStatus) {
      const prev = status
      status = apiResponse
      // Auto-dismiss for returning users on initial page load
      if (prev === null && status?.claude && !dismissed) {
        dismissed = true
        localStorage.setItem('setup_dismissed', 'true')
      }
    },

    // Simulates submitSetup() — calls checkSetup after
    submitSetup(apiResponse: SetupStatus) {
      // submitSetup calls checkSetup internally (status is no longer null)
      this.checkSetup(apiResponse)
    },

    dismissSetup() {
      dismissed = true
      localStorage.setItem('setup_dismissed', 'true')
    },

    isSetupComplete(): boolean {
      return status?.claude === true && dismissed
    },

    get dismissed() {
      return dismissed
    },

    get status() {
      return status
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Setup — dismissed state persistence', () => {
  let ls: MockLocalStorage

  beforeEach(() => {
    ls = new MockLocalStorage()
  })

  describe('localStorage initialization', () => {
    it('dismissed defaults to false when localStorage is empty', () => {
      const store = createSetupStore(ls)
      assert.equal(store.dismissed, false)
    })

    it('dismissed initializes to true when localStorage has setup_dismissed=true', () => {
      ls.setItem('setup_dismissed', 'true')
      const store = createSetupStore(ls)
      assert.equal(store.dismissed, true)
    })

    it('dismissed is false for any other localStorage value', () => {
      ls.setItem('setup_dismissed', 'false')
      const store = createSetupStore(ls)
      assert.equal(store.dismissed, false)
    })
  })

  describe('dismissSetup persistence', () => {
    it('sets dismissed to true and persists in localStorage', () => {
      const store = createSetupStore(ls)
      assert.equal(store.dismissed, false)

      store.dismissSetup()

      assert.equal(store.dismissed, true)
      assert.equal(ls.getItem('setup_dismissed'), 'true')
    })

    it('dismissed survives simulated page reload', () => {
      // Session 1: user dismisses setup
      const store1 = createSetupStore(ls)
      store1.dismissSetup()
      assert.equal(ls.getItem('setup_dismissed'), 'true')

      // Session 2: new store reads from same localStorage
      const store2 = createSetupStore(ls)
      assert.equal(store2.dismissed, true)
    })
  })

  describe('isSetupComplete', () => {
    it('returns false when neither Claude nor dismissed', () => {
      const store = createSetupStore(ls)
      store.checkSetup({ claude: false, telegram: false, gitea: false, complete: false })
      assert.equal(store.isSetupComplete(), false)
    })

    it('returns false when Claude configured but not dismissed', () => {
      const store = createSetupStore(ls)
      // Force dismissed to stay false by not having localStorage set
      // AND by having Claude not configured on first check
      store.checkSetup({ claude: false, telegram: false, gitea: false, complete: false })
      // Now "submit" Claude — triggers checkSetup with claude: true but prev !== null
      store.submitSetup({ claude: true, telegram: false, gitea: false, complete: false })
      assert.equal(store.isSetupComplete(), false, 'should not auto-dismiss during setup flow')
    })

    it('returns true when Claude configured AND dismissed', () => {
      const store = createSetupStore(ls)
      store.checkSetup({ claude: true, telegram: false, gitea: false, complete: false })
      // Auto-dismiss triggers because prev===null and claude is true
      assert.equal(store.isSetupComplete(), true)
    })

    it('returns true when dismissed via button click', () => {
      const store = createSetupStore(ls)
      store.checkSetup({ claude: false, telegram: false, gitea: false, complete: false })
      store.submitSetup({ claude: true, telegram: false, gitea: false, complete: false })
      // User clicks "Continue to chat"
      store.dismissSetup()
      assert.equal(store.isSetupComplete(), true)
    })
  })

  describe('auto-dismiss for returning users', () => {
    it('auto-dismisses when Claude is already configured on first page load', () => {
      const store = createSetupStore(ls)
      // Simulate: returning user loads page, API says Claude is configured
      store.checkSetup({ claude: true, telegram: true, gitea: true, complete: true })

      assert.equal(store.dismissed, true)
      assert.equal(ls.getItem('setup_dismissed'), 'true')
      assert.equal(store.isSetupComplete(), true)
    })

    it('does NOT auto-dismiss during initial setup after saving Claude token', () => {
      const store = createSetupStore(ls)

      // Step 1: Initial page load — Claude not configured yet
      store.checkSetup({ claude: false, telegram: false, gitea: false, complete: false })
      assert.equal(store.dismissed, false, 'should not dismiss when Claude is not configured')

      // Step 2: User saves Claude token, submitSetup refreshes status
      store.submitSetup({ claude: true, telegram: false, gitea: false, complete: false })
      assert.equal(store.dismissed, false, 'should not auto-dismiss after saving token during setup')
      assert.equal(store.isSetupComplete(), false, 'setup should not be complete — user can still configure Telegram')
    })

    it('does not auto-dismiss if Claude is not configured on page load', () => {
      const store = createSetupStore(ls)
      store.checkSetup({ claude: false, telegram: false, gitea: false, complete: false })

      assert.equal(store.dismissed, false)
      assert.equal(ls.getItem('setup_dismissed'), null)
    })
  })

  describe('full flow scenarios', () => {
    it('first-time user: setup → configure Claude → configure Telegram → dismiss', () => {
      const store = createSetupStore(ls)

      // Page load: nothing configured
      store.checkSetup({ claude: false, telegram: false, gitea: false, complete: false })
      assert.equal(store.isSetupComplete(), false)

      // Save Claude token
      store.submitSetup({ claude: true, telegram: false, gitea: false, complete: false })
      assert.equal(store.isSetupComplete(), false, 'should show onboarding for Telegram step')

      // Save Telegram token
      store.submitSetup({ claude: true, telegram: true, gitea: false, complete: false })
      assert.equal(store.isSetupComplete(), false, 'still needs manual dismiss')

      // User clicks "Continue to chat"
      store.dismissSetup()
      assert.equal(store.isSetupComplete(), true)
      assert.equal(ls.getItem('setup_dismissed'), 'true')
    })

    it('returning user: page load skips setup entirely', () => {
      // Previous session dismissed
      ls.setItem('setup_dismissed', 'true')

      const store = createSetupStore(ls)
      store.checkSetup({ claude: true, telegram: true, gitea: true, complete: true })

      assert.equal(store.isSetupComplete(), true)
    })

    it('returning user without localStorage (migration): auto-dismisses on load', () => {
      // User had setup before the dismissed flag was introduced
      // localStorage is empty, but Claude is configured
      const store = createSetupStore(ls)
      store.checkSetup({ claude: true, telegram: true, gitea: true, complete: true })

      // Auto-dismiss should kick in
      assert.equal(store.dismissed, true)
      assert.equal(ls.getItem('setup_dismissed'), 'true')
      assert.equal(store.isSetupComplete(), true)
    })
  })
})
