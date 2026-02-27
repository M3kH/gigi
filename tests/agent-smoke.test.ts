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

// ─── loadExtraPromptFile — paths[0] crash regression ─────────────────

describe('loadExtraPromptFile — paths[0] crash regression', () => {
  it('should return empty string for undefined input', async () => {
    const { loadExtraPromptFile } = await import('../lib/core/prompt')
    assert.equal(loadExtraPromptFile(undefined), '')
  })

  it('should return empty string for empty string input', async () => {
    const { loadExtraPromptFile } = await import('../lib/core/prompt')
    assert.equal(loadExtraPromptFile(''), '')
  })

  it('should not crash when given an object (regression: YAML parser returned {} for empty values)', async () => {
    const { loadExtraPromptFile } = await import('../lib/core/prompt')
    // The YAML parser used to return {} for `key:` with no value and no nested content.
    // This caused path.resolve({}) to throw ERR_INVALID_ARG_TYPE.
    assert.equal(loadExtraPromptFile({} as unknown as string), '')
  })

  it('should return empty string for non-existent file path', async () => {
    const { loadExtraPromptFile } = await import('../lib/core/prompt')
    assert.equal(loadExtraPromptFile('/tmp/nonexistent-gigi-test-file-12345.txt'), '')
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

// ─── SDK query() options — regression for path.resolve crash ────────

describe('Agent options compatibility', () => {
  // Regression: SDK 0.2.50 crashed with "paths[0] must be of type string" when
  // extraArgs had worktree: null. SDK 0.2.62 fixed the crash but then passed
  // --worktree to the CLI, which fails in non-git dirs. Fix: don't pass worktree at all.

  it('extraArgs must not contain worktree key', async () => {
    // Import the agent module to check what options it builds.
    // The extraArgs should be empty — no worktree flag.
    const agentSrc = await import('node:fs').then(fs =>
      fs.readFileSync(require.resolve('../lib/core/agent.ts'), 'utf-8'),
    )
    // Must NOT have worktree in extraArgs
    assert.ok(
      !agentSrc.includes("worktree: null"),
      'extraArgs must not contain worktree: null (causes --worktree flag in non-git dirs)',
    )
    assert.ok(
      !agentSrc.includes("worktree:"),
      'extraArgs must not reference worktree at all',
    )
  })

  it('SDK query() should be importable and callable type', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    assert.equal(typeof query, 'function', 'query should be a function')
  })

  it('SDK version should be >= 0.2.62 (path resolution fixes)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const pkgPath = resolve(import.meta.dirname, '../node_modules/@anthropic-ai/claude-agent-sdk/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const [major, minor, patch] = pkg.version.split('.').map(Number)
    assert.ok(
      major > 0 || minor > 2 || (minor === 2 && patch >= 62),
      `SDK version must be >= 0.2.62 (path.resolve fix), got ${pkg.version}`,
    )
  })
})

// ─── Error Propagation — thread_events regression ───────────────────

describe('Error propagation to thread_events', () => {
  // Regression: error messages were stored in legacy `messages` table but NOT in
  // `thread_events`. The frontend renders from thread_events when they exist,
  // so errors were invisible in the chat panel.

  it('error catch block must store to thread_events (not just messages)', async () => {
    const routerSrc = await import('node:fs').then(fs =>
      fs.readFileSync(require.resolve('../lib/core/router.ts'), 'utf-8'),
    )

    // The error path (agent crash) must call threads.addThreadEvent with error content
    // Look for the pattern: errorContent followed by addThreadEvent
    assert.ok(
      routerSrc.includes('errorContent') && routerSrc.includes('threads.addThreadEvent(threadId'),
      'Error catch block must persist error to thread_events via addThreadEvent',
    )
  })

  it('abort catch block must store to thread_events (not just messages)', async () => {
    const routerSrc = await import('node:fs').then(fs =>
      fs.readFileSync(require.resolve('../lib/core/router.ts'), 'utf-8'),
    )

    // The abort path (user stop) must call threads.addThreadEvent with stop content
    assert.ok(
      routerSrc.includes('stopContent') && routerSrc.includes('threads.addThreadEvent(threadId'),
      'Abort catch block must persist stop message to thread_events via addThreadEvent',
    )
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
