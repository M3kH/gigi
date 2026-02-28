/**
 * Tests for conversation-lock module
 *
 * Covers:
 * - Basic lock acquire/release lifecycle
 * - Mutual exclusion (second acquirer waits)
 * - tryAcquireLock (non-blocking)
 * - Lock timeout
 * - Message queueing while locked
 * - Queue draining
 * - isLocked / getLockInfo diagnostics
 * - forceRelease (emergency cleanup)
 * - Idempotent release (double-release safety)
 * - Multiple conversations locked independently
 *
 * @see https://prod.gigi.local/gitea/idea/gigi/issues/371
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  acquireLock,
  tryAcquireLock,
  isLocked,
  getLockInfo,
  enqueueMessage,
  drainQueue,
  getQueueSize,
  getLockedConversations,
  forceRelease,
  _resetAll,
} from '../lib/core/conversation-lock'

beforeEach(() => {
  _resetAll()
})

describe('conversation-lock', () => {
  // ── Basic Lifecycle ──────────────────────────────────────────────

  describe('acquireLock / release', () => {
    it('should acquire and release a lock', async () => {
      const release = await acquireLock('conv-1', 'test')
      expect(isLocked('conv-1')).toBe(true)

      release()
      expect(isLocked('conv-1')).toBe(false)
    })

    it('should allow re-acquiring after release', async () => {
      const release1 = await acquireLock('conv-1', 'holder-A')
      release1()

      const release2 = await acquireLock('conv-1', 'holder-B')
      expect(isLocked('conv-1')).toBe(true)
      expect(getLockInfo('conv-1')?.holder).toBe('holder-B')
      release2()
    })

    it('should be idempotent on double-release', async () => {
      const release = await acquireLock('conv-1', 'test')
      release()
      release() // Should not throw
      expect(isLocked('conv-1')).toBe(false)
    })
  })

  // ── Mutual Exclusion ─────────────────────────────────────────────

  describe('mutual exclusion', () => {
    it('should make second acquirer wait until first releases', async () => {
      const events: string[] = []

      const release1 = await acquireLock('conv-1', 'holder-A')
      events.push('A-acquired')

      // Start acquiring from B (will block)
      const acquireB = acquireLock('conv-1', 'holder-B').then((release) => {
        events.push('B-acquired')
        return release
      })

      // Give B a chance to start waiting
      await new Promise((r) => setTimeout(r, 10))
      expect(events).toEqual(['A-acquired'])
      expect(getLockInfo('conv-1')?.holder).toBe('holder-A')

      // Release A → B should acquire
      release1()
      events.push('A-released')

      const release2 = await acquireB
      expect(events).toEqual(['A-acquired', 'A-released', 'B-acquired'])
      expect(getLockInfo('conv-1')?.holder).toBe('holder-B')

      release2()
    })

    it('should serialize three concurrent acquirers', async () => {
      const order: string[] = []

      const release1 = await acquireLock('conv-1', 'A')
      order.push('A')

      const p2 = acquireLock('conv-1', 'B').then((r) => { order.push('B'); return r })
      const p3 = acquireLock('conv-1', 'C').then((r) => { order.push('C'); return r })

      // Release A → B acquires
      await new Promise((r) => setTimeout(r, 10))
      release1()

      const release2 = await p2
      // Release B → C acquires
      release2()

      const release3 = await p3
      release3()

      expect(order).toEqual(['A', 'B', 'C'])
    })
  })

  // ── tryAcquireLock (non-blocking) ────────────────────────────────

  describe('tryAcquireLock', () => {
    it('should return release function when unlocked', () => {
      const release = tryAcquireLock('conv-1', 'test')
      expect(release).not.toBeNull()
      expect(isLocked('conv-1')).toBe(true)
      release!()
      expect(isLocked('conv-1')).toBe(false)
    })

    it('should return null when already locked', async () => {
      const release = await acquireLock('conv-1', 'holder-A')
      const result = tryAcquireLock('conv-1', 'holder-B')
      expect(result).toBeNull()
      release()
    })
  })

  // ── Timeout ──────────────────────────────────────────────────────

  describe('timeout', () => {
    it('should throw on timeout waiting for lock', async () => {
      const release = await acquireLock('conv-1', 'holder-A')

      await expect(
        acquireLock('conv-1', 'holder-B', 50) // 50ms timeout
      ).rejects.toThrow(/timeout/i)

      release()
    })

    it('should acquire if released before timeout', async () => {
      const release1 = await acquireLock('conv-1', 'holder-A')

      // Release after 20ms
      setTimeout(() => release1(), 20)

      // Try to acquire with 200ms timeout — should succeed
      const release2 = await acquireLock('conv-1', 'holder-B', 200)
      expect(isLocked('conv-1')).toBe(true)
      release2()
    })
  })

  // ── Message Queue ────────────────────────────────────────────────

  describe('message queue', () => {
    it('should queue messages and drain them', () => {
      enqueueMessage('conv-1', 'Hello', 'web')
      enqueueMessage('conv-1', 'World', 'telegram')
      expect(getQueueSize('conv-1')).toBe(2)

      const messages = drainQueue('conv-1')
      expect(messages).toHaveLength(2)
      expect(messages[0].text).toBe('Hello')
      expect(messages[0].channel).toBe('web')
      expect(messages[1].text).toBe('World')
      expect(messages[1].channel).toBe('telegram')

      // Queue should be empty after drain
      expect(getQueueSize('conv-1')).toBe(0)
      expect(drainQueue('conv-1')).toEqual([])
    })

    it('should return empty array for conversations with no queue', () => {
      expect(drainQueue('nonexistent')).toEqual([])
      expect(getQueueSize('nonexistent')).toBe(0)
    })

    it('should keep separate queues per conversation', () => {
      enqueueMessage('conv-1', 'msg-1', 'web')
      enqueueMessage('conv-2', 'msg-2', 'web')

      expect(getQueueSize('conv-1')).toBe(1)
      expect(getQueueSize('conv-2')).toBe(1)

      const q1 = drainQueue('conv-1')
      expect(q1).toHaveLength(1)
      expect(q1[0].text).toBe('msg-1')

      // conv-2 queue should be unaffected
      expect(getQueueSize('conv-2')).toBe(1)
    })
  })

  // ── Diagnostics ──────────────────────────────────────────────────

  describe('diagnostics', () => {
    it('getLockInfo returns null for unlocked conversation', () => {
      expect(getLockInfo('conv-1')).toBeNull()
    })

    it('getLockInfo returns holder info for locked conversation', async () => {
      const release = await acquireLock('conv-1', 'handleMessage:web')
      const info = getLockInfo('conv-1')
      expect(info).not.toBeNull()
      expect(info!.holder).toBe('handleMessage:web')
      expect(info!.acquiredAt).toBeLessThanOrEqual(Date.now())
      expect(info!.durationMs).toBeGreaterThanOrEqual(0)
      release()
    })

    it('getLockedConversations returns all locked IDs', async () => {
      const r1 = await acquireLock('conv-1', 'A')
      const r2 = await acquireLock('conv-2', 'B')

      const locked = getLockedConversations()
      expect(locked).toContain('conv-1')
      expect(locked).toContain('conv-2')
      expect(locked).toHaveLength(2)

      r1()
      r2()
    })
  })

  // ── Force Release ────────────────────────────────────────────────

  describe('forceRelease', () => {
    it('should release a held lock', async () => {
      await acquireLock('conv-1', 'stuck-agent')
      expect(isLocked('conv-1')).toBe(true)

      const released = forceRelease('conv-1')
      expect(released).toBe(true)
      expect(isLocked('conv-1')).toBe(false)
    })

    it('should return false for non-existent lock', () => {
      expect(forceRelease('nonexistent')).toBe(false)
    })

    it('should unblock a waiting acquirer', async () => {
      await acquireLock('conv-1', 'stuck-agent')

      // Start waiting
      const acquirePromise = acquireLock('conv-1', 'rescuer', 5000)

      await new Promise((r) => setTimeout(r, 10))
      forceRelease('conv-1')

      const release2 = await acquirePromise
      expect(getLockInfo('conv-1')?.holder).toBe('rescuer')
      release2()
    })
  })

  // ── Independent Conversations ────────────────────────────────────

  describe('independent conversations', () => {
    it('should lock different conversations independently', async () => {
      const r1 = await acquireLock('conv-1', 'holder-A')
      const r2 = await acquireLock('conv-2', 'holder-B')

      expect(isLocked('conv-1')).toBe(true)
      expect(isLocked('conv-2')).toBe(true)

      r1()
      expect(isLocked('conv-1')).toBe(false)
      expect(isLocked('conv-2')).toBe(true) // Still locked

      r2()
      expect(isLocked('conv-2')).toBe(false)
    })
  })

  // ── Edge Cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle rapid acquire/release cycles', async () => {
      for (let i = 0; i < 20; i++) {
        const release = await acquireLock('conv-1', `cycle-${i}`)
        expect(isLocked('conv-1')).toBe(true)
        release()
        expect(isLocked('conv-1')).toBe(false)
      }
    })

    it('should handle concurrent acquire on different conversations', async () => {
      const releases = await Promise.all([
        acquireLock('conv-1', 'A'),
        acquireLock('conv-2', 'B'),
        acquireLock('conv-3', 'C'),
      ])

      expect(getLockedConversations()).toHaveLength(3)

      releases.forEach((r) => r())
      expect(getLockedConversations()).toHaveLength(0)
    })

    it('_resetAll should clear all locks and queues', async () => {
      await acquireLock('conv-1', 'A')
      await acquireLock('conv-2', 'B')
      enqueueMessage('conv-1', 'msg', 'web')

      _resetAll()

      expect(isLocked('conv-1')).toBe(false)
      expect(isLocked('conv-2')).toBe(false)
      expect(getQueueSize('conv-1')).toBe(0)
    })
  })
})
