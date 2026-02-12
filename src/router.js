import { runAgent } from './agent.js'
import * as store from './store.js'
import { enforceCompletion, startTask, markNotified } from './task_enforcer.js'

// Active conversations per channel key (e.g. "telegram:12345", "web:uuid")
const active = new Map()

export const handleMessage = async (channel, channelId, text, onChunk) => {
  const key = `${channel}:${channelId}`

  // Reuse or create conversation
  let convId = active.get(key)
  if (!convId) {
    const conv = await store.createConversation(channel, null)
    convId = conv.id
    active.set(key, convId)
  }

  // Detect /issue command to start task tracking
  const issueMatch = text.match(/\/issue\s+([a-z0-9-]+)#(\d+)/i)
  if (issueMatch) {
    const [, repo, issueNumber] = issueMatch
    await startTask(convId, repo, parseInt(issueNumber, 10))
    console.log(`[router] Started task tracking: ${repo}#${issueNumber}`)
  }

  // Store user message
  await store.addMessage(convId, 'user', [{ type: 'text', text }])

  // Load history
  const history = await store.getMessages(convId)
  const messages = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }))

  // Run agent loop
  const response = await runAgent(messages, onChunk)

  // Store assistant response
  await store.addMessage(convId, 'assistant', response.content)

  // ENFORCE TASK COMPLETION (this is the key fix!)
  const enforcement = await enforceCompletion(convId)

  if (enforcement) {
    console.log(`[router] Enforcement triggered:`, enforcement.action)

    // If code changed but no PR yet, trigger follow-up
    if (enforcement.action === 'code_changed') {
      const followUp = `You made code changes for ${enforcement.repo}#${enforcement.issueNumber}. Complete the task by:\n1. Committing and pushing to a feature branch\n2. Creating a PR via gitea tool\n3. Notifying via telegram_send`

      // Auto-trigger another agent cycle
      await store.addMessage(convId, 'user', [{ type: 'text', text: '[ENFORCER] ' + followUp }])
      const messages2 = (await store.getMessages(convId)).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))

      const response2 = await runAgent(messages2, onChunk)
      await store.addMessage(convId, 'assistant', response2.content)

      // Re-check enforcement
      const enforcement2 = await enforceCompletion(convId)
      if (enforcement2?.action === 'needs_notification') {
        await markNotified(convId, enforcement2.repo, enforcement2.issueNumber)
      }
    }

    // If branch pushed but no notification, trigger it
    if (enforcement.action === 'needs_notification') {
      const followUp = `You pushed branch ${enforcement.branch} for ${enforcement.repo}#${enforcement.issueNumber}. Complete the task by sending a Telegram notification with the PR link.`

      await store.addMessage(convId, 'user', [{ type: 'text', text: '[ENFORCER] ' + followUp }])
      const messages2 = (await store.getMessages(convId)).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))

      const response2 = await runAgent(messages2, onChunk)
      await store.addMessage(convId, 'assistant', response2.content)

      await markNotified(convId, enforcement.repo, enforcement.issueNumber)
    }
  }

  return response
}

export const newConversation = (channel, channelId) => {
  const key = `${channel}:${channelId}`
  active.delete(key)
}
