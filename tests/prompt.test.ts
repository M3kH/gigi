/**
 * Tests for the configurable prompt system (lib/core/prompt.ts)
 *
 * Covers: template interpolation, config loading, dynamic context providers,
 * extra prompt file loading, and system prompt building.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink, mkdir } from 'node:fs/promises'
import {
  interpolateTemplate,
  loadAgentConfig,
  buildSystemPrompt,
  resetConfigCache,
  resetProviderCache,
  fetchRepoContext,
  loadExtraPromptFile,
  resolveProviders,
  type AgentConfig,
  type ContextProvider,
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

  it('loads extra_prompt_file config option', async () => {
    await writeFile(testConfigPath, `
agent:
  name: Gigi
  extra_prompt_file: /config/dev-prompt.md
`)
    const config = loadAgentConfig(testConfigPath)
    assert.equal(config.extraPromptFile, '/config/dev-prompt.md')
  })

  it('handles empty extra_prompt_file gracefully', async () => {
    await writeFile(testConfigPath, `
agent:
  name: Gigi
`)
    const config = loadAgentConfig(testConfigPath)
    assert.equal(config.extraPromptFile, undefined)
  })
})

// ── Extra Prompt File ───────────────────────────────────────────────

describe('loadExtraPromptFile', () => {
  const testPromptFile = '/tmp/gigi-test-extra-prompt.md'

  afterEach(async () => {
    await unlink(testPromptFile).catch(() => {})
  })

  it('returns empty string when no path provided', () => {
    assert.equal(loadExtraPromptFile(undefined), '')
    assert.equal(loadExtraPromptFile(''), '')
  })

  it('returns empty string when file does not exist', () => {
    assert.equal(loadExtraPromptFile('/tmp/nonexistent-prompt.md'), '')
  })

  it('loads content from an existing file', async () => {
    await writeFile(testPromptFile, '## Dev Rules\n- Always test first\n- Use TypeScript')
    const content = loadExtraPromptFile(testPromptFile)
    assert.ok(content.includes('## Dev Rules'))
    assert.ok(content.includes('Always test first'))
  })

  it('trims whitespace from file content', async () => {
    await writeFile(testPromptFile, '\n\n  ## Section  \n\n')
    const content = loadExtraPromptFile(testPromptFile)
    assert.equal(content, '## Section')
  })
})

// ── Dynamic Context Providers ───────────────────────────────────────

describe('resolveProviders', () => {
  beforeEach(() => {
    resetProviderCache()
  })

  afterEach(() => {
    resetProviderCache()
  })

  it('resolves custom providers', async () => {
    const providers: ContextProvider[] = [
      { name: 'test_var', resolve: async () => 'test_value' },
    ]
    const result = await resolveProviders(providers)
    assert.equal(result.test_var, 'test_value')
  })

  it('handles provider failures gracefully', async () => {
    const providers: ContextProvider[] = [
      { name: 'failing', resolve: async () => { throw new Error('boom') } },
      { name: 'working', resolve: async () => 'ok' },
    ]
    const result = await resolveProviders(providers)
    assert.ok(result.failing.includes('failed'))
    assert.equal(result.working, 'ok')
  })

  it('caches provider results', async () => {
    let callCount = 0
    const providers: ContextProvider[] = [
      { name: 'counter', resolve: async () => { callCount++; return `call-${callCount}` } },
    ]
    const result1 = await resolveProviders(providers)
    const result2 = await resolveProviders(providers)
    assert.equal(result1.counter, 'call-1')
    assert.equal(result2.counter, 'call-1') // cached
    assert.equal(callCount, 1)
  })

  it('clears cache on reset', async () => {
    let callCount = 0
    const providers: ContextProvider[] = [
      { name: 'counter', resolve: async () => { callCount++; return `call-${callCount}` } },
    ]
    await resolveProviders(providers)
    resetProviderCache()
    const result2 = await resolveProviders(providers)
    assert.equal(result2.counter, 'call-2')
    assert.equal(callCount, 2)
  })
})

describe('fetchRepoContext', () => {
  it('returns fallback when GITEA_URL is not set', async () => {
    const origUrl = process.env.GITEA_URL
    const origToken = process.env.GITEA_TOKEN
    delete process.env.GITEA_URL
    delete process.env.GITEA_TOKEN

    const result = await fetchRepoContext()
    assert.ok(result.includes('not configured'))

    // Restore
    if (origUrl) process.env.GITEA_URL = origUrl
    if (origToken) process.env.GITEA_TOKEN = origToken
  })
})

// ── System Prompt Builder ───────────────────────────────────────────

describe('buildSystemPrompt', () => {
  const testPromptFile = '/tmp/gigi-test-build-prompt.md'

  beforeEach(() => {
    resetProviderCache()
  })

  afterEach(async () => {
    await unlink(testPromptFile).catch(() => {})
    resetProviderCache()
  })

  it('builds a prompt with default config', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(prompt.includes('You are Gigi, a persistent AI coordinator'))
    assert.ok(prompt.includes('owner: "idea"'))
    assert.ok(prompt.includes('Be concise, upbeat, and proactive.'))
  })

  it('replaces agent name throughout the prompt', async () => {
    const prompt = await buildSystemPrompt({
      name: 'CustomBot',
      description: 'a helpful assistant',
      org: 'myteam',
      git: { name: 'CustomBot', email: 'bot@example.com' },
    })
    assert.ok(prompt.includes('You are CustomBot, a helpful assistant'))
    assert.ok(prompt.includes('owner: "myteam"'))
    assert.ok(!prompt.includes('owner: "idea"'))
  })

  it('includes infrastructure section when provided', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
      infrastructure: '3-node ARM64 cluster running Docker Swarm',
    })
    assert.ok(prompt.includes('## Infrastructure Details'))
    assert.ok(prompt.includes('3-node ARM64 cluster running Docker Swarm'))
  })

  it('includes extra sections when provided', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
      extraSections: '## Custom Rules\n- Always use TypeScript',
    })
    assert.ok(prompt.includes('## Custom Rules'))
    assert.ok(prompt.includes('Always use TypeScript'))
  })

  it('includes extra prompt file content when configured', async () => {
    await writeFile(testPromptFile, '## Dev Internal\n- This is for internal development only')
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
      extraPromptFile: testPromptFile,
    })
    assert.ok(prompt.includes('## Dev Internal'))
    assert.ok(prompt.includes('internal development only'))
  })

  it('omits optional sections when not configured', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(!prompt.includes('## Infrastructure Details'))
    assert.ok(!prompt.includes('## Custom Rules'))
  })

  it('preserves $GITEA_URL as literal env var reference', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(prompt.includes('$GITEA_URL'))
  })

  it('includes Organization Repositories section', async () => {
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(prompt.includes('## Organization Repositories'))
  })
})
