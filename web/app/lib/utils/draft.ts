/**
 * Per-conversation draft persistence via localStorage.
 *
 * Drafts are keyed by conversation ID and stored as JSON with a timestamp.
 * They expire after DRAFT_MAX_AGE_MS (30 minutes) and are cleaned up on load.
 *
 * Used by ChatInput.svelte — extracted here for testability.
 */

export const DRAFT_PREFIX = 'gigi:draft:'
export const DRAFT_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

export interface DraftEntry {
  text: string
  ts: number
}

/** Derive the localStorage key for a given conversation */
export function draftKey(convId: string | null | undefined): string {
  return `${DRAFT_PREFIX}${convId ?? 'new'}`
}

/** Save draft text + timestamp to localStorage */
export function saveDraft(
  storage: Storage,
  convId: string | null | undefined,
  text: string,
  now: number = Date.now(),
): void {
  try {
    const key = draftKey(convId)
    const trimmed = text.trim()
    if (trimmed) {
      storage.setItem(key, JSON.stringify({ text, ts: now } satisfies DraftEntry))
    } else {
      storage.removeItem(key)
    }
  } catch {
    /* ignore quota errors */
  }
}

/** Load draft text from localStorage, returning null if stale or missing */
export function loadDraft(
  storage: Storage,
  convId: string | null | undefined,
  now: number = Date.now(),
): string | null {
  try {
    const key = draftKey(convId)
    const raw = storage.getItem(key)
    if (!raw) return null
    const { text, ts } = JSON.parse(raw) as DraftEntry
    if (now - ts > DRAFT_MAX_AGE_MS) {
      storage.removeItem(key)
      return null
    }
    return text ?? null
  } catch {
    return null
  }
}

/** Remove the draft for a specific conversation */
export function clearDraft(
  storage: Storage,
  convId: string | null | undefined,
): void {
  try {
    storage.removeItem(draftKey(convId))
  } catch {
    /* ignore */
  }
}

/** Remove all draft entries older than DRAFT_MAX_AGE_MS */
export function cleanStaleDrafts(
  storage: Storage,
  now: number = Date.now(),
): void {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(DRAFT_PREFIX)) continue
      try {
        const { ts } = JSON.parse(storage.getItem(key)!) as DraftEntry
        if (now - ts > DRAFT_MAX_AGE_MS) keysToRemove.push(key)
      } catch {
        keysToRemove.push(key) // corrupt entry, remove it
      }
    }
    keysToRemove.forEach((k) => storage.removeItem(k))
  } catch {
    /* ignore */
  }
}
