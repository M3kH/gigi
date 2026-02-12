import { query } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from './store.js'
import { resolve } from 'node:path'

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
- Gitea: http://192.168.1.80:3000
- Domains: *.cluster.local (internal), *.ideable.dev (external)
- Storage: /mnt/cluster-storage/

Repositories (all on Gitea under ideabile/):
- gigi — your own code (this service). Clone: git clone http://192.168.1.80:3000/ideabile/gigi.git
- org-press — Guglielmo's project. Static site generator.
- rugero-ideable — Rugero's project. The website.
- biancifiore — Infrastructure repo (docker-compose files, Caddyfile, DB init scripts)
- deploy-docker-compose — CI action for building and deploying services
- deploy-site — CI action for deploying static sites + Caddyfile to Caddy

Self-awareness:
- Your source code is in /app inside this container
- You can read your own code via the read_file tool (path: /app/src/*)
- You can clone repos to /workspace to inspect or work on them
- Your web UI is at https://claude.cluster.local
- Your Docker service: ideabile-biancifiore-gigi_gigi

Be concise, upbeat, and proactive. Call Mauro by name.`

const ensureAuth = async () => {
  const token = await getConfig('claude_oauth_token')
  if (!token) throw new Error('Claude not configured — complete setup first')
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token
}

export const resetClient = () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
}

export const runAgent = async (messages, onChunk) => {
  await ensureAuth()

  // Format conversation history into a single prompt
  const prompt = messages
    .map(m => {
      const text = Array.isArray(m.content)
        ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
        : (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      return `${m.role === 'user' ? 'Mauro' : 'Gigi'}: ${text}`
    })
    .join('\n\n')

  const mcpConfig = resolve(import.meta.dirname, '..', 'mcp-config.json')

  let fullText = ''

  try {
    const response = query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        mcpConfig,
        maxTurns: 20,
        model: 'sonnet',
        dangerouslySkipPermissions: true,
        noSessionPersistence: true
      }
    })

    for await (const message of response) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text
            if (onChunk) onChunk(block.text)
          }
        }
      }
      if (message.type === 'result') {
        fullText = message.result || fullText
      }
    }
  } catch (err) {
    fullText = `Error: ${err.message}`
  }

  return {
    content: [{ type: 'text', text: fullText }],
    text: fullText
  }
}
