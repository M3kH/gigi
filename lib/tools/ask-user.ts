/**
 * MCP Tool — Ask User
 *
 * Allows the agent to ask the user a question and wait for their answer.
 * Since the MCP server runs in a separate process, this tool bridges
 * to the main Gigi process via HTTP, which then emits the question
 * to the frontend via WebSocket and blocks until the user responds.
 */

import { z } from 'zod'
import type { AgentTool } from '../core/registry'

const AskUserSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  options: z.array(z.string()).optional().describe('Optional list of choices (renders as buttons). If omitted, user types a free-form answer.'),
})

type AskUserInput = z.infer<typeof AskUserSchema>

const askUser = async (input: AskUserInput): Promise<unknown> => {
  const port = process.env.PORT || '3000'
  const baseUrl = `http://localhost:${port}`
  const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  console.error(`[ask_user] Sending question to ${baseUrl}/api/internal/ask-user (questionId: ${questionId})`)

  try {
    const res = await fetch(`${baseUrl}/api/internal/ask-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId,
        question: input.question,
        options: input.options,
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 minute timeout
    })

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown error')
      console.error(`[ask_user] HTTP error ${res.status}: ${text}`)
      return `Failed to ask user: ${text}`
    }

    const data = await res.json() as { answer: string }
    console.error(`[ask_user] Got answer: ${data.answer}`)
    return data.answer
  } catch (err) {
    console.error(`[ask_user] Fetch failed:`, (err as Error).message)
    return `Failed to ask user: ${(err as Error).message}`
  }
}

export const agentTools: AgentTool[] = [
  {
    name: 'ask_user',
    description: 'Ask the user a question and wait for their answer. Use when you need clarification, a choice between options, or confirmation. Provide options as buttons when there are clear choices.',
    schema: AskUserSchema,
    handler: askUser,
    context: 'server',
    permission: 'user.interact',
  },
]
