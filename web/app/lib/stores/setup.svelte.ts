/**
 * Setup store — Svelte 5 runes for onboarding state
 *
 * Checks if the platform is configured (Claude token, Gitea, etc.)
 * and exposes setup status + actions.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface SetupStatus {
  claude: boolean
  telegram: boolean
  gitea: boolean
  complete: boolean
}

export interface SetupResult {
  ok: boolean
  message?: string
  error?: string
}

// ── State ─────────────────────────────────────────────────────────────

let status = $state<SetupStatus | null>(null)
let loading = $state(true)
let error = $state<string | null>(null)
let dismissed = $state(localStorage.getItem('setup_dismissed') === 'true')

// ── API ───────────────────────────────────────────────────────────────

export async function checkSetup(): Promise<void> {
  loading = true
  error = null
  try {
    const res = await fetch('/api/setup/status')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const prev = status
    status = await res.json()
    // Auto-dismiss for returning users on initial page load:
    // If Claude was already configured before we checked (not just saved during
    // this session via submitSetup), and user hasn't dismissed yet, they're a
    // returning user who set up before the dismissed flag existed.
    if (prev === null && status?.claude && !dismissed) {
      dismissed = true
      localStorage.setItem('setup_dismissed', 'true')
    }
  } catch (err) {
    error = (err as Error).message
    // If we can't reach the API, assume not set up
    status = { claude: false, telegram: false, gitea: false, complete: false }
  } finally {
    loading = false
  }
}

export async function submitSetup(step: string, data: Record<string, string>): Promise<SetupResult> {
  const res = await fetch(`/api/setup/${step}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result: SetupResult = await res.json()
  if (result.ok) {
    await checkSetup() // refresh status
  }
  return result
}

// ── Getters ───────────────────────────────────────────────────────────

export function getSetupStatus(): SetupStatus | null {
  return status
}

export function isSetupLoading(): boolean {
  return loading
}

export function isSetupComplete(): boolean {
  return status?.claude === true && dismissed
}

export function dismissSetup(): void {
  dismissed = true
  localStorage.setItem('setup_dismissed', 'true')
}

export function getSetupError(): string | null {
  return error
}
