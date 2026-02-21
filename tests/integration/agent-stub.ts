/**
 * Agent Stub — Deterministic agent mock for integration tests
 *
 * Returns canned responses based on input patterns. Avoids burning API tokens
 * while testing routing, storage, and event flow.
 */

import type { AgentMessage } from '../../lib/core/agent'
import type { EventCallback } from '../../lib/core/agent'
import { randomUUID } from 'node:crypto'

// ─── Types ──────────────────────────────────────────────────────────

export interface StubResponse {
  text: string
  content: Array<{ type: string; text: string }>
  interleavedContent: Array<{ type: string; text: string }>
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>
  toolResults: Record<string, string>
  sessionId: string | null
  stopReason: string
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    costUSD: number
  }
}

export interface StubPattern {
  /** Regex or string to match against the last user message */
  match: RegExp | string
  /** Response to return when matched */
  response: Partial<StubResponse>
}

// ─── Default Response ───────────────────────────────────────────────

const defaultResponse = (): StubResponse => ({
  text: 'This is a stub response from the test agent.',
  content: [{ type: 'text', text: 'This is a stub response from the test agent.' }],
  interleavedContent: [{ type: 'text', text: 'This is a stub response from the test agent.' }],
  toolCalls: [],
  toolResults: {},
  sessionId: `test-session-${randomUUID().slice(0, 8)}`,
  stopReason: 'end_turn',
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0.001,
  },
})

// ─── Agent Stub ─────────────────────────────────────────────────────

export class AgentStub {
  private patterns: StubPattern[] = []
  private calls: Array<{ messages: AgentMessage[]; options?: Record<string, unknown> }> = []
  private defaultText: string = 'Stub response'

  /** Add a response pattern */
  when(match: RegExp | string): { respond: (response: Partial<StubResponse>) => AgentStub } {
    return {
      respond: (response) => {
        this.patterns.push({ match, response })
        return this
      },
    }
  }

  /** Set the default response text */
  setDefault(text: string): AgentStub {
    this.defaultText = text
    return this
  }

  /** Get the mock runAgent function */
  getRunner(): (
    messages: AgentMessage[],
    onEvent?: EventCallback | null,
    options?: Record<string, unknown>
  ) => Promise<StubResponse> {
    return async (messages, onEvent, options) => {
      this.calls.push({ messages, options })

      // Extract last user message text
      const lastMsg = [...messages].reverse().find(m => m.role === 'user')
      const lastText = extractText(lastMsg)

      // Find matching pattern
      const matched = this.patterns.find(p => {
        if (typeof p.match === 'string') return lastText.includes(p.match)
        return p.match.test(lastText)
      })

      const response: StubResponse = {
        ...defaultResponse(),
        text: this.defaultText,
        content: [{ type: 'text', text: this.defaultText }],
        interleavedContent: [{ type: 'text', text: this.defaultText }],
        ...(matched?.response || {}),
      }

      // Emit events if callback provided
      if (onEvent) {
        onEvent({ type: 'agent_start' })

        // Emit text chunks
        for (const block of response.interleavedContent) {
          if (block.type === 'text') {
            onEvent({ type: 'text_chunk', text: block.text })
          }
        }

        // Emit tool calls
        for (const tc of response.toolCalls) {
          const toolUseId = randomUUID()
          onEvent({ type: 'tool_use', toolUseId, name: tc.name, input: tc.input })
          onEvent({ type: 'tool_result', toolUseId, result: response.toolResults[tc.name] || 'ok' })
        }

        onEvent({
          type: 'agent_done',
          cost: response.usage.costUSD,
          duration: 100,
          turns: 1,
          isError: false,
          usage: response.usage,
        })
      }

      return response
    }
  }

  /** Get all recorded calls */
  getCalls(): Array<{ messages: AgentMessage[]; options?: Record<string, unknown> }> {
    return [...this.calls]
  }

  /** Get the last call */
  getLastCall(): { messages: AgentMessage[]; options?: Record<string, unknown> } | undefined {
    return this.calls[this.calls.length - 1]
  }

  /** Get call count */
  getCallCount(): number {
    return this.calls.length
  }

  /** Reset call history */
  reset(): void {
    this.calls = []
  }

  /** Reset everything (patterns + calls) */
  resetAll(): void {
    this.patterns = []
    this.calls = []
    this.defaultText = 'Stub response'
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

const extractText = (msg?: AgentMessage): string => {
  if (!msg) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n')
  }
  return ''
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create a new agent stub with optional patterns.
 */
export const createAgentStub = (): AgentStub => new AgentStub()

/**
 * Create a simple stub that always returns a fixed response.
 */
export const createSimpleStub = (text: string): AgentStub => {
  return new AgentStub().setDefault(text)
}

/**
 * Create a stub that simulates tool usage.
 */
export const createToolStub = (toolName: string, toolInput: Record<string, unknown>, toolResult: string): AgentStub => {
  const stub = new AgentStub()
  stub.setDefault(`Used tool ${toolName}`)
  stub.when(/./).respond({
    text: `Used tool ${toolName}`,
    toolCalls: [{ name: toolName, input: toolInput }],
    toolResults: { [toolName]: toolResult },
  })
  return stub
}
