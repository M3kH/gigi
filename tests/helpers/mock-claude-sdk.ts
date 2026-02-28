/**
 * Mock Claude SDK — test helper for agent.ts coverage
 *
 * Provides a configurable mock for `@anthropic-ai/claude-agent-sdk`'s `query()` function.
 * Simulates the async generator protocol that the SDK uses to stream messages.
 *
 * Usage:
 *   import { createMockQuery, mockQueryModule } from './helpers/mock-claude-sdk'
 *
 *   // Configure mock responses
 *   const mockQuery = createMockQuery([
 *     { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello!' }] } },
 *     { type: 'result', result: 'Hello!', usage: { input_tokens: 10, output_tokens: 5 } },
 *   ])
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface MockSDKMessage {
  type: string
  session_id?: string
  message?: {
    content: Array<{
      type: string
      text?: string
      id?: string
      name?: string
      input?: unknown
    }>
  }
  result?: string
  reason?: string
  is_error?: boolean
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  modelUsage?: Record<string, Record<string, number>>
  total_cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  [key: string]: unknown
}

// ─── Mock Query Generator ───────────────────────────────────────────

/**
 * Creates a mock async generator that yields the given messages,
 * simulating the SDK's `query()` return type.
 */
export function createMockQueryGenerator(messages: MockSDKMessage[]) {
  async function* generator(): AsyncGenerator<MockSDKMessage, void> {
    for (const msg of messages) {
      yield msg
    }
  }

  const gen = generator()
  // Add the Query interface methods (interrupt, close, etc.)
  return Object.assign(gen, {
    interrupt: async () => {},
    close: () => {},
    setPermissionMode: async () => {},
    setModel: async () => {},
    abortController: new AbortController(),
  })
}

// ─── Mock Query Function ────────────────────────────────────────────

export interface MockQueryCall {
  prompt: string | unknown
  options?: Record<string, unknown>
}

/**
 * Creates a mock `query()` function that records calls and returns
 * configurable responses.
 *
 * @param responses - Messages to yield for each call (or a function to compute them)
 * @returns Object with the mock function and recorded calls
 */
export function createMockQuery(
  responses: MockSDKMessage[] | ((call: MockQueryCall) => MockSDKMessage[])
) {
  const calls: MockQueryCall[] = []

  const mockFn = (params: { prompt: string | unknown; options?: Record<string, unknown> }) => {
    calls.push({ prompt: params.prompt, options: params.options })
    const messages = typeof responses === 'function'
      ? responses({ prompt: params.prompt, options: params.options })
      : responses
    return createMockQueryGenerator(messages)
  }

  return { query: mockFn, calls }
}

// ─── Preset Response Builders ───────────────────────────────────────

/**
 * Build a simple text response sequence (assistant message + result).
 */
export function textResponse(text: string, opts?: {
  sessionId?: string
  costUSD?: number
  inputTokens?: number
  outputTokens?: number
}): MockSDKMessage[] {
  return [
    {
      type: 'assistant',
      session_id: opts?.sessionId ?? 'mock-session-123',
      message: {
        content: [{ type: 'text', text }],
      },
    },
    {
      type: 'result',
      result: text,
      reason: 'end_turn',
      session_id: opts?.sessionId ?? 'mock-session-123',
      usage: {
        input_tokens: opts?.inputTokens ?? 100,
        output_tokens: opts?.outputTokens ?? 50,
      },
      total_cost_usd: opts?.costUSD ?? 0.01,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
    },
  ]
}

/**
 * Build a response with tool use (assistant calls a tool, gets result, then responds).
 */
export function toolUseResponse(opts: {
  toolName: string
  toolInput: unknown
  toolResult: string
  finalText: string
  sessionId?: string
}): MockSDKMessage[] {
  const sid = opts.sessionId ?? 'mock-session-123'
  const toolUseId = 'toolu_mock_001'

  return [
    {
      type: 'assistant',
      session_id: sid,
      message: {
        content: [
          { type: 'tool_use', id: toolUseId, name: opts.toolName, input: opts.toolInput },
        ],
      },
    },
    {
      type: 'user',
      session_id: sid,
      message: {
        content: [
          { type: 'tool_result', tool_use_id: toolUseId, content: opts.toolResult },
        ],
      },
    },
    {
      type: 'assistant',
      session_id: sid,
      message: {
        content: [{ type: 'text', text: opts.finalText }],
      },
    },
    {
      type: 'result',
      result: opts.finalText,
      reason: 'end_turn',
      session_id: sid,
      usage: {
        input_tokens: 200,
        output_tokens: 100,
      },
      total_cost_usd: 0.02,
      duration_ms: 1000,
      duration_api_ms: 800,
      num_turns: 2,
    },
  ]
}

/**
 * Build an error response from the SDK.
 */
export function errorResponse(errorMessage: string): MockSDKMessage[] {
  return [
    {
      type: 'result',
      result: `Error: ${errorMessage}`,
      reason: 'error',
      is_error: true,
      usage: { input_tokens: 10, output_tokens: 0 },
      total_cost_usd: 0.001,
      duration_ms: 100,
      duration_api_ms: 50,
      num_turns: 0,
    },
  ]
}

/**
 * Build a max_turns stop response.
 */
export function maxTurnsResponse(text: string, turns: number): MockSDKMessage[] {
  return [
    {
      type: 'assistant',
      session_id: 'mock-session-123',
      message: {
        content: [{ type: 'text', text }],
      },
    },
    {
      type: 'result',
      result: text,
      reason: 'max_turns',
      session_id: 'mock-session-123',
      usage: { input_tokens: 500, output_tokens: 250 },
      total_cost_usd: 0.05,
      duration_ms: 5000,
      duration_api_ms: 4000,
      num_turns: turns,
    },
  ]
}
