/**
 * Context Cache — smart caching layer for Thread Context Stack (Issue #304)
 *
 * Key optimizations:
 * 1. Checksum-based change detection — only refresh layers that actually changed
 * 2. Session-aware skip — don't re-inject context during active interactive sessions
 * 3. Fork-from-cache — sub-threads inherit parent's cached context cheaply
 * 4. Webhook-triggered invalidation — targeted cache busting on relevant events
 *
 * Cache key structure: `{layer}:{identifier}`
 *   - `claude_md:{owner/repo}` → CLAUDE.md content
 *   - `issue:{repo}#{number}` → issue data
 *   - `context_stack:{threadId}` → full assembled context stack
 *   - `session:{sessionId}` → last-injected checksums for a session
 */

import { createHash } from 'crypto'

// ─── Types ──────────────────────────────────────────────────────────

export interface CacheEntry<T = string> {
  /** Cached value */
  value: T
  /** SHA-256 checksum of the value (for change detection) */
  checksum: string
  /** When this entry was created (ms since epoch) */
  createdAt: number
  /** When this entry expires (ms since epoch) */
  expiresAt: number
}

/** Checksums for each context layer, used to detect changes between sessions */
export interface LayerChecksums {
  repoContext?: string
  ticketChain?: string
  threadLineage?: string
  executionState?: string
}

/** Session injection record — tracks what was injected into a session */
export interface SessionInjection {
  /** Session ID from Claude SDK */
  sessionId: string
  /** Thread ID this injection was for */
  threadId: string
  /** Checksums of each layer at time of injection */
  checksums: LayerChecksums
  /** When the injection happened */
  injectedAt: number
}

/** Cache statistics for monitoring */
export interface CacheStats {
  /** Total entries in cache */
  size: number
  /** Cache hits since startup */
  hits: number
  /** Cache misses since startup */
  misses: number
  /** Hit rate percentage */
  hitRate: number
  /** Number of active session records */
  activeSessions: number
}

/** Result of a change detection check */
export interface ChangeDetectionResult {
  /** Whether any layer has changed since last injection */
  hasChanges: boolean
  /** Which specific layers changed */
  changedLayers: (keyof LayerChecksums)[]
  /** Previous checksums (from session record) */
  previousChecksums: LayerChecksums | null
  /** Current checksums */
  currentChecksums: LayerChecksums
}

// ─── TTL Constants ──────────────────────────────────────────────────

export const CLAUDE_MD_TTL = 5 * 60 * 1000    // 5 minutes
export const TICKET_TTL = 10 * 60 * 1000       // 10 minutes
export const LINEAGE_TTL = 30 * 60 * 1000      // 30 min (changes only on compaction)
export const CONTEXT_STACK_TTL = 5 * 60 * 1000  // 5 min (composite cache)
export const SESSION_TTL = 60 * 60 * 1000       // 1 hour (session records)

// ─── Cache Store ────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>()
const sessionInjections = new Map<string, SessionInjection>()
let hits = 0
let misses = 0

// ─── Utility Functions ──────────────────────────────────────────────

/** Compute SHA-256 checksum of a string (first 16 hex chars) */
export const computeChecksum = (value: string): string => {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** Estimate tokens from text (~4 chars per token) */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

// ─── Core Cache Operations ──────────────────────────────────────────

/**
 * Get a cached value by key. Returns null if expired or not found.
 */
export const getCached = (key: string): string | null => {
  const entry = cache.get(key)
  if (!entry) {
    misses++
    return null
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    misses++
    return null
  }
  hits++
  return entry.value
}

/**
 * Get a cached entry with its checksum. Returns null if expired or not found.
 */
export const getCachedWithChecksum = (key: string): { value: string; checksum: string } | null => {
  const entry = cache.get(key)
  if (!entry) {
    misses++
    return null
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    misses++
    return null
  }
  hits++
  return { value: entry.value, checksum: entry.checksum }
}

/**
 * Store a value in the cache with TTL and automatic checksum.
 * Returns the computed checksum.
 */
export const setCache = (key: string, value: string, ttl: number): string => {
  const checksum = computeChecksum(value)
  cache.set(key, {
    value,
    checksum,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttl,
  })
  return checksum
}

/**
 * Invalidate all cache entries matching a prefix.
 * Returns the number of invalidated entries.
 *
 * Examples:
 *   invalidateByPrefix('claude_md:idea/gigi')  → invalidates CLAUDE.md for that repo
 *   invalidateByPrefix('issue:idea/gigi#')     → invalidates all issues for that repo
 *   invalidateByPrefix('context_stack:')        → invalidates all assembled stacks
 */
export const invalidateByPrefix = (prefix: string): number => {
  let count = 0
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key)
      count++
    }
  }
  return count
}

/**
 * Invalidate a specific cache key.
 */
export const invalidateKey = (key: string): boolean => {
  return cache.delete(key)
}

/**
 * Clear all cached data (cache + session records).
 */
export const clearAll = (): void => {
  cache.clear()
  sessionInjections.clear()
  hits = 0
  misses = 0
}

/**
 * Clear only the data cache (keep session records).
 */
export const clearDataCache = (): void => {
  cache.clear()
}

// ─── Session Tracking ───────────────────────────────────────────────

/**
 * Record that a context stack was injected into a session.
 * Used for change detection on session resume.
 */
export const recordInjection = (
  sessionId: string,
  threadId: string,
  checksums: LayerChecksums
): void => {
  sessionInjections.set(sessionId, {
    sessionId,
    threadId,
    checksums,
    injectedAt: Date.now(),
  })
}

/**
 * Get the last injection record for a session.
 * Returns null if no record exists or the session is stale.
 */
export const getLastInjection = (sessionId: string): SessionInjection | null => {
  const record = sessionInjections.get(sessionId)
  if (!record) return null
  // Expire stale session records
  if (Date.now() - record.injectedAt > SESSION_TTL) {
    sessionInjections.delete(sessionId)
    return null
  }
  return record
}

/**
 * Detect what has changed since the last injection for a session.
 * Compares current layer checksums against the stored session injection record.
 */
export const detectChanges = (
  sessionId: string,
  currentChecksums: LayerChecksums
): ChangeDetectionResult => {
  const lastInjection = getLastInjection(sessionId)
  if (!lastInjection) {
    // No previous injection: everything is "new"
    const changedLayers = (Object.keys(currentChecksums) as (keyof LayerChecksums)[])
      .filter(k => currentChecksums[k] !== undefined)
    return {
      hasChanges: changedLayers.length > 0,
      changedLayers,
      previousChecksums: null,
      currentChecksums,
    }
  }

  const prev = lastInjection.checksums
  const changedLayers: (keyof LayerChecksums)[] = []

  for (const key of Object.keys(currentChecksums) as (keyof LayerChecksums)[]) {
    const current = currentChecksums[key]
    const previous = prev[key]
    // Changed if: new layer appeared, or checksum differs
    if (current && current !== previous) {
      changedLayers.push(key)
    }
  }

  // Also check for removed layers (layer was present before but not now)
  for (const key of Object.keys(prev) as (keyof LayerChecksums)[]) {
    if (prev[key] && !currentChecksums[key] && !changedLayers.includes(key)) {
      changedLayers.push(key)
    }
  }

  return {
    hasChanges: changedLayers.length > 0,
    changedLayers,
    previousChecksums: prev,
    currentChecksums,
  }
}

/**
 * Remove a session injection record (e.g., when session ends).
 */
export const removeSession = (sessionId: string): boolean => {
  return sessionInjections.delete(sessionId)
}

// ─── Fork-from-Cache ────────────────────────────────────────────────

/** Cached context stack for a thread */
export interface CachedContextStack {
  threadId: string
  layers: Array<{
    name: keyof LayerChecksums
    content: string
    checksum: string
    estimatedTokens: number
  }>
  totalTokens: number
  formatted: string
  checksums: LayerChecksums
}

/**
 * Cache a fully-built context stack for a thread.
 */
export const cacheContextStack = (stack: CachedContextStack): void => {
  const key = `context_stack:${stack.threadId}`
  setCache(key, JSON.stringify(stack), CONTEXT_STACK_TTL)
}

/**
 * Get a cached context stack for a thread.
 */
export const getCachedContextStack = (threadId: string): CachedContextStack | null => {
  const raw = getCached(`context_stack:${threadId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CachedContextStack
  } catch {
    return null
  }
}

/**
 * Fork a parent thread's cached context for a sub-thread.
 * Copies shared layers (repo context, lineage) and allows overrides
 * for child-specific layers (ticket chain, execution state).
 *
 * This is much cheaper than rebuilding from scratch — shared layers
 * (like CLAUDE.md) are reused directly without re-fetching.
 */
export const forkContextStack = (
  parentThreadId: string,
  childThreadId: string,
  overrides?: {
    ticketChain?: { content: string; checksum: string; estimatedTokens: number }
    executionState?: { content: string; checksum: string; estimatedTokens: number }
    threadLineage?: { content: string; checksum: string; estimatedTokens: number }
  }
): CachedContextStack | null => {
  const parentStack = getCachedContextStack(parentThreadId)
  if (!parentStack) return null

  const childLayers = parentStack.layers.map(layer => {
    // Override child-specific layers
    if (overrides?.ticketChain && layer.name === 'ticketChain') {
      return { ...layer, ...overrides.ticketChain, name: 'ticketChain' as const }
    }
    if (overrides?.executionState && layer.name === 'executionState') {
      return { ...layer, ...overrides.executionState, name: 'executionState' as const }
    }
    if (overrides?.threadLineage && layer.name === 'threadLineage') {
      return { ...layer, ...overrides.threadLineage, name: 'threadLineage' as const }
    }
    // Keep parent's shared layers (repo context especially)
    return { ...layer }
  })

  // Add overrides for layers that didn't exist in parent
  if (overrides?.ticketChain && !childLayers.some(l => l.name === 'ticketChain')) {
    childLayers.push({ name: 'ticketChain', ...overrides.ticketChain })
  }
  if (overrides?.executionState && !childLayers.some(l => l.name === 'executionState')) {
    childLayers.push({ name: 'executionState', ...overrides.executionState })
  }
  if (overrides?.threadLineage && !childLayers.some(l => l.name === 'threadLineage')) {
    childLayers.push({ name: 'threadLineage', ...overrides.threadLineage })
  }

  const totalTokens = childLayers.reduce((sum, l) => sum + l.estimatedTokens, 0)
  const formatted = childLayers.map(l => l.content).join('\n\n---\n\n')
  const checksums: LayerChecksums = {}
  for (const layer of childLayers) {
    checksums[layer.name] = layer.checksum
  }

  const childStack: CachedContextStack = {
    threadId: childThreadId,
    layers: childLayers,
    totalTokens,
    formatted,
    checksums,
  }

  // Cache the forked stack
  cacheContextStack(childStack)

  return childStack
}

// ─── Webhook Invalidation ───────────────────────────────────────────

/**
 * Invalidate caches in response to a webhook event.
 * Call this from webhookRouter.ts when relevant events occur.
 *
 * Returns the total number of cache entries invalidated.
 */
export const invalidateForWebhook = (
  eventType: 'issue_update' | 'pr_merge' | 'pr_close' | 'push' | 'issue_close',
  repo: string,
  details?: { number?: number; files?: string[] }
): number => {
  let invalidated = 0

  switch (eventType) {
    case 'issue_update':
    case 'issue_close':
      // Invalidate the specific issue cache
      if (details?.number) {
        invalidated += invalidateByPrefix(`issue:${repo}#${details.number}`)
      }
      // Also invalidate any context stacks that might include this issue
      invalidated += invalidateByPrefix('context_stack:')
      break

    case 'pr_merge':
    case 'pr_close':
      // Invalidate PR-related caches
      if (details?.number) {
        invalidated += invalidateByPrefix(`issue:${repo}#${details.number}`)
      }
      invalidated += invalidateByPrefix('context_stack:')
      break

    case 'push':
      // Check if CLAUDE.md was modified in this push
      if (details?.files?.some(f => f === 'CLAUDE.md' || f.endsWith('/CLAUDE.md'))) {
        invalidated += invalidateByPrefix(`claude_md:${repo}`)
        invalidated += invalidateByPrefix('context_stack:')
      }
      break
  }

  if (invalidated > 0) {
    console.log(`[context-cache] Invalidated ${invalidated} entries for ${eventType} on ${repo}`)
  }

  return invalidated
}

// ─── Garbage Collection ─────────────────────────────────────────────

/**
 * Remove expired entries from the cache. Called periodically or manually.
 * Returns the number of removed entries.
 */
export const gc = (): number => {
  const now = Date.now()
  let removed = 0

  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key)
      removed++
    }
  }

  // Also clean stale session records
  for (const [sessionId, record] of sessionInjections.entries()) {
    if (now - record.injectedAt > SESSION_TTL) {
      sessionInjections.delete(sessionId)
      removed++
    }
  }

  return removed
}

// ─── Stats ──────────────────────────────────────────────────────────

/**
 * Get cache statistics for monitoring.
 */
export const getStats = (): CacheStats => {
  const total = hits + misses
  return {
    size: cache.size,
    hits,
    misses,
    hitRate: total > 0 ? (hits / total) * 100 : 0,
    activeSessions: sessionInjections.size,
  }
}
