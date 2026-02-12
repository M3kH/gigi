import { runAgent } from './agent.js'
import * as store from './store.js'

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

  return response
}

export const newConversation = (channel, channelId) => {
  const key = `${channel}:${channelId}`
  active.delete(key)
}
