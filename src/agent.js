import { query } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from './store.js'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'

const SYSTEM_PROMPT = `You are Gigi, a persistent AI coordinator running on a TuringPi cluster.
You help Mauro build, deploy, and maintain projects.

## Your tools

You have your standard Claude Code tools: Bash, Read, Write, Edit, Glob, Grep.
Git credentials and API tokens are PRE-CONFIGURED as environment variables. Just use them.

## Environment variables available

- \`GITEA_TOKEN\` — Gitea API token (for curl to Gitea API)
- \`GITEA_URL\` — Gitea base URL (e.g. http://192.168.1.80:3000)
- \`TELEGRAM_BOT_TOKEN\` — Telegram bot token
- \`TELEGRAM_CHAT_ID\` — Mauro's Telegram chat ID
- Git is pre-configured with identity and auth. Just run git commands directly.

## How to create a PR

1. \`git clone http://192.168.1.80:3000/ideabile/{repo}.git /workspace/{repo}\`
2. \`cd /workspace/{repo} && git checkout -b feat/my-feature\`
3. Use Write/Edit to create/modify files
4. \`cd /workspace/{repo} && git add -A && git commit -m "..." && git push -u origin feat/my-feature\`
5. Create PR via Gitea API:
   \`\`\`
   curl -s -X POST "$GITEA_URL/api/v1/repos/ideabile/{repo}/pulls" \\
     -H "Authorization: token $GITEA_TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{"title":"...","body":"...","head":"feat/my-feature","base":"main"}'
   \`\`\`
6. Notify Mauro on Telegram:
   \`\`\`
   curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \\
     -H "Content-Type: application/json" \\
     -d '{"chat_id":"'"$TELEGRAM_CHAT_ID"'","text":"...","parse_mode":"Markdown"}'
   \`\`\`

## Important rules

- NEVER look for tokens, query databases, or read config files for credentials. They are in your environment variables.
- If a tool call fails, read the error and fix the specific issue. Don't abandon your approach.
- You CAN write code directly. Write clean, minimal changes.
- Be concise. Do the work, then report results. Don't narrate each step.

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

// Configure git credentials globally so Claude Code's Bash can use git with auth
const configureGit = async () => {
  try {
    execSync('git config --global user.name "Gigi"')
    execSync('git config --global user.email "gigi@cluster.local"')

    // SSH key — mounted as Docker secret at /run/secrets/gigi_ssh_key
    const sshKeyPath = '/run/secrets/gigi_ssh_key'
    if (existsSync(sshKeyPath)) {
      const sshDir = resolve(homedir(), '.ssh')
      mkdirSync(sshDir, { recursive: true })
      chmodSync(sshDir, 0o700)
      const keyDest = resolve(sshDir, 'id_ed25519')
      writeFileSync(keyDest, readFileSync(sshKeyPath, 'utf8'))
      chmodSync(keyDest, 0o600)
      writeFileSync(resolve(sshDir, 'config'), 'Host 192.168.1.80\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n')
      console.log('[agent] SSH key configured from Docker secret')
    }

    // HTTP token — from database config
    const giteaUrl = await getConfig('gitea_url')
    const giteaToken = await getConfig('gitea_token')
    if (giteaUrl && giteaToken) {
      execSync(`git config --global http.${giteaUrl}/.extraheader "Authorization: token ${giteaToken}"`)
      console.log('[agent] HTTP git credentials configured')
    }
  } catch (err) {
    console.error('[agent] git config failed:', err.message)
  }
}

let configured = false

const ensureReady = async () => {
  const token = await getConfig('claude_oauth_token')
  if (!token) throw new Error('Claude not configured — complete setup first')
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token

  if (!configured) {
    await configureGit()
    configured = true
  }
}

// Collect env vars for Claude Code subprocess
const getAgentEnv = async () => {
  const giteaUrl = await getConfig('gitea_url') || ''
  const giteaToken = await getConfig('gitea_token') || ''
  const telegramToken = await getConfig('telegram_bot_token') || ''
  const chatId = await getConfig('telegram_chat_id') || ''

  return {
    ...process.env,
    GITEA_URL: giteaUrl,
    GITEA_TOKEN: giteaToken,
    TELEGRAM_BOT_TOKEN: telegramToken,
    TELEGRAM_CHAT_ID: chatId
  }
}

export const resetClient = () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  configured = false
}

export const runAgent = async (messages, onChunk) => {
  await ensureReady()

  // Format conversation history into a single prompt
  const prompt = messages
    .map(m => {
      const text = Array.isArray(m.content)
        ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
        : (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      return `${m.role === 'user' ? 'Mauro' : 'Gigi'}: ${text}`
    })
    .join('\n\n')

  const env = await getAgentEnv()
  let fullText = ''

  try {
    const response = query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        env,
        cwd: '/workspace',
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
