/**
 * Tests for the configurable prompt system (lib/core/prompt.ts)
 *
 * Covers: template interpolation, config loading, system prompt building.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink } from 'node:fs/promises'
import {
  interpolateTemplate,
  loadAgentConfig,
  buildSystemPrompt,
  resetConfigCache,
  type AgentConfig,
} from '../lib/core/prompt'

// ── Template Interpolation ──────────────────────────────────────────

describe('interpolateTemplate', () => {
  it('replaces {{key}} with value', () => {
    const result = interpolateTemplate('Hello, {{name}}!', { name: 'Gigi' })
    assert.equal(result, 'Hello, Gigi!')
  })

  it('replaces multiple placeholders', () => {
    const result = interpolateTemplate(
      '{{name}} is {{description}}',
      { name: 'Gigi', description: 'an AI coordinator' }
    )
    assert.equal(result, 'Gigi is an AI coordinator')
  })

  it('leaves unknown placeholders unchanged', () => {
    const result = interpolateTemplate('Hello, {{unknown}}!', { name: 'Gigi' })
    assert.equal(result, 'Hello, {{unknown}}!')
  })

  it('handles empty vars object', () => {
    const result = interpolateTemplate('Hello, {{name}}!', {})
    assert.equal(result, 'Hello, {{name}}!')
  })

  it('handles template with no placeholders', () => {
    const result = interpolateTemplate('No placeholders here', { name: 'Gigi' })
    assert.equal(result, 'No placeholders here')
  })

  it('replaces same placeholder multiple times', () => {
    const result = interpolateTemplate('{{org}}/repo under {{org}}', { org: 'idea' })
    assert.equal(result, 'idea/repo under idea')
  })
})

// ── Config Loading ──────────────────────────────────────────────────

describe('loadAgentConfig', () => {
  const testConfigPath = '/tmp/gigi-test-prompt-config.yaml'

  beforeEach(() => {
    resetConfigCache()
  })

  afterEach(async () => {
    await unlink(testConfigPath).catch(() => {})
    resetConfigCache()
  })

  it('returns defaults when no config file exists', () => {
    const config = loadAgentConfig('/tmp/nonexistent-gigi-config.yaml')
    assert.equal(config.name, 'Gigi')
    assert.equal(config.description, 'a persistent AI coordinator')
    assert.equal(config.git.name, 'Gigi')
    assert.equal(config.git.email, 'gigi@localhost')
  })

  it('returns defaults when config has no agent section', async () => {
    await writeFile(testConfigPath, `
backup:
  sources:
    - org: idea
`)
    const config = loadAgentConfig(testConfigPath)
    assert.equal(config.name, 'Gigi')
    assert.equal(config.description, 'a persistent AI coordinator')
  })

  it('loads custom agent name and description', async () => {
    await writeFile(testConfigPath, `
agent:
  name: CustomBot
  description: a custom AI assistant
  org: myorg
  git:
    name: CustomBot
    email: bot@example.com
`)
    const config = loadAgentConfig(testConfigPath)
    assert.equal(config.name, 'CustomBot')
    assert.equal(config.description, 'a custom AI assistant')
    assert.equal(config.org, 'myorg')
    assert.equal(config.git.name, 'CustomBot')
    assert.equal(config.git.email, 'bot@example.com')
  })

  it('uses defaults for missing fields in agent section', async () => {
    await writeFile(testConfigPath, `
agent:
  name: Hal
`)
    const config = loadAgentConfig(testConfigPath)
    assert.equal(config.name, 'Hal')
    assert.equal(config.description, 'a persistent AI coordinator')
    assert.equal(config.git.name, 'Gigi')
    assert.equal(config.git.email, 'gigi@localhost')
  })

  it('interpolates env vars in config', async () => {
    process.env.TEST_AGENT_NAME = 'EnvBot'
    await writeFile(testConfigPath, `
agent:
  name: \${TEST_AGENT_NAME}
`)
    const config = loadAgentConfig(testConfigPath)
    assert.equal(config.name, 'EnvBot')
    delete process.env.TEST_AGENT_NAME
  })

  it('caches config on repeated loads (no path override)', async () => {
    // First load with specific path sets cache
    await writeFile(testConfigPath, `
agent:
  name: CachedBot
`)
    const config1 = loadAgentConfig(testConfigPath)
    assert.equal(config1.name, 'CachedBot')

    // Reset so next call uses default paths (won't find anything)
    resetConfigCache()
    const config2 = loadAgentConfig('/tmp/nonexistent-config.yaml')
    assert.equal(config2.name, 'Gigi') // defaults because file doesn't exist
  })
})

// ── System Prompt Builder ───────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('builds a prompt with default config', () => {
    const prompt = buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(prompt.includes('You are Gigi, a persistent AI coordinator'))
    assert.ok(prompt.includes('owner: "idea"'))
    assert.ok(prompt.includes('Be concise, upbeat, and proactive.'))
  })

  it('replaces agent name throughout the prompt', () => {
    const prompt = buildSystemPrompt({
      name: 'CustomBot',
      description: 'a helpful assistant',
      org: 'myteam',
      git: { name: 'CustomBot', email: 'bot@example.com' },
    })
    assert.ok(prompt.includes('You are CustomBot, a helpful assistant'))
    assert.ok(prompt.includes('owner: "myteam"'))
    // Should not contain hardcoded values
    assert.ok(!prompt.includes('owner: "idea"'))
  })

  it('includes infrastructure section when provided', () => {
    const prompt = buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
      infrastructure: '3-node ARM64 cluster running Docker Swarm',
    })
    assert.ok(prompt.includes('## Infrastructure Details'))
    assert.ok(prompt.includes('3-node ARM64 cluster running Docker Swarm'))
  })

  it('includes extra sections when provided', () => {
    const prompt = buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
      extraSections: '## Custom Rules\n- Always use TypeScript',
    })
    assert.ok(prompt.includes('## Custom Rules'))
    assert.ok(prompt.includes('Always use TypeScript'))
  })

  it('omits optional sections when not configured', () => {
    const prompt = buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(!prompt.includes('## Infrastructure Details'))
    assert.ok(!prompt.includes('## Custom Rules'))
  })

  it('preserves $GITEA_URL as literal env var reference', () => {
    const prompt = buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    // $GITEA_URL should remain as-is for runtime env var resolution
    assert.ok(prompt.includes('$GITEA_URL'))
  })
})
