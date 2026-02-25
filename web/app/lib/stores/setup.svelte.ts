/**
 * Setup store — Svelte 5 runes for onboarding state
 *
 * Checks if the platform is configured (Claude token, Gitea, etc.)
 * and exposes setup status + actions.
 *
 * The `dismissed` flag is persisted server-side in the PostgreSQL config
 * store (not localStorage) so it survives browser clears and works
 * across devices.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface SetupStatus {
  claude: boolean
  telegram: boolean
  gitea: boolean
  complete: boolean
  dismissed: boolean
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
    status = { claude: false, telegram: false, gitea: false, complete: false, dismissed: false }
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
  return status?.claude === true && status?.dismissed === true
}

export async function dismissSetup(): Promise<void> {
  // Persist server-side
  await fetch('/api/setup/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  // Update local state immediately
  if (status) {
    status = { ...status, dismissed: true }
  }
}

export function getSetupError(): string | null {
  return error
}
