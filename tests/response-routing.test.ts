/**
 * Response Routing Tests
 *
 * Tests the cross-channel response routing logic including:
 * - Route determination based on originating channel and thread activity
 * - Significance classification for events
 * - Delivery metadata building
 * - Default notification rules
 *
 * Pure function tests — no database or API calls.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  determineRouting,
  isSignificantEvent,
  buildDeliveryMetadata,
  DEFAULT_NOTIFICATION_RULES,
  type NotificationRule,
} from '../lib/core/response-routing'

// ── determineRouting ──────────────────────────────────────────────────

describe('determineRouting', () => {
  it('should route web messages to web only (no cross-post)', () => {
    const routing = determineRouting('web', ['web'])
    assert.equal(routing.primary, 'web')
    assert.equal(routing.notify, undefined)
  })

  it('should route telegram messages to telegram only', () => {
    const routing = determineRouting('telegram', ['telegram'])
    assert.equal(routing.primary, 'telegram')
    assert.equal(routing.notify, undefined)
  })

  it('should not cross-post webhook to telegram when thread has no telegram activity', () => {
    const routing = determineRouting('webhook', ['web', 'webhook'])
    assert.equal(routing.primary, 'webhook')
    assert.equal(routing.notify, undefined)
  })

  it('should cross-post webhook to telegram when thread has telegram activity', () => {
    const routing = determineRouting('webhook', ['telegram', 'webhook'])
    assert.equal(routing.primary, 'webhook')
    assert.deepEqual(routing.notify, ['telegram'])
    assert.equal(routing.notifyCondition, 'significant')
  })

  it('should cross-post gitea_comment to telegram when thread has telegram activity', () => {
    const routing = determineRouting('gitea_comment', ['telegram', 'web', 'gitea_comment'])
    assert.equal(routing.primary, 'gitea_comment')
    assert.deepEqual(routing.notify, ['telegram'])
  })

  it('should cross-post gitea_review to telegram when thread has telegram activity', () => {
    const routing = determineRouting('gitea_review', ['telegram', 'gitea_review'])
    assert.equal(routing.primary, 'gitea_review')
    assert.deepEqual(routing.notify, ['telegram'])
  })

  it('should not cross-post web messages even when thread has telegram activity', () => {
    // Web is not in DEFAULT_NOTIFICATION_RULES sourceChannels
    const routing = determineRouting('web', ['web', 'telegram'])
    assert.equal(routing.primary, 'web')
    assert.equal(routing.notify, undefined)
  })

  it('should not cross-post to the same channel as originating', () => {
    const routing = determineRouting('telegram', ['telegram', 'web'])
    assert.equal(routing.primary, 'telegram')
    assert.equal(routing.notify, undefined)
  })

  it('should support custom notification rules', () => {
    const customRules: NotificationRule[] = [
      {
        sourceChannels: ['web'],
        targetChannels: ['telegram'],
        condition: 'always',
        description: 'Always notify telegram for web messages',
      },
    ]
    const routing = determineRouting('web', ['web', 'telegram'], customRules)
    assert.equal(routing.primary, 'web')
    assert.deepEqual(routing.notify, ['telegram'])
    assert.equal(routing.notifyCondition, 'always')
  })

  it('should handle empty thread channels', () => {
    const routing = determineRouting('webhook', [])
    assert.equal(routing.primary, 'webhook')
    assert.equal(routing.notify, undefined)
  })
})

// ── isSignificantEvent ────────────────────────────────────────────────

describe('isSignificantEvent', () => {
  // ── Webhook events ──────────────────────────────────────────────

  it('should consider issue opened as significant', () => {
    assert.ok(isSignificantEvent('webhook', '', { event: 'issues', action: 'opened' }))
  })

  it('should consider issue closed as significant', () => {
    assert.ok(isSignificantEvent('webhook', '', { event: 'issues', action: 'closed' }))
  })

  it('should consider PR opened as significant', () => {
    assert.ok(isSignificantEvent('webhook', '', { event: 'pull_request', action: 'opened' }))
  })

  it('should consider PR closed as significant', () => {
    assert.ok(isSignificantEvent('webhook', '', { event: 'pull_request', action: 'closed' }))
  })

  it('should consider issue comment as significant', () => {
    assert.ok(isSignificantEvent('webhook', '', { event: 'issue_comment', action: 'created' }))
  })

  it('should consider PR review comment as significant', () => {
    assert.ok(isSignificantEvent('webhook', '', { event: 'pull_request_review_comment', action: 'created' }))
  })

  it('should NOT consider push as significant', () => {
    assert.equal(isSignificantEvent('webhook', '', { event: 'push', action: undefined }), false)
  })

  it('should NOT consider issue edited as significant', () => {
    assert.equal(isSignificantEvent('webhook', '', { event: 'issues', action: 'edited' }), false)
  })

  // ── Agent response content ─────────────────────────────────────

  it('should consider text mentioning "PR #" as significant', () => {
    assert.ok(isSignificantEvent('text', 'I created PR #42 for this change'))
  })

  it('should consider text mentioning "PR created" as significant', () => {
    assert.ok(isSignificantEvent('text', 'PR created successfully'))
  })

  it('should consider text mentioning "PR merged" as significant', () => {
    assert.ok(isSignificantEvent('text', 'The PR merged into main'))
  })

  it('should consider text mentioning "issue #" as significant', () => {
    assert.ok(isSignificantEvent('text', 'Filed issue #15 for follow-up'))
  })

  it('should consider text mentioning @gigi as significant', () => {
    assert.ok(isSignificantEvent('text', 'Hey @gigi can you help?'))
  })

  it('should NOT consider generic text as significant', () => {
    assert.equal(isSignificantEvent('text', 'Hello, how are you?'), false)
  })

  it('should NOT consider empty content as significant', () => {
    assert.equal(isSignificantEvent('text', ''), false)
  })
})

// ── buildDeliveryMetadata ─────────────────────────────────────────────

describe('buildDeliveryMetadata', () => {
  it('should build metadata for single-channel delivery', () => {
    const meta = buildDeliveryMetadata('web', ['web'])
    assert.deepEqual(meta.delivered_to, ['web'])
    assert.equal(meta.cross_posted, false)
    assert.equal(meta.originating_channel, 'web')
  })

  it('should mark cross_posted when delivering to multiple channels', () => {
    const meta = buildDeliveryMetadata('webhook', ['webhook', 'telegram'])
    assert.deepEqual(meta.delivered_to, ['webhook', 'telegram'])
    assert.equal(meta.cross_posted, true)
    assert.equal(meta.originating_channel, 'webhook')
  })

  it('should mark cross_posted when delivered to different channel than originating', () => {
    const meta = buildDeliveryMetadata('webhook', ['telegram'])
    assert.equal(meta.cross_posted, true)
  })

  it('should include extra fields', () => {
    const meta = buildDeliveryMetadata('telegram', ['telegram'], { telegram_msg_id: 12345 })
    assert.equal(meta.telegram_msg_id, 12345)
    assert.equal(meta.cross_posted, false)
  })
})

// ── DEFAULT_NOTIFICATION_RULES ────────────────────────────────────────

describe('DEFAULT_NOTIFICATION_RULES', () => {
  it('should have at least one rule defined', () => {
    assert.ok(DEFAULT_NOTIFICATION_RULES.length > 0)
  })

  it('should include webhook -> telegram rule', () => {
    const rule = DEFAULT_NOTIFICATION_RULES.find(
      r => r.sourceChannels.includes('webhook') && r.targetChannels.includes('telegram')
    )
    assert.ok(rule, 'Expected a webhook -> telegram notification rule')
    assert.equal(rule.condition, 'significant')
  })

  it('should include gitea_comment -> telegram rule', () => {
    const rule = DEFAULT_NOTIFICATION_RULES.find(
      r => r.sourceChannels.includes('gitea_comment') && r.targetChannels.includes('telegram')
    )
    assert.ok(rule, 'Expected a gitea_comment -> telegram notification rule')
  })

  it('should include gitea_review -> telegram rule', () => {
    const rule = DEFAULT_NOTIFICATION_RULES.find(
      r => r.sourceChannels.includes('gitea_review') && r.targetChannels.includes('telegram')
    )
    assert.ok(rule, 'Expected a gitea_review -> telegram notification rule')
  })
})
