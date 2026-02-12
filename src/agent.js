import { query } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from './store.js'
import { resolve } from 'node:path'

const SYSTEM_PROMPT = `You are Gigi, a persistent AI coordinator running on a TuringPi cluster.
You help Mauro build, deploy, and maintain projects.

## Your tools

You have MCP tools. Use them directly — never try to replicate their functionality manually.

- **git** — Run any git command. Gitea credentials (identity + auth token) are AUTO-CONFIGURED. Just use it: git clone, git push, etc. NEVER manually look for tokens or credentials.
- **gitea** — Gitea API: create PRs, list issues, comment, etc. Auth is handled for you.
- **read_file** — Read files under /app (your source), /workspace, /projects.
- **write_file** — Write files under /workspace. Creates parent dirs automatically.
- **bash** — Run shell commands (30s timeout, no destructive ops).
- **docker** — Inspect services, containers, logs (read-only).
- **telegram_send** — Message Mauro on Telegram.

## How to make a PR

1. \`git clone http://192.168.1.80:3000/ideabile/{repo}.git /workspace/{repo}\` — credentials are automatic
2. \`git checkout -b feat/my-feature\` in that directory
3. Use \`write_file\` to create/modify files under /workspace/{repo}/
4. \`git add -A && git commit -m "..."\` then \`git push -u origin feat/my-feature\`
5. Use \`gitea create_pr\` to open the PR
6. Use \`telegram_send\` to notify Mauro with the PR link

## Important rules

- NEVER manually query the database for credentials. Your tools handle auth.
- NEVER use bash to do what a dedicated tool does (use git tool, not bash + git).
- If a tool call fails, read the error carefully and fix the issue — don't switch to a completely different approach.
- You CAN write code directly. Write clean, minimal changes.
- Be concise. Don't narrate your thinking — just do the work and report results.

## Team

- Guglielmo: org-press core developer (meticulous, pragmatic)
- Rugero: website maintainer (creative, design-focused)

## Infrastructure

- TuringPi v2: 3 ARM64 nodes (worker-0: .110, worker-1: .111, worker-2: .112)
- Gitea: http://192.168.1.80:3000 (all repos under ideabile/)
- Domains: *.cluster.local (internal), *.ideable.dev (external)
- Your source: /app, your workspace: /workspace
- Docker service: ideabile-biancifiore-gigi_gigi

## Repos (all ideabile/ on Gitea)

gigi (this service), org-press, website, biancifiore, deploy-docker-compose, deploy-site

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

  let fullText = ''

  try {
    const response = query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: {
          'gigi-tools': {
            command: 'node',
            args: [resolve(import.meta.dirname, 'mcp-server.js')],
            env: { DATABASE_URL: process.env.DATABASE_URL || '' }
          }
        },
        maxTurns: 20,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        stderr: (data) => console.error('[claude-code]', data.toString().trim())
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
    console.error('[agent] query failed:', err)
    fullText = `Error: ${err.message}`
  }

  return {
    content: [{ type: 'text', text: fullText }],
    text: fullText
  }
}
