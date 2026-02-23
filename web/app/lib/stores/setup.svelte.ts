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
let dismissed = $state(false)

// ── API ───────────────────────────────────────────────────────────────

export async function checkSetup(): Promise<void> {
  loading = true
  error = null
  try {
    const res = await fetch('/api/setup/status')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    status = await res.json()
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
}

export function getSetupError(): string | null {
  return error
}
