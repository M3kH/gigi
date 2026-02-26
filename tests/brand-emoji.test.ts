/**
 * Tests for the brand emoji (🤵🏻‍♂️) in system prompts.
 *
 * Validates that the butler emoji appears in the built system prompt output.
 * These are behavioral tests — they call buildSystemPrompt() and assert on output,
 * not source code inspection.
 *
 * Part of issue #148: Adopt 🤵🏻‍♂️ as Gigi's brand emoji.
 */

import assert from 'node:assert/strict'
import { MINIMAL_SYSTEM_PROMPT } from '../lib/core/llm-router'
import {
  buildSystemPrompt,
  resetConfigCache,
  resetProviderCache,
} from '../lib/core/prompt'

const BRAND_EMOJI = '🤵🏻‍♂️'

describe('brand emoji in system prompt', () => {
  beforeEach(() => {
    resetConfigCache()
    resetProviderCache()
  })

  it('appears in the full system prompt', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(
      prompt.includes(`You are Gigi ${BRAND_EMOJI},`),
      'full system prompt should include brand emoji after agent name'
    )
  })

  it('appears in MINIMAL_SYSTEM_PROMPT', () => {
    assert.ok(
      MINIMAL_SYSTEM_PROMPT.includes(BRAND_EMOJI),
      'minimal system prompt should include brand emoji'
    )
  })

  it('appears in Telegram notification format in prompt', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(
      prompt.includes(`${BRAND_EMOJI} PR created`),
      'system prompt Telegram example should include brand emoji'
    )
  })
})
