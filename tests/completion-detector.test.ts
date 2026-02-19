/**
 * Completion Detector Tests
 *
 * Tests the heuristic detection of unfinished work in agent responses.
 * Covers intent patterns, code change signals, PR link detection,
 * and the combination logic that decides whether follow-up is needed.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectUnfinishedWork } from '../lib/core/completion-detector'

// ── Responses that are clearly COMPLETE ─────────────────────────────

describe('detectUnfinishedWork — completed responses', () => {
  it('should NOT flag a response with a PR link', () => {
    const text = `Done! Here's the PR: https://prod.gigi.local/gitea/idea/gigi/pulls/28`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, false)
  })

  it('should NOT flag a response that references an existing PR number', () => {
    const text = `PR #28 is up with all the changes. The kanban linking is now issue-specific.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, false)
  })

  it('should NOT flag a short simple response', () => {
    const text = 'Sure, I can help with that.'
    const result = detectUnfinishedWork(text, false)
    assert.equal(result.hasUnfinishedWork, false)
  })

  it('should NOT flag very short responses (under 50 chars)', () => {
    const text = 'Done!'
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, false)
  })

  it('should NOT flag empty responses', () => {
    const result = detectUnfinishedWork('', false)
    assert.equal(result.hasUnfinishedWork, false)
  })

  it('should NOT flag a response that says "completed" with PR link', () => {
    const text = `All changes completed. Here's the PR: https://gitea.local/idea/gigi/pulls/5`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, false)
  })

  it('should NOT flag a response about merging', () => {
    const text = `The PR has been merged into main. All tests pass and the deployment is complete.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, false)
  })
})

// ── Responses with INTENT signals ───────────────────────────────────

describe('detectUnfinishedWork — intent signals', () => {
  it('should flag "Let me" with tool calls as unfinished', () => {
    const text = `Let me check the codebase and implement the changes. I'll start by looking at the router module and then make the necessary modifications to support the new webhook format.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
    assert.ok(result.signals.some(s => s.includes('intent')))
    assert.ok(result.followUpPrompt)
  })

  it('should flag "I will" with tool calls as unfinished', () => {
    const text = `I will create a new branch, make the changes to the webhook handler, and then open a PR for review.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
  })

  it('should flag "I\'ll" with tool calls as unfinished', () => {
    const text = `I'll fix the bug in the router and update the tests. First, let me explore the codebase to understand the current structure.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
  })

  it('should flag "I need to" with tool calls as unfinished', () => {
    const text = `Looking at the code, I need to update the webhook notifier to handle the new event types and ensure Telegram notifications are sent properly.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
  })

  it('should NOT flag intent signals WITHOUT tool calls (just chatting)', () => {
    const text = `I will need more information to help with this. Let me know what specific feature you want.`
    const result = detectUnfinishedWork(text, false)
    assert.equal(result.hasUnfinishedWork, false)
  })
})

// ── Responses with CODE CHANGE signals ──────────────────────────────

describe('detectUnfinishedWork — code change signals', () => {
  it('should flag "git commit" without PR link as unfinished', () => {
    const text = `I've made the changes and ran git commit -m "fix: update webhook handler". The changes are on the feat/webhook-fix branch.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
    assert.ok(result.signals.some(s => s.includes('code_change')))
  })

  it('should flag "pushed to" without PR link as unfinished', () => {
    const text = `The changes have been committed and pushed to the remote branch. I've updated the notifier to handle all comment types.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
  })

  it('should flag branch name without PR link', () => {
    const text = `I created the feat/gitea-integration branch with the necessary changes to support issue-specific chat linking in the kanban board.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
  })

  it('should NOT flag code changes WITH a PR link', () => {
    const text = `I've committed the changes and pushed to feat/webhook-fix. Created PR: https://gitea.local/idea/gigi/pulls/29`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, false)
  })
})

// ── PR mention without link ─────────────────────────────────────────

describe('detectUnfinishedWork — PR without link', () => {
  it('should flag "create a PR" without a link', () => {
    const text = `I need to create a PR for these changes. The code is ready on the feature branch and all tests pass.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
    assert.ok(result.signals.includes('pr_mentioned_no_link'))
  })

  it('should flag "open a pull request" without a link', () => {
    const text = `Next step is to open a pull request with the changes. I'll include a description of the modifications.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, true)
  })

  it('should NOT flag PR mention when link is present', () => {
    const text = `I created a PR for these changes: https://gitea.local/idea/gigi/pulls/30. It includes the webhook notifier fix.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.hasUnfinishedWork, false)
  })
})

// ── Follow-up prompts ───────────────────────────────────────────────

describe('detectUnfinishedWork — follow-up prompts', () => {
  it('should return code-specific follow-up for code changes without PR', () => {
    const text = `Committed the changes and pushed to origin feat/my-fix. All files updated.`
    const result = detectUnfinishedWork(text, true)
    assert.ok(result.followUpPrompt)
    assert.ok(result.followUpPrompt!.includes('PR'))
    assert.ok(result.followUpPrompt!.includes('gitea tool'))
  })

  it('should return generic follow-up for intent-only signals', () => {
    const text = `Let me start by exploring the codebase and understanding the architecture before making changes.`
    const result = detectUnfinishedWork(text, true)
    assert.ok(result.followUpPrompt)
    assert.ok(result.followUpPrompt!.includes('continue'))
  })

  it('should return null follow-up for complete work', () => {
    const text = `All done! PR #42 has been created.`
    const result = detectUnfinishedWork(text, true)
    assert.equal(result.followUpPrompt, null)
  })
})

// ── Signal tracking ─────────────────────────────────────────────────

describe('detectUnfinishedWork — signal tracking', () => {
  it('should track multiple signals', () => {
    const text = `Let me commit the changes. I'll push to the feat/fix branch and then create a PR for review.`
    const result = detectUnfinishedWork(text, true)
    assert.ok(result.signals.length >= 2, `Expected >= 2 signals, got ${result.signals.length}: ${result.signals.join(', ')}`)
  })

  it('should return empty signals for clean responses', () => {
    const text = 'Hello Mauro!'
    const result = detectUnfinishedWork(text, false)
    assert.deepEqual(result.signals, [])
  })
})
