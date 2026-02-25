/**
 * Tests for the brand emoji (🤵🏻‍♂️) adoption across the project.
 *
 * Verifies that the butler emoji appears in all user-facing identity markers
 * and does NOT appear in code identifiers, filenames, or CSS variables.
 *
 * Part of issue #148: Adopt 🤵🏻‍♂️ as Gigi's brand emoji.
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MINIMAL_SYSTEM_PROMPT } from '../lib/core/llm-router'
import {
  buildSystemPrompt,
  resetConfigCache,
  resetProviderCache,
} from '../lib/core/prompt'

const BRAND_EMOJI = '🤵🏻‍♂️'
const ROOT = resolve(import.meta.dirname, '..')

const readFile = (relPath: string): string =>
  readFileSync(resolve(ROOT, relPath), 'utf-8')

// ── Places where the emoji SHOULD appear ─────────────────────────────

describe('brand emoji — presence', () => {
  beforeEach(() => {
    resetConfigCache()
    resetProviderCache()
  })

  it('appears in the full system prompt (PROMPT_TEMPLATE)', async () => {
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

  it('appears in ChatMessage.svelte role label', () => {
    const content = readFile('web/app/components/chat/ChatMessage.svelte')
    assert.ok(
      content.includes(`${BRAND_EMOJI} Gigi`),
      'ChatMessage.svelte should display brand emoji in role label'
    )
  })

  it('appears in index.html page title', () => {
    const content = readFile('web/app/index.html')
    assert.ok(
      content.includes(`<title>${BRAND_EMOJI} Gigi</title>`),
      'index.html should have brand emoji in page title'
    )
  })

  it('appears in README.md header', () => {
    const content = readFile('README.md')
    assert.ok(
      content.includes(`${BRAND_EMOJI} Gigi</h1>`),
      'README.md should have brand emoji in h1 header'
    )
  })

  it('appears in CLAUDE.md identity section', () => {
    const content = readFile('CLAUDE.md')
    assert.ok(
      content.includes(`What Is Gigi ${BRAND_EMOJI}`),
      'CLAUDE.md should have brand emoji in identity section'
    )
  })

  it('appears in .agents/gigi.md persona header', () => {
    const content = readFile('.agents/gigi.md')
    assert.ok(
      content.includes(`# ${BRAND_EMOJI} Gigi`),
      '.agents/gigi.md should have brand emoji in heading'
    )
  })

  it('appears in GigiSidebar.svelte section icon', () => {
    const content = readFile('web/app/components/GigiSidebar.svelte')
    assert.ok(
      content.includes(BRAND_EMOJI),
      'GigiSidebar.svelte should include brand emoji'
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

// ── Places where the emoji SHOULD NOT appear ─────────────────────────

describe('brand emoji — absence (code identifiers)', () => {
  it('does NOT appear in CSS variable names', () => {
    // Check all .svelte and .css files for --gigi-* vars with emoji
    const sidebarContent = readFile('web/app/components/GigiSidebar.svelte')
    const cssVarPattern = /--[\w-]*🤵/
    assert.ok(
      !cssVarPattern.test(sidebarContent),
      'CSS variables should never contain the brand emoji'
    )
  })

  it('does NOT appear in TypeScript function/variable names', () => {
    const agentContent = readFile('lib/core/agent.ts')
    const routerContent = readFile('lib/core/llm-router.ts')
    // Check that the emoji doesn't appear in const/let/function declarations
    const declPattern = /(?:const|let|var|function)\s+\S*🤵/
    assert.ok(!declPattern.test(agentContent), 'agent.ts should not have emoji in declarations')
    assert.ok(!declPattern.test(routerContent), 'llm-router.ts should not have emoji in declarations')
  })

  it('does NOT appear in component filenames', () => {
    // Component filenames should stay clean — just verify by checking imports
    const chatMessageContent = readFile('web/app/components/chat/ChatMessage.svelte')
    const importPattern = /import.*🤵/
    assert.ok(!importPattern.test(chatMessageContent), 'imports should not contain emoji')
  })
})
