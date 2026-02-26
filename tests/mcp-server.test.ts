/**
 * MCP Server Integration Test
 *
 * Spawns the MCP server as a child process (like Claude Code SDK does)
 * and verifies:
 * 1. Server starts and completes MCP handshake
 * 2. All expected tools are listed
 * 3. Each tool's input schema is valid
 * 4. Each tool is callable (accepts valid input, rejects invalid input)
 */


import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { loadMcpServers } from '../lib/core/agent'

// ─── MCP Client Helper ──────────────────────────────────────────────

const APP_DIR = resolve(import.meta.dirname, '..')

// Set env vars that loadMcpServers needs (before import)
process.env.GITEA_URL = process.env.GITEA_URL || 'http://localhost:3300'
process.env.GITEA_TOKEN = process.env.GITEA_TOKEN || ''
process.env.PORT = process.env.PORT || '3000'

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

class MCPTestClient {
  private proc: ChildProcessWithoutNullStreams
  private buffer = ''
  private pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>()
  private nextId = 0
  private stderr = ''

  constructor() {
    this.proc = spawn('node', ['--import', 'tsx', resolve(APP_DIR, 'lib/core/mcp.ts')], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://gigi:gigi@localhost:5432/gigi',
        GITEA_URL: 'http://localhost:3300',
        GITEA_TOKEN: '',
        PORT: '19876', // Use a port nothing listens on — ask_user will fail fast with ECONNREFUSED
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      this.processBuffer()
    })

    this.proc.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString()
    })
  }

  private processBuffer() {
    // MCP uses Content-Length framing: "Content-Length: N\r\n\r\n{json}"
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const header = this.buffer.slice(0, headerEnd)
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        // Skip malformed header
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(match[1], 10)
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + contentLength) break // Wait for more data

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength)
      this.buffer = this.buffer.slice(bodyStart + contentLength)

      try {
        const msg = JSON.parse(body) as JsonRpcResponse
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!.resolve(msg)
          this.pending.delete(msg.id)
        }
      } catch {
        // Ignore non-JSON
      }
    }
  }

  private writeMessage(msg: object) {
    const body = JSON.stringify(msg)
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
    this.proc.stdin.write(header + body)
  }

  async send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++
    const msg = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout waiting for response to ${method} (id: ${id})\nstderr: ${this.stderr}`))
      }, 10_000)

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      this.writeMessage(msg)
    })
  }

  notify(method: string, params?: unknown) {
    const msg = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }
    this.writeMessage(msg)
  }

  getStderr(): string {
    return this.stderr
  }

  kill() {
    this.proc.kill()
  }
}

// ─── Expected Tools ──────────────────────────────────────────────────

const EXPECTED_TOOLS = ['gitea', 'telegram_send', 'browser', 'ask_user']

// ─── Tests ──────────────────────────────────────────────────────────

// MCP Server integration tests require spawning the MCP server process.
// The server imports playwright (via browser-manager) at module level, which
// hangs when browser binaries aren't installed (e.g. ARM64 dev / CI without
// playwright install step). Skip until playwright is lazy-loaded.
describe.skip('MCP Server', () => {
  let client: MCPTestClient

  afterAll(() => {
    client?.kill()
  })

  it('should start and complete MCP handshake', async () => {
    client = new MCPTestClient()

    const initResponse = await client.send('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-runner', version: '1.0.0' },
    })

    assert.ok(initResponse.result, `Initialize failed: ${JSON.stringify(initResponse.error)}`)

    const result = initResponse.result as {
      protocolVersion: string
      serverInfo: { name: string; version: string }
      capabilities: { tools: Record<string, unknown> }
    }

    assert.equal(result.serverInfo.name, 'gigi-tools')
    assert.ok(result.capabilities.tools, 'Server should advertise tools capability')

    // Send initialized notification
    client.notify('notifications/initialized')
  })

  it('should list all expected tools', async () => {
    const listResponse = await client.send('tools/list')
    assert.ok(listResponse.result, `tools/list failed: ${JSON.stringify(listResponse.error)}`)

    const tools = (listResponse.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }).tools
    const toolNames = tools.map(t => t.name).sort()

    assert.deepEqual(toolNames, [...EXPECTED_TOOLS].sort(),
      `Expected tools: ${EXPECTED_TOOLS.sort().join(', ')}\nGot: ${toolNames.join(', ')}`)

    // Every tool must have a description and inputSchema
    for (const tool of tools) {
      assert.ok(tool.description, `Tool "${tool.name}" missing description`)
      assert.ok(tool.inputSchema, `Tool "${tool.name}" missing inputSchema`)
      assert.equal(
        (tool.inputSchema as { type: string }).type, 'object',
        `Tool "${tool.name}" inputSchema should be type: object`
      )
    }
  })

  it('gitea tool should accept valid input', async () => {
    const response = await client.send('tools/call', {
      name: 'gitea',
      arguments: { action: 'list_repos' },
    })

    // Will fail to connect to Gitea in test, but should not crash
    assert.ok(response.result, 'gitea tool should return a result')
    const content = (response.result as { content: Array<{ text: string }> }).content
    assert.ok(content.length > 0, 'Should have content')
  })

  it('gitea tool should reject invalid input', async () => {
    const response = await client.send('tools/call', {
      name: 'gitea',
      arguments: { action: 'nonexistent_action' },
    })

    const content = (response.result as { content: Array<{ text: string }>; isError?: boolean }).content
    assert.ok(content[0].text.includes('Invalid input'), `Expected validation error, got: ${content[0].text}`)
  })

  it('ask_user tool should accept valid input', async () => {
    const response = await client.send('tools/call', {
      name: 'ask_user',
      arguments: { question: 'Test question?', options: ['A', 'B'] },
    })

    // Will fail to connect to main process, but should not crash
    assert.ok(response.result, 'ask_user tool should return a result')
    const content = (response.result as { content: Array<{ text: string }> }).content
    assert.ok(content.length > 0, 'Should have content')
    // The tool will fail to connect to localhost:3000 but should return a graceful error
    assert.ok(content[0].text.includes('Failed to ask user') || content[0].text.length > 0,
      `Unexpected response: ${content[0].text}`)
  })

  it('ask_user tool should reject missing question', async () => {
    const response = await client.send('tools/call', {
      name: 'ask_user',
      arguments: {},
    })

    const result = response.result as { content: Array<{ text: string }>; isError?: boolean }
    assert.ok(result.isError || result.content[0].text.includes('Invalid input'),
      `Expected validation error, got: ${result.content[0].text}`)
  })

  it('telegram_send tool should accept valid input', async () => {
    const response = await client.send('tools/call', {
      name: 'telegram_send',
      arguments: { text: 'test message' },
    })

    // Will fail (no bot configured) but should not crash
    assert.ok(response.result, 'telegram_send tool should return a result')
  })

  it('browser tool should accept valid input', async () => {
    const response = await client.send('tools/call', {
      name: 'browser',
      arguments: { action: 'status' },
    })

    assert.ok(response.result, 'browser tool should return a result')
  })

  it('should return error for unknown tool', async () => {
    const response = await client.send('tools/call', {
      name: 'nonexistent_tool',
      arguments: {},
    })

    const result = response.result as { content: Array<{ text: string }>; isError?: boolean }
    assert.ok(result.isError, 'Should be an error')
    assert.ok(result.content[0].text.includes('Unknown tool'), `Expected unknown tool error, got: ${result.content[0].text}`)
  })
})

// ─── loadMcpServers Config Validation ───────────────────────────────
//
// Verifies that loadMcpServers() produces a config that actually works
// when used to spawn the MCP server. This catches config mismatches
// between what we generate and what the Claude Code SDK would receive.

describe('loadMcpServers — env resolution', () => {
  it('resolvedEnv overrides process.env for ${VAR} placeholders', () => {
    // Save originals
    const origToken = process.env.GITEA_TOKEN
    const origUrl = process.env.GITEA_URL

    try {
      // Simulate the real scenario: dev.sh doesn't export GITEA_TOKEN
      process.env.GITEA_TOKEN = ''
      process.env.GITEA_URL = 'http://localhost:3300'

      // Without resolvedEnv — token stays empty
      const withoutEnv = loadMcpServers()
      const envWithout = (withoutEnv['gigi-tools'].env as Record<string, string>)
      assert.equal(envWithout.GITEA_TOKEN, '', 'Without resolvedEnv, token should be empty')

      // With resolvedEnv — token gets resolved from DB values
      const dbValues = {
        GITEA_TOKEN: 'secret-token-from-db',
        GITEA_URL: 'http://gitea:3000',
      }
      const withEnv = loadMcpServers(dbValues)
      const envWith = (withEnv['gigi-tools'].env as Record<string, string>)
      assert.equal(envWith.GITEA_TOKEN, 'secret-token-from-db',
        'With resolvedEnv, token should come from DB')
      assert.equal(envWith.GITEA_URL, 'http://gitea:3000',
        'With resolvedEnv, URL should come from DB')
    } finally {
      // Restore
      if (origToken !== undefined) process.env.GITEA_TOKEN = origToken
      else delete process.env.GITEA_TOKEN
      if (origUrl !== undefined) process.env.GITEA_URL = origUrl
      else delete process.env.GITEA_URL
    }
  })

  it('resolvedEnv does not clobber process.env when not provided', () => {
    const origPort = process.env.PORT
    try {
      process.env.PORT = '4567'
      const servers = loadMcpServers()
      const env = (servers['gigi-tools'].env as Record<string, string>)
      assert.equal(env.PORT, '4567', 'PORT should come from process.env')
    } finally {
      if (origPort !== undefined) process.env.PORT = origPort
      else delete process.env.PORT
    }
  })

  it('resolvedEnv takes precedence over process.env', () => {
    const origPort = process.env.PORT
    try {
      process.env.PORT = '3000'
      const servers = loadMcpServers({ PORT: '9999' })
      const env = (servers['gigi-tools'].env as Record<string, string>)
      assert.equal(env.PORT, '9999', 'resolvedEnv should override process.env')
    } finally {
      if (origPort !== undefined) process.env.PORT = origPort
      else delete process.env.PORT
    }
  })
})

describe.skip('loadMcpServers → MCP handshake', () => {
  let configClient: MCPTestClient | null = null

  afterAll(() => {
    configClient?.kill()
  })

  it('loadMcpServers should include gigi-tools with correct shape', () => {
    const servers = loadMcpServers()

    assert.ok(servers['gigi-tools'], `gigi-tools not found in config. Got: ${Object.keys(servers).join(', ')}`)

    const gt = servers['gigi-tools']
    assert.equal(gt.type, 'stdio', 'type should be stdio')
    assert.equal(gt.command, 'node', 'command should be node')
    assert.ok(Array.isArray(gt.args), 'args should be an array')

    const args = gt.args as string[]
    assert.ok(args.includes('--import'), 'args should include --import')
    assert.ok(args.some(a => typeof a === 'string' && a.includes('mcp.ts')), 'args should include mcp.ts path')

    // All args should be absolute paths (SDK doesn't support cwd)
    const tsxArg = args[args.indexOf('--import') + 1]
    assert.ok(tsxArg.startsWith('/'), `tsx import should be absolute path, got: "${tsxArg}"`)
    assert.ok(tsxArg.includes('node_modules/tsx'), `tsx should resolve to node_modules/tsx, got: "${tsxArg}"`)

    const mcpArg = args.find(a => a.includes('mcp.ts'))!
    assert.ok(mcpArg.startsWith('/'), `mcp.ts should be absolute path, got: "${mcpArg}"`)

    // env should have PORT
    const env = gt.env as Record<string, string>
    assert.ok(env, 'env should be set')
    assert.ok('PORT' in env, 'env should include PORT')
    assert.ok(env.PORT, `PORT should not be empty, got: "${env.PORT}"`)

    console.log('[test] loadMcpServers gigi-tools config:', JSON.stringify(gt, null, 2))
  })

  it('MCP server should start with loadMcpServers config', async () => {
    const servers = loadMcpServers()
    const gt = servers['gigi-tools']
    assert.ok(gt, 'gigi-tools config required')

    const args = gt.args as string[]
    const env = {
      ...process.env,
      ...(gt.env as Record<string, string>),
    }

    // Spawn MCP server using the exact config loadMcpServers produces
    // Intentionally NO cwd — the SDK doesn't pass it, all paths must be absolute
    const proc = spawn(gt.command as string, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let buffer = ''
    let stderr = ''
    const pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>()

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      // MCP uses Content-Length framing
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) break
        const header = buffer.slice(0, headerEnd)
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (!match) { buffer = buffer.slice(headerEnd + 4); continue }
        const contentLength = parseInt(match[1], 10)
        const bodyStart = headerEnd + 4
        if (buffer.length < bodyStart + contentLength) break
        const body = buffer.slice(bodyStart, bodyStart + contentLength)
        buffer = buffer.slice(bodyStart + contentLength)
        try {
          const msg = JSON.parse(body) as JsonRpcResponse
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)!.resolve(msg)
            pending.delete(msg.id)
          }
        } catch { /* ignore */ }
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const writeMessage = (msg: object) => {
      const body = JSON.stringify(msg)
      const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
      proc.stdin.write(header + body)
    }

    const send = (method: string, params?: unknown): Promise<JsonRpcResponse> => {
      const id = Math.floor(Math.random() * 100000)
      const msg = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Timeout on ${method}\nstderr: ${stderr}`))
        }, 10_000)
        pending.set(id, {
          resolve: (v) => { clearTimeout(timeout); resolve(v) },
          reject: (e) => { clearTimeout(timeout); reject(e) },
        })
        writeMessage(msg)
      })
    }

    try {
      // MCP handshake
      const init = await send('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'config-test', version: '1.0.0' },
      })
      assert.ok(init.result, `Initialize failed with loadMcpServers config: ${JSON.stringify(init.error)}\nstderr: ${stderr}`)

      // Notify initialized
      writeMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })

      // List tools
      const list = await send('tools/list')
      assert.ok(list.result, `tools/list failed: ${JSON.stringify(list.error)}\nstderr: ${stderr}`)

      const tools = (list.result as { tools: Array<{ name: string }> }).tools
      const names = tools.map(t => t.name).sort()
      assert.deepEqual(names, [...EXPECTED_TOOLS].sort(),
        `Wrong tools with loadMcpServers config.\nExpected: ${EXPECTED_TOOLS.sort()}\nGot: ${names}\nstderr: ${stderr}`)
    } finally {
      proc.kill()
    }
  })
})
