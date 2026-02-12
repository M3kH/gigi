import Anthropic from '@anthropic-ai/sdk'
import { getConfig } from './store.js'
import { tools, executeTool } from './tools/index.js'

let client = null

const SYSTEM_PROMPT = `You are Gigi, a persistent AI coordinator running on a TuringPi cluster.
You coordinate a team of agents and manage infrastructure for Mauro.

Your team:
- Guglielmo: org-press core developer (meticulous, pragmatic, "What if X?")
- Rugero: website maintainer (creative, design-focused, first consumer of org-press)

Your responsibilities:
- Communicate with Mauro (Telegram + web UI)
- Manage infrastructure (Docker Swarm, Gitea, deployments)
- Coordinate work across projects
- Accept and process webhooks from Gitea
- Report status, never create code directly (delegate to agents)

Infrastructure:
- TuringPi v2: 3 nodes (worker-0: 192.168.1.110, worker-1: .111, worker-2: .112)
- VIP: 192.168.1.50 (keepalived)
- Gitea: 192.168.1.80:3000
- Domains: *.cluster.local (internal), *.ideable.dev (external)
- Storage: /mnt/cluster-storage/

Be concise, upbeat, and proactive. Call Mauro by name.`

const getClient = async () => {
  if (client) return client
  const apiKey = await getConfig('anthropic_api_key')
  if (!apiKey) throw new Error('Claude not configured — complete setup first')
  client = new Anthropic({ apiKey })
  return client
}

export const resetClient = () => { client = null }

export const runAgent = async (messages, onChunk) => {
  const anthropic = await getClient()
  let currentMessages = [...messages]
  const maxIterations = 20

  for (let i = 0; i < maxIterations; i++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
      stream: false
    })

    // Check for tool use
    const toolUses = response.content.filter(b => b.type === 'tool_use')

    if (toolUses.length === 0) {
      // Final response — extract text
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
      if (onChunk) onChunk(text)
      return { content: response.content, text }
    }

    // Execute tools and continue
    currentMessages.push({ role: 'assistant', content: response.content })

    const toolResults = []
    for (const toolUse of toolUses) {
      if (onChunk) onChunk(`[tool: ${toolUse.name}]\n`)
      const result = await executeTool(toolUse.name, toolUse.input)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: typeof result === 'string' ? result : JSON.stringify(result)
      })
    }

    currentMessages.push({ role: 'user', content: toolResults })
  }

  return { content: [{ type: 'text', text: 'Reached maximum iterations.' }], text: 'Reached maximum iterations.' }
}
