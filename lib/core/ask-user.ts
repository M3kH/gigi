/**
 * Ask User — Pending question state and resolver
 *
 * Manages the lifecycle of questions sent from the agent to the user.
 * The MCP tool POSTs a question → this module stores a resolver →
 * the WebSocket handler calls resolve() when the user answers.
 */

import { emit } from './events'

interface PendingQuestion {
  resolve: (answer: string) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
  question: string
  options?: string[]
}

const pending = new Map<string, PendingQuestion>()

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Register a question and emit it to all connected clients.
 * Returns a Promise that resolves when the user answers.
 */
export const askUser = (
  questionId: string,
  question: string,
  options?: string[],
  conversationId?: string,
): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(questionId)
      resolve('(No response from user — timed out after 5 minutes)')
    }, TIMEOUT_MS)

    pending.set(questionId, { resolve, reject, timeout, question, options })

    // Emit to frontend via event bus → WebSocket
    emit({
      type: 'ask_user',
      conversationId,
      questionId,
      question,
      options: options ?? [],
    })
  })
}

/**
 * Resolve a pending question with the user's answer.
 * Called from the WebSocket handler when the user responds.
 */
export const answerQuestion = (questionId: string, answer: string): boolean => {
  const entry = pending.get(questionId)
  if (!entry) return false

  clearTimeout(entry.timeout)
  pending.delete(questionId)
  entry.resolve(answer)
  return true
}

/**
 * Check if there's a pending question.
 */
export const hasPendingQuestion = (questionId: string): boolean => {
  return pending.has(questionId)
}
