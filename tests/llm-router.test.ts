/**
 * LLM Router Tests
 *
 * Tests message classification and routing decisions.
 * Ensures that simple messages get routed to Haiku and
 * complex messages get routed to Opus.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMessage, MINIMAL_SYSTEM_PROMPT } from '../lib/core/llm-router'

// ─── Simple Messages ─────────────────────────────────────────────────

describe('classifyMessage — simple messages', () => {
  it('should classify greetings as simple', () => {
    const greetings = ['hi', 'hello', 'hey', 'ciao', 'good morning', 'yo']
    for (const msg of greetings) {
      const result = classifyMessage(msg)
      assert.equal(result.complexity, 'simple', `"${msg}" should be simple, got ${result.complexity}`)
      assert.equal(result.model, 'claude-haiku-4-5', `"${msg}" should use haiku`)
      assert.equal(result.includeTools, false, `"${msg}" should not include tools`)
      assert.equal(result.useMinimalPrompt, true, `"${msg}" should use minimal prompt`)
    }
  })

  it('should classify thanks as simple', () => {
    const thanks = ['thanks', 'thank you', 'ty', 'got it', 'cool', 'awesome']
    for (const msg of thanks) {
      const result = classifyMessage(msg)
      assert.equal(result.complexity, 'simple', `"${msg}" should be simple, got ${result.complexity}: ${result.reason}`)
      assert.equal(result.model, 'claude-haiku-4-5')
    }
  })

  it('should classify short affirmatives as simple', () => {
    const msgs = ['yes', 'no', 'yep', 'nope', 'sure', 'yeah']
    for (const msg of msgs) {
      const result = classifyMessage(msg)
      assert.equal(result.complexity, 'simple', `"${msg}" should be simple, got ${result.complexity}: ${result.reason}`)
    }
  })

  it('should set maxTurns to 1 for simple messages', () => {
    const result = classifyMessage('hello')
    assert.equal(result.maxTurns, 1)
  })
})

// ─── Complex Messages ────────────────────────────────────────────────

describe('classifyMessage — complex messages', () => {
  it('should classify implementation requests as complex', () => {
    const msgs = [
      'implement a new feature for user auth',
      'create a PR for the bugfix',
      'fix the broken test',
      'refactor the router module',
      'update the dashboard component',
      'add a new endpoint for analytics',
    ]
    for (const msg of msgs) {
      const result = classifyMessage(msg)
      assert.equal(result.complexity, 'complex', `"${msg}" should be complex, got ${result.complexity}: ${result.reason}`)
      assert.equal(result.model, 'claude-opus-4-6', `"${msg}" should use opus`)
      assert.equal(result.includeTools, true, `"${msg}" should include tools`)
    }
  })

  it('should classify /issue commands as complex via default fallback', () => {
    // /issue itself matches COMPLEX_PATTERNS
    const result = classifyMessage('/issue gigi#21 Start working on it')
    assert.equal(result.complexity, 'complex')
    assert.equal(result.model, 'claude-opus-4-6')
  })

  it('should classify analysis requests as complex', () => {
    const msgs = [
      'analyze the performance of the dashboard',
      'review the PR changes',
      'debug the login flow issue',
      'investigate why the tests fail',
    ]
    for (const msg of msgs) {
      const result = classifyMessage(msg)
      assert.equal(result.complexity, 'complex', `"${msg}" should be complex, got ${result.complexity}: ${result.reason}`)
    }
  })

  it('should set maxTurns to 50 for complex messages', () => {
    const result = classifyMessage('implement a new feature')
    assert.equal(result.maxTurns, 50)
  })

  it('should classify system/enforcer messages as complex', () => {
    const result = classifyMessage('[ENFORCER] PR not created yet')
    assert.equal(result.complexity, 'complex')
    assert.equal(result.model, 'claude-opus-4-6')
  })
})

// ─── Tool-Simple Messages ────────────────────────────────────────────

describe('classifyMessage — tool-simple messages', () => {
  it('should classify status checks as tool-simple', () => {
    const msgs = [
      'what is the status of issue #5',
      'status of pr #12',
      "what's the state for issue gigi#3",
    ]
    for (const msg of msgs) {
      const result = classifyMessage(msg)
      assert.equal(result.complexity, 'tool-simple', `"${msg}" should be tool-simple, got ${result.complexity}: ${result.reason}`)
      assert.equal(result.model, 'claude-haiku-4-5')
      assert.equal(result.includeTools, true, 'tool-simple should include tools')
      assert.equal(result.maxTurns, 5, 'tool-simple should have limited turns')
    }
  })

  it('should classify list requests as tool-simple', () => {
    const msgs = [
      'list all open issues',
      'show open PRs',
      'get all repos',
    ]
    for (const msg of msgs) {
      const result = classifyMessage(msg)
      assert.equal(result.complexity, 'tool-simple', `"${msg}" should be tool-simple, got ${result.complexity}: ${result.reason}`)
    }
  })
})

// ─── Edge Cases ──────────────────────────────────────────────────────

describe('classifyMessage — edge cases', () => {
  it('should default long unknown messages to complex', () => {
    const result = classifyMessage('I have this really detailed question about the architecture and how we should handle the data flow between the frontend and backend services')
    assert.equal(result.complexity, 'complex')
  })

  it('should handle empty strings gracefully', () => {
    const result = classifyMessage('')
    // Empty string is very short, no session → simple
    assert.ok(['simple', 'complex'].includes(result.complexity))
  })

  it('should classify very short unknown messages without session as simple', () => {
    const result = classifyMessage('hmm', false)
    assert.equal(result.complexity, 'simple', `"hmm" without session should be simple`)
  })

  it('should prefer complex patterns over simple patterns', () => {
    // "ok fix the bug" — "ok" matches simple, but "fix" matches complex
    const result = classifyMessage('ok fix the bug')
    assert.equal(result.complexity, 'complex', 'complex pattern should win over simple')
  })
})

// ─── MINIMAL_SYSTEM_PROMPT ───────────────────────────────────────────

describe('MINIMAL_SYSTEM_PROMPT', () => {
  it('should be significantly shorter than the typical full prompt', () => {
    assert.ok(MINIMAL_SYSTEM_PROMPT.length < 500, `minimal prompt should be < 500 chars, got ${MINIMAL_SYSTEM_PROMPT.length}`)
  })

  it('should contain Gigi identity', () => {
    assert.ok(MINIMAL_SYSTEM_PROMPT.includes('Gigi'))
    assert.ok(MINIMAL_SYSTEM_PROMPT.includes('Mauro'))
  })
})
