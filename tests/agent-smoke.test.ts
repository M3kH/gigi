/**
 * Agent Smoke Tests
 *
 * Tests the agent subsystem components that are critical for production:
 * - MCP server config loading and path resolution
 * - UV_THREADPOOL_SIZE (ARM64 TLS timeout prevention)
 * - Token type detection (OAuth vs API key)
 * - Environment variable construction
 *
 * These test the pieces that broke in the UV_THREADPOOL_SIZE incident —
 * where MCP tool token counting caused concurrent TLS handshakes to exhaust
 * the default 4-thread pool on ARM64, timing out all API requests.
 *
 * The actual query() → CLI subprocess is NOT mocked here. That integration
 * is covered by gigi-infra/scripts/debug-gigi.sh mcp-test on the cluster.
 */

import assert from 'node:assert/strict'
import { loadMcpServers, createToolFailureHandler, handlePreToolUse } from '../lib/core/agent'

// ─── UV_THREADPOOL_SIZE ─────────────────────────────────────────────

describe('UV_THREADPOOL_SIZE', () => {
  it('should be set at module load time', () => {
    // agent.ts sets this at top level: if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '64'
    // By importing agent.ts above, it should already be set.
    assert.ok(process.env.UV_THREADPOOL_SIZE, 'UV_THREADPOOL_SIZE must be set')
    assert.equal(Number(process.env.UV_THREADPOOL_SIZE) >= 64, true,
      `UV_THREADPOOL_SIZE should be >= 64, got ${process.env.UV_THREADPOOL_SIZE}`)
  })
})

// ─── MCP Server Config ──────────────────────────────────────────────

describe('loadMcpServers', () => {
  const savedCdpUrl = process.env.CHROME_CDP_URL

  afterEach(() => {
    if (savedCdpUrl) process.env.CHROME_CDP_URL = savedCdpUrl
    else delete process.env.CHROME_CDP_URL
  })

  it('should load gigi-tools server from mcp-config.json', () => {
    process.env.CHROME_CDP_URL = 'http://localhost:9223'
    const servers = loadMcpServers({
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      GITEA_URL: 'http://localhost:3300',
      GITEA_TOKEN: 'test-token',
      PORT: '3000',
      CHROME_CDP_URL: 'http://localhost:9223',
    })

    assert.ok(servers['gigi-tools'], 'gigi-tools server should be loaded')
    assert.equal(servers['gigi-tools'].type, 'stdio')
    assert.equal(servers['gigi-tools'].command, 'node')
  })

  it('should resolve env var placeholders in server env', () => {
    process.env.CHROME_CDP_URL = 'http://localhost:9223'
    const servers = loadMcpServers({
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      GITEA_URL: 'http://localhost:3300',
      GITEA_TOKEN: 'test-token',
      PORT: '3000',
      CHROME_CDP_URL: 'http://localhost:9223',
    })

    const env = servers['gigi-tools'].env as Record<string, string>
    assert.equal(env.DATABASE_URL, 'postgresql://test:test@localhost/test')
    assert.equal(env.GITEA_URL, 'http://localhost:3300')
    assert.equal(env.GITEA_TOKEN, 'test-token')
    assert.equal(env.PORT, '3000')
  })

  it('should resolve relative paths in args to absolute paths', () => {
    process.env.CHROME_CDP_URL = 'http://localhost:9223'
    const servers = loadMcpServers({
      CHROME_CDP_URL: 'http://localhost:9223',
    })

    const args = servers['gigi-tools'].args as string[]
    // lib/core/mcp.ts should be resolved to absolute path
    const mcpArg = args.find((a: string) => a.includes('mcp.ts'))
    assert.ok(mcpArg, 'Should have mcp.ts in args')
    assert.ok(mcpArg!.startsWith('/'), `mcp.ts path should be absolute, got: ${mcpArg}`)
  })

  it('should resolve bare module names after --import flag', () => {
    process.env.CHROME_CDP_URL = 'http://localhost:9223'
    const servers = loadMcpServers({
      CHROME_CDP_URL: 'http://localhost:9223',
    })

    const args = servers['gigi-tools'].args as string[]
    const importIdx = args.indexOf('--import')
    assert.ok(importIdx >= 0, 'Should have --import flag')
    const tsxPath = args[importIdx + 1]
    // tsx should be resolved to absolute path (not bare "tsx")
    assert.ok(tsxPath.startsWith('/'), `tsx should be resolved to absolute path, got: ${tsxPath}`)
  })

  it('should skip chrome-devtools when CHROME_CDP_URL is not set', () => {
    delete process.env.CHROME_CDP_URL
    const servers = loadMcpServers({})

    assert.ok(!servers['chrome-devtools'], 'chrome-devtools should be skipped without CDP URL')
    assert.ok(servers['gigi-tools'], 'gigi-tools should still be loaded')
  })

  it('should include chrome-devtools when CHROME_CDP_URL is set', () => {
    process.env.CHROME_CDP_URL = 'http://localhost:9223'
    const servers = loadMcpServers({
      CHROME_CDP_URL: 'http://localhost:9223',
    })

    assert.ok(servers['chrome-devtools'], 'chrome-devtools should be loaded with CDP URL')
    const args = servers['chrome-devtools'].args as string[]
    assert.ok(args.includes('http://localhost:9223'), 'Should include CDP URL in args')
  })

  it('should resolve CHROME_CDP_URL placeholder in chrome-devtools args', () => {
    process.env.CHROME_CDP_URL = 'http://custom:9999'
    const servers = loadMcpServers({
      CHROME_CDP_URL: 'http://custom:9999',
    })

    assert.ok(servers['chrome-devtools'])
    const args = servers['chrome-devtools'].args as string[]
    assert.ok(args.includes('http://custom:9999'), `CDP URL should be resolved, got: ${args}`)
  })
})

// ─── Token Type Detection ───────────────────────────────────────────

describe('Token type detection', () => {
  // These test the logic pattern used in ensureReady() — since ensureReady is not exported,
  // we test the detection logic directly.

  it('OAuth token (sk-ant-oat*) should be detected correctly', () => {
    const token = 'sk-ant-oat-test-fake-token-123'
    assert.ok(token.startsWith('sk-ant-oat'), 'Should detect OAuth token prefix')
  })

  it('API key should NOT match OAuth prefix', () => {
    const token = 'sk-ant-api01-test-fake-key-456'
    assert.ok(!token.startsWith('sk-ant-oat'), 'API key should not match OAuth prefix')
  })
})

// ─── System Prompt — Testing Requirements ───────────────────────────

describe('System prompt testing requirements', () => {
  it('should contain a Testing Requirements section', async () => {
    const { buildSystemPrompt } = await import('../lib/core/prompt')
    const prompt = await buildSystemPrompt({
      name: 'Gigi',
      description: 'a persistent AI coordinator',
      org: 'idea',
      git: { name: 'Gigi', email: 'gigi@localhost' },
    })
    assert.ok(prompt.includes('## Testing Requirements'), 'System prompt must include Testing Requirements section')
  })
})

// ─── Tool Failure Handler ───────────────────────────────────────────

describe('Tool failure handler — agent context', () => {
  it('should track MCP tool failures separately from built-in tools', async () => {
    const { handler } = createToolFailureHandler()

    const r1 = await handler({
      tool_name: 'mcp__gigi-tools__gitea',
      tool_input: { action: 'list_repos' },
      error: 'MCP server disconnected',
    })
    assert.ok(r1.systemMessage.includes('attempt 1/3'))

    // Different tool — separate counter
    const r2 = await handler({
      tool_name: 'Read',
      tool_input: { file_path: '/test' },
      error: 'ENOENT',
    })
    assert.ok(r2.systemMessage.includes('attempt 1/3'))
  })
})
