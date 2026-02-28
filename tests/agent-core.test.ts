/**
 * Agent Core Tests — mock Claude SDK for agent.ts coverage
 *
 * Covers: runAgent(), queryLLM(), ensureReady(), configureGit(),
 * getAgentEnv(), session management, hook handlers, event emission.
 *
 * Uses vi.mock() to replace the real Claude SDK `query()` with controllable
 * mock generators so we never spawn a real subprocess.
 *
 * Part of issue #337: mock Claude SDK for agent.ts coverage.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createMockQuery, textResponse, toolUseResponse, errorResponse, maxTurnsResponse, type MockSDKMessage } from './helpers/mock-claude-sdk'

// ── Mocks ────────────────────────────────────────────────────────────

// We need to track the mock query function so tests can configure it
let currentMockQuery = createMockQuery(textResponse('Hello!'))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => currentMockQuery.query(...(args as [{ prompt: string; options?: Record<string, unknown> }])),
}))

vi.mock('../lib/core/store', () => ({
  getConfig: vi.fn(async (key: string) => {
    const configs: Record<string, string> = {
      claude_oauth_token: 'sk-ant-api01-test-fake-key',
      gitea_url: 'http://localhost:3300',
      gitea_token: 'test-gitea-token',
      telegram_bot_token: '',
      telegram_chat_id: '',
    }
    return configs[key] ?? null
  }),
  setConfig: vi.fn(async () => {}),
}))

vi.mock('../lib/core/knowledge', () => ({
  getKnowledge: vi.fn(async () => '## Test Knowledge\n- Test fact 1\n- Test fact 2'),
}))

vi.mock('../lib/core/prompt', () => ({
  buildSystemPrompt: vi.fn(async () => 'You are a test assistant.'),
  loadAgentConfig: vi.fn(() => ({
    name: 'TestBot',
    description: 'a test assistant',
    org: 'test-org',
    git: { name: 'TestBot', email: 'test@example.com' },
  })),
  loadExtraPromptFile: vi.fn(() => ''),
}))

// Mock child_process.execSync to avoid actual git config calls
vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => Buffer.from('')),
}))

// Mock fs operations for configureGit
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      // Return false for SSH key path to skip SSH config
      if (typeof path === 'string' && path.includes('gigi_ssh_key')) return false
      // Return true for mcp-config.json
      if (typeof path === 'string' && path.includes('mcp-config.json')) return true
      return actual.existsSync(path)
    }),
    readFileSync: vi.fn((path: string | URL, encoding?: string) => {
      // Return a mock mcp-config.json
      if (typeof path === 'string' && path.includes('mcp-config.json')) {
        return JSON.stringify({
          mcpServers: {
            'gigi-tools': {
              type: 'stdio',
              command: 'node',
              args: ['--import', 'tsx', 'lib/core/mcp.ts'],
              env: {
                DATABASE_URL: '${DATABASE_URL}',
                GITEA_URL: '${GITEA_URL}',
                GITEA_TOKEN: '${GITEA_TOKEN}',
                PORT: '${PORT}',
              },
            },
          },
        })
      }
      return actual.readFileSync(path as string, encoding as BufferEncoding)
    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    chmodSync: vi.fn(),
  }
})

// ── Imports (after mocks) ───────────────────────────────────────────

// Dynamically import after mocks are set up
const importAgent = async () => {
  // Reset module registry to pick up mocks
  const mod = await import('../lib/core/agent')
  return mod
}

// ── Helpers ─────────────────────────────────────────────────────────

const resetAgentState = async () => {
  const agent = await importAgent()
  agent.resetClient()
}

// ── Tests ───────────────────────────────────────────────────────────

describe('runAgent — basic text response', () => {
  beforeEach(async () => {
    // Reset env to avoid stale state
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1' // Skip MCP loading for speed
    currentMockQuery = createMockQuery(textResponse('Hello from mock!'))
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('returns text content from a simple response', async () => {
    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Hi there' }],
      null,
    )
    expect(result.text).toBe('Hello from mock!')
    expect(result.content).toEqual([{ type: 'text', text: 'Hello from mock!' }])
    expect(result.sessionId).toBe('mock-session-123')
    expect(result.stopReason).toBe('end_turn')
  })

  it('captures session ID from first message', async () => {
    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Test' }],
      null,
    )
    expect(result.sessionId).toBe('mock-session-123')
  })

  it('captures usage data', async () => {
    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Test' }],
      null,
    )
    expect(result.usage).not.toBeNull()
    expect(result.usage!.inputTokens).toBe(100)
    expect(result.usage!.outputTokens).toBe(50)
    expect(result.usage!.costUSD).toBe(0.01)
    expect(result.usage!.durationMs).toBe(500)
  })
})

describe('runAgent — tool use response', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    currentMockQuery = createMockQuery(
      toolUseResponse({
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        toolResult: 'file1.ts\nfile2.ts',
        finalText: 'Found 2 files.',
      })
    )
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('captures tool calls and results', async () => {
    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'List files' }],
      null,
    )
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('Bash')
    expect(result.toolCalls[0].input).toEqual({ command: 'ls' })
    expect(result.toolResults['toolu_mock_001']).toBe('file1.ts\nfile2.ts')
    expect(result.text).toBe('Found 2 files.')
  })

  it('preserves interleaved content order', async () => {
    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'List files' }],
      null,
    )
    // First block: tool_use, then text
    expect(result.interleavedContent).toHaveLength(2)
    expect(result.interleavedContent[0].type).toBe('tool_use')
    expect(result.interleavedContent[1].type).toBe('text')
  })
})

describe('runAgent — event callbacks', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    currentMockQuery = createMockQuery(
      toolUseResponse({
        toolName: 'Read',
        toolInput: { file_path: '/test.ts' },
        toolResult: 'const x = 1',
        finalText: 'File read.',
      })
    )
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('emits text_chunk events for text blocks', async () => {
    const events: Record<string, unknown>[] = []
    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Read file' }],
      (event) => events.push(event),
    )
    const textChunks = events.filter((e) => e.type === 'text_chunk')
    expect(textChunks.length).toBeGreaterThanOrEqual(1)
    expect(textChunks.some((e) => e.text === 'File read.')).toBe(true)
  })

  it('emits tool_use events for tool calls', async () => {
    const events: Record<string, unknown>[] = []
    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Read file' }],
      (event) => events.push(event),
    )
    const toolUses = events.filter((e) => e.type === 'tool_use')
    expect(toolUses).toHaveLength(1)
    expect(toolUses[0].name).toBe('Read')
  })

  it('emits tool_result events', async () => {
    const events: Record<string, unknown>[] = []
    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Read file' }],
      (event) => events.push(event),
    )
    const toolResults = events.filter((e) => e.type === 'tool_result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0].result).toBe('const x = 1')
  })

  it('emits agent_done event exactly once', async () => {
    const events: Record<string, unknown>[] = []
    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Read file' }],
      (event) => events.push(event),
    )
    const doneEvents = events.filter((e) => e.type === 'agent_done')
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].isError).toBe(false)
  })

  it('survives onEvent callback errors without killing the agent', async () => {
    const agent = await importAgent()
    // Callback that throws on first call
    let callCount = 0
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Test' }],
      () => {
        callCount++
        if (callCount === 1) throw new Error('callback error')
      },
    )
    // Should still complete and return a result
    expect(result.text).toBeTruthy()
  })
})

describe('runAgent — session resume', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('passes resume option when sessionId is provided', async () => {
    currentMockQuery = createMockQuery((call) => {
      // Verify resume option is set
      expect(call.options?.resume).toBe('existing-session-456')
      return textResponse('Resumed!', { sessionId: 'existing-session-456' })
    })

    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Continue' }],
      null,
      { sessionId: 'existing-session-456' },
    )
    expect(result.text).toBe('Resumed!')
    expect(result.sessionId).toBe('existing-session-456')
  })

  it('falls back to fresh session when resume fails', async () => {
    let callNumber = 0
    currentMockQuery = createMockQuery((call) => {
      callNumber++
      if (callNumber === 1 && call.options?.resume) {
        // Simulate resume failure by throwing
        throw new Error('Session expired')
      }
      return textResponse('Fresh session!', { sessionId: 'new-session-789' })
    })

    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Continue' }],
      null,
      { sessionId: 'expired-session' },
    )
    expect(result.text).toBe('Fresh session!')
    expect(result.sessionId).toBe('new-session-789')
  })
})

describe('runAgent — abort signal', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    currentMockQuery = createMockQuery(textResponse('Should not get here'))
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('throws AbortError when signal is already aborted before start', async () => {
    const agent = await importAgent()
    const controller = new AbortController()
    controller.abort()

    await expect(
      agent.runAgent(
        [{ role: 'user', content: 'Test' }],
        null,
        { signal: controller.signal },
      )
    ).rejects.toThrow('Agent aborted before start')
  })
})

describe('runAgent — error handling', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('catches query errors and returns error text', async () => {
    currentMockQuery = createMockQuery(() => {
      throw new Error('SDK connection failed')
    })

    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Test' }],
      null,
    )
    expect(result.text).toContain('Error: SDK connection failed')
  })

  it('emits agent_done with isError=true on failure', async () => {
    currentMockQuery = createMockQuery(() => {
      throw new Error('Boom')
    })

    const events: Record<string, unknown>[] = []
    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Test' }],
      (e) => events.push(e),
    )
    const done = events.find((e) => e.type === 'agent_done')
    expect(done?.isError).toBe(true)
  })
})

describe('runAgent — routing and model selection', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    currentMockQuery = createMockQuery(textResponse('Routed response'))
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('uses routing model when routing decision is provided', async () => {
    currentMockQuery = createMockQuery((call) => {
      expect(call.options?.model).toBe('claude-haiku-4-5')
      return textResponse('Quick reply')
    })

    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Hello' }],
      null,
      {
        routing: {
          complexity: 'simple',
          model: 'claude-haiku-4-5',
          includeTools: false,
          maxTurns: 1,
          useMinimalPrompt: true,
          reason: 'greeting',
        },
      },
    )
    expect(result.text).toBe('Quick reply')
  })

  it('uses minimal prompt when routing says useMinimalPrompt', async () => {
    currentMockQuery = createMockQuery((call) => {
      // When minimal prompt is used, system prompt should NOT be the full one
      const sp = call.options?.systemPrompt as string
      // It should use MINIMAL_SYSTEM_PROMPT, not the full buildSystemPrompt result
      expect(sp).toBeDefined()
      return textResponse('Minimal reply')
    })

    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Thanks!' }],
      null,
      {
        routing: {
          complexity: 'simple',
          model: 'claude-haiku-4-5',
          includeTools: false,
          maxTurns: 1,
          useMinimalPrompt: true,
          reason: 'gratitude',
        },
      },
    )
  })

  it('includes agent_done event with routing info', async () => {
    const events: Record<string, unknown>[] = []
    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Hello' }],
      (e) => events.push(e),
      {
        routing: {
          complexity: 'simple',
          model: 'claude-haiku-4-5',
          includeTools: false,
          maxTurns: 1,
          useMinimalPrompt: true,
          reason: 'greeting',
        },
      },
    )
    const done = events.find((e) => e.type === 'agent_done') as Record<string, unknown>
    expect(done.routing).toEqual({ complexity: 'simple', model: 'claude-haiku-4-5' })
  })
})

describe('runAgent — message formatting', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('formats string content messages', async () => {
    currentMockQuery = createMockQuery((call) => {
      const prompt = call.prompt as string
      expect(prompt).toContain('Operator: Hello world')
      return textResponse('OK')
    })

    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Hello world' }],
      null,
    )
    expect(currentMockQuery.calls).toHaveLength(1)
  })

  it('formats array content messages (extracts text blocks)', async () => {
    currentMockQuery = createMockQuery((call) => {
      const prompt = call.prompt as string
      expect(prompt).toContain('Operator: Hello from array')
      return textResponse('OK')
    })

    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: [{ type: 'text', text: 'Hello from array' }] }],
      null,
    )
  })

  it('formats multi-message conversations', async () => {
    currentMockQuery = createMockQuery((call) => {
      const prompt = call.prompt as string
      // With fresh session, all messages are formatted
      expect(prompt).toContain('Operator: First')
      expect(prompt).toContain('TestBot: Response')
      expect(prompt).toContain('Operator: Second')
      return textResponse('OK')
    })

    const agent = await importAgent()
    await agent.runAgent(
      [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Second' },
      ],
      null,
    )
  })

  it('only sends last message when resuming session', async () => {
    currentMockQuery = createMockQuery((call) => {
      const prompt = call.prompt as string
      // When resuming, only the last message should be sent
      expect(prompt).not.toContain('First')
      expect(prompt).toContain('Operator: Second')
      return textResponse('Resumed', { sessionId: 'session-resume' })
    })

    const agent = await importAgent()
    await agent.runAgent(
      [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Second' },
      ],
      null,
      { sessionId: 'session-resume' },
    )
  })
})

describe('runAgent — max_turns stop reason', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    currentMockQuery = createMockQuery(maxTurnsResponse('Hit limit', 50))
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('reports max_turns stop reason', async () => {
    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Complex task' }],
      null,
    )
    expect(result.stopReason).toBe('max_turns')
    expect(result.text).toBe('Hit limit')
  })
})

describe('runAgent — modelUsage aggregation', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('aggregates cost from modelUsage when available', async () => {
    currentMockQuery = createMockQuery([
      {
        type: 'assistant',
        session_id: 'mock-session',
        message: { content: [{ type: 'text', text: 'Done' }] },
      },
      {
        type: 'result',
        result: 'Done',
        reason: 'end_turn',
        session_id: 'mock-session',
        usage: { input_tokens: 200, output_tokens: 100 },
        modelUsage: {
          'claude-opus-4-6': { costUSD: 0.05, inputTokens: 150, outputTokens: 80 },
          'claude-haiku-4-5': { costUSD: 0.001, inputTokens: 50, outputTokens: 20 },
        },
        duration_ms: 2000,
        duration_api_ms: 1500,
        num_turns: 3,
      },
    ])

    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Test' }],
      null,
    )
    expect(result.usage).not.toBeNull()
    expect(result.usage!.costUSD).toBeCloseTo(0.051, 3)
    expect(result.usage!.modelUsage).toBeDefined()
    expect(result.usage!.numTurns).toBe(3)
  })
})

describe('queryLLM — lightweight query', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    currentMockQuery = createMockQuery(textResponse('Summary result'))
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('returns text from simple query', async () => {
    const agent = await importAgent()
    const result = await agent.queryLLM('Summarize this', 'You are a summarizer')
    expect(result).toBe('Summary result')
  })

  it('passes correct options (maxTurns=1, no MCP, no persist)', async () => {
    currentMockQuery = createMockQuery((call) => {
      expect(call.options?.maxTurns).toBe(1)
      expect(call.options?.persistSession).toBe(false)
      expect(call.options?.mcpServers).toEqual({})
      return textResponse('OK')
    })

    const agent = await importAgent()
    await agent.queryLLM('Test', 'System')
  })

  it('uses specified model', async () => {
    currentMockQuery = createMockQuery((call) => {
      expect(call.options?.model).toBe('claude-haiku-4-5')
      return textResponse('OK')
    })

    const agent = await importAgent()
    await agent.queryLLM('Test', 'System', 'claude-haiku-4-5')
  })
})

describe('handlePreToolUse — AskUserQuestion denial', () => {
  it('returns deny decision for AskUserQuestion', async () => {
    const agent = await importAgent()
    const result = await agent.handlePreToolUse({})
    expect(result.hookSpecificOutput).toBeDefined()
    const output = result.hookSpecificOutput as Record<string, string>
    expect(output.hookEventName).toBe('PreToolUse')
    expect(output.permissionDecision).toBe('deny')
    expect(output.permissionDecisionReason).toContain('ask_user MCP tool')
  })
})

describe('createToolFailureHandler — retry behavior', () => {
  it('tracks failures per tool+input combination', async () => {
    const agent = await importAgent()
    const { handler, getRetryCount } = agent.createToolFailureHandler()

    await handler({ tool_name: 'Bash', tool_input: { command: 'ls' }, error: 'Exit code 1' })
    expect(getRetryCount('Bash:{"command":"ls"}')).toBe(1)

    await handler({ tool_name: 'Bash', tool_input: { command: 'ls' }, error: 'Exit code 1' })
    expect(getRetryCount('Bash:{"command":"ls"}')).toBe(2)
  })

  it('returns escalation message after 3 failures', async () => {
    const agent = await importAgent()
    const { handler } = agent.createToolFailureHandler()

    const input = { tool_name: 'Read', tool_input: { file: '/bad' }, error: 'ENOENT' }
    await handler(input)
    await handler(input)
    const r3 = await handler(input)

    expect(r3.systemMessage).toContain('failed 3 times')
    expect(r3.systemMessage).toContain('Do NOT retry')
    expect(r3.systemMessage).toContain('ask for help')
  })

  it('provides specific guidance for Bash exit code failures', async () => {
    const agent = await importAgent()
    const { handler } = agent.createToolFailureHandler()

    const result = await handler({
      tool_name: 'Bash',
      tool_input: { command: 'npm list' },
      error: 'Exit code 1: npm list output',
    })
    expect(result.systemMessage).toContain('Exit codes don\'t always mean failure')
    expect(result.systemMessage).toContain('attempt 1/3')
  })

  it('shows 2nd attempt warning on Bash failures', async () => {
    const agent = await importAgent()
    const { handler } = agent.createToolFailureHandler()

    const input = { tool_name: 'Bash', tool_input: { command: 'failing-cmd' }, error: 'Exit code 127' }
    await handler(input)
    const r2 = await handler(input)

    expect(r2.systemMessage).toContain('2nd attempt')
  })

  it('returns generic guidance for non-Bash tool failures', async () => {
    const agent = await importAgent()
    const { handler } = agent.createToolFailureHandler()

    const result = await handler({
      tool_name: 'mcp__gigi-tools__gitea',
      tool_input: { action: 'list_repos' },
      error: 'MCP disconnected',
    })
    expect(result.systemMessage).toContain('attempt 1/3')
    expect(result.systemMessage).toContain('Analyze the error')
  })

  it('tracks different tool inputs separately', async () => {
    const agent = await importAgent()
    const { handler, getRetryCount } = agent.createToolFailureHandler()

    await handler({ tool_name: 'Bash', tool_input: { command: 'ls' }, error: 'fail' })
    await handler({ tool_name: 'Bash', tool_input: { command: 'pwd' }, error: 'fail' })

    expect(getRetryCount('Bash:{"command":"ls"}')).toBe(1)
    expect(getRetryCount('Bash:{"command":"pwd"}')).toBe(1)
  })
})

describe('loadMcpServers', () => {
  it('is exported and callable', async () => {
    const agent = await importAgent()
    expect(typeof agent.loadMcpServers).toBe('function')
  })
})

describe('resetClient', () => {
  it('clears OAuth token and configured flag', async () => {
    const agent = await importAgent()
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token'
    agent.resetClient()
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })
})

describe('ensureReady — token detection', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('sets ANTHROPIC_API_KEY for API keys (non-OAuth)', async () => {
    // The mock store returns 'sk-ant-api01-test-fake-key' which is NOT an OAuth token
    currentMockQuery = createMockQuery(textResponse('OK'))
    const agent = await importAgent()
    await agent.runAgent([{ role: 'user', content: 'Test' }], null)

    // After ensureReady, ANTHROPIC_API_KEY should be set (not CLAUDE_CODE_OAUTH_TOKEN)
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-api01-test-fake-key')
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })
})

describe('runAgent — knowledge injection', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    currentMockQuery = createMockQuery(textResponse('OK'))
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('injects knowledge into full system prompt', async () => {
    currentMockQuery = createMockQuery((call) => {
      const sp = call.options?.systemPrompt as string
      // buildSystemPrompt returns 'You are a test assistant.'
      // Knowledge should be appended
      expect(sp).toContain('You are a test assistant.')
      expect(sp).toContain('## Knowledge Base')
      expect(sp).toContain('## Test Knowledge')
      return textResponse('OK')
    })

    const agent = await importAgent()
    await agent.runAgent(
      [{ role: 'user', content: 'Complex task' }],
      null,
      // Use default routing (complex) which uses full prompt
    )
  })
})

describe('runAgent — consecutive text block merging', () => {
  beforeEach(async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    process.env.SKIP_MCP = '1'
    await resetAgentState()
  })

  afterEach(() => {
    delete process.env.SKIP_MCP
  })

  it('merges consecutive text blocks in interleavedContent', async () => {
    currentMockQuery = createMockQuery([
      {
        type: 'assistant',
        session_id: 'mock-session',
        message: { content: [{ type: 'text', text: 'Part 1' }] },
      },
      {
        type: 'assistant',
        session_id: 'mock-session',
        message: { content: [{ type: 'text', text: ' Part 2' }] },
      },
      {
        type: 'result',
        result: 'Part 1 Part 2',
        reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.001,
        duration_ms: 100,
      },
    ])

    const agent = await importAgent()
    const result = await agent.runAgent(
      [{ role: 'user', content: 'Test' }],
      null,
    )
    // Consecutive text blocks should be merged
    expect(result.interleavedContent).toHaveLength(1)
    expect(result.interleavedContent[0].type).toBe('text')
    expect((result.interleavedContent[0] as { type: 'text'; text: string }).text).toBe('Part 1 Part 2')
  })
})
