/**
 * Conversation Lock — Per-conversation async mutex
 *
 * Prevents multiple agents from running concurrently on the same conversation.
 * All entry points (web, Telegram, webhook, CI) must acquire the lock before
 * spawning an agent, and hold it through ALL continuation runs (maxTurns,
 * enforcer, completion detector).
 *
 * Messages arriving while an agent is running are queued per-conversation
 * and can be drained after the agent finishes.
 *
 * @see https://prod.gigi.local/gitea/idea/gigi/issues/371
 */

export interface QueuedMessage {
  text: string
  channel: string
  timestamp: number
}

interface LockEntry {
  /** The promise that resolves when the current holder releases */
  promise: Promise<void>
  /** Resolve function to release the lock */
  release: () => void
  /** Who acquired the lock (for debugging) */
  holder: string
  /** When the lock was acquired */
  acquiredAt: number
}

/** Per-conversation lock state */
const locks = new Map<string, LockEntry>()

/** Per-conversation message queue for messages arriving while locked */
const messageQueues = new Map<string, QueuedMessage[]>()

/**
 * Acquire the conversation lock. Returns a release function.
 * If the conversation is already locked, waits until the current holder releases.
 *
 * @param conversationId - The conversation to lock
 * @param holder - Descriptive name of who's acquiring (for logging)
 * @param timeoutMs - Max time to wait for the lock (default: 5 minutes)
 * @returns Release function — MUST be called in a finally block
 * @throws Error if timeout is exceeded waiting for the lock
 */
export async function acquireLock(
  conversationId: string,
  holder: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<() => void> {
  const startWait = Date.now()

  // Wait for any existing lock to be released
  while (locks.has(conversationId)) {
    const existing = locks.get(conversationId)!
    console.log(
      `[conversation-lock] ${holder} waiting for lock on ${conversationId} (held by ${existing.holder} since ${new Date(existing.acquiredAt).toISOString()})`,
    )

    // Race between existing lock releasing and timeout
    const elapsed = Date.now() - startWait
    if (elapsed >= timeoutMs) {
      throw new Error(
        `[conversation-lock] Timeout waiting for lock on ${conversationId} (held by ${existing.holder} for ${Math.round((Date.now() - existing.acquiredAt) / 1000)}s)`,
      )
    }

    const remaining = timeoutMs - elapsed
    await Promise.race([
      existing.promise,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Lock timeout for ${conversationId}`)),
          remaining,
        ),
      ),
    ])
  }

  // Acquire the lock
  let releaseFn!: () => void
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve
  })

  const entry: LockEntry = {
    promise,
    release: releaseFn,
    holder,
    acquiredAt: Date.now(),
  }

  locks.set(conversationId, entry)
  console.log(`[conversation-lock] ${holder} acquired lock on ${conversationId}`)

  // Return a release function that cleans up
  let released = false
  return () => {
    if (released) return // Idempotent
    released = true
    const current = locks.get(conversationId)
    // Only delete if we're still the holder (guard against stale releases)
    if (current === entry) {
      locks.delete(conversationId)
    }
    releaseFn()
    const duration = Math.round((Date.now() - entry.acquiredAt) / 1000)
    console.log(
      `[conversation-lock] ${holder} released lock on ${conversationId} (held ${duration}s)`,
    )
  }
}

/**
 * Try to acquire the lock without waiting.
 * Returns the release function if successful, null if already locked.
 */
export function tryAcquireLock(
  conversationId: string,
  holder: string,
): (() => void) | null {
  if (locks.has(conversationId)) {
    return null
  }

  let releaseFn!: () => void
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve
  })

  const entry: LockEntry = {
    promise,
    release: releaseFn,
    holder,
    acquiredAt: Date.now(),
  }

  locks.set(conversationId, entry)
  console.log(`[conversation-lock] ${holder} acquired lock on ${conversationId} (tryAcquire)`)

  let released = false
  return () => {
    if (released) return
    released = true
    const current = locks.get(conversationId)
    if (current === entry) {
      locks.delete(conversationId)
    }
    releaseFn()
    const duration = Math.round((Date.now() - entry.acquiredAt) / 1000)
    console.log(
      `[conversation-lock] ${holder} released lock on ${conversationId} (held ${duration}s)`,
    )
  }
}

/**
 * Check if a conversation is currently locked.
 */
export function isLocked(conversationId: string): boolean {
  return locks.has(conversationId)
}

/**
 * Get info about the current lock holder (for diagnostics).
 */
export function getLockInfo(
  conversationId: string,
): { holder: string; acquiredAt: number; durationMs: number } | null {
  const entry = locks.get(conversationId)
  if (!entry) return null
  return {
    holder: entry.holder,
    acquiredAt: entry.acquiredAt,
    durationMs: Date.now() - entry.acquiredAt,
  }
}

/**
 * Queue a message for a locked conversation.
 * The message will be available via drainQueue() after the agent finishes.
 */
export function enqueueMessage(
  conversationId: string,
  text: string,
  channel: string,
): void {
  if (!messageQueues.has(conversationId)) {
    messageQueues.set(conversationId, [])
  }
  messageQueues.get(conversationId)!.push({
    text,
    channel,
    timestamp: Date.now(),
  })
  console.log(
    `[conversation-lock] Queued message for locked conversation ${conversationId} (queue size: ${messageQueues.get(conversationId)!.length})`,
  )
}

/**
 * Drain and return all queued messages for a conversation.
 * Clears the queue. Returns empty array if no messages queued.
 */
export function drainQueue(conversationId: string): QueuedMessage[] {
  const queue = messageQueues.get(conversationId) || []
  messageQueues.delete(conversationId)
  return queue
}

/**
 * Get the number of queued messages for a conversation.
 */
export function getQueueSize(conversationId: string): number {
  return messageQueues.get(conversationId)?.length || 0
}

/**
 * Get all currently locked conversation IDs (for diagnostics).
 */
export function getLockedConversations(): string[] {
  return [...locks.keys()]
}

/**
 * Force-release a lock (emergency use only — e.g., stuck agent cleanup).
 * Returns true if a lock was released, false if none existed.
 */
export function forceRelease(conversationId: string): boolean {
  const entry = locks.get(conversationId)
  if (!entry) return false
  console.warn(
    `[conversation-lock] FORCE RELEASE on ${conversationId} (held by ${entry.holder} for ${Math.round((Date.now() - entry.acquiredAt) / 1000)}s)`,
  )
  locks.delete(conversationId)
  entry.release()
  return true
}

// ── Testing helpers ──────────────────────────────────────────────────

/** Reset all locks and queues (for testing only) */
export function _resetAll(): void {
  for (const entry of locks.values()) {
    entry.release()
  }
  locks.clear()
  messageQueues.clear()
}
