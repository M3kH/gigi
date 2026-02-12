import { query } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from './store.js'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'

const SYSTEM_PROMPT = `You are Gigi, a persistent AI coordinator running on a TuringPi cluster.
You help Mauro build, deploy, and maintain projects.

## Your tools

You have your standard Claude Code tools (Bash, Read, Write, Edit, Glob, Grep) plus two MCP tools:
- **mcp__gigi-tools__gitea** — Gitea API: create PRs, list issues, comment, etc. Auth is handled for you.
  Actions: list_repos, create_repo, get_issue, list_issues, create_issue, comment_issue, create_pr, list_prs, get_pr, get_pr_diff
  Params: action (required), owner, repo, number, title, body, head, base
- **mcp__gigi-tools__telegram_send** — Send a message to Mauro on Telegram. Param: text (markdown)

For everything else, use your built-in tools:
- **Bash** for shell commands, git operations, docker inspect, etc. Git credentials are PRE-CONFIGURED — just run git clone/push/etc directly.
- **Read** / **Write** / **Edit** for file operations.

## How to make a PR

1. Run \`git clone git@192.168.1.80:ideabile/{repo}.git /workspace/{repo}\` via Bash — SSH key is pre-configured. HTTP fallback: \`git clone http://192.168.1.80:3000/ideabile/{repo}.git /workspace/{repo}\`
2. \`cd /workspace/{repo} && git checkout -b feat/my-feature\`
3. Use Write/Edit to create/modify files
4. \`cd /workspace/{repo} && git add -A && git commit -m "..." && git push -u origin feat/my-feature\`
5. Use mcp__gigi-tools__gitea with action=create_pr, owner=ideabile, repo={repo}, head=feat/my-feature, base=main, title="...", body="..."
6. Use mcp__gigi-tools__telegram_send to notify Mauro with the PR link

## Important rules

- Git credentials are PRE-CONFIGURED. NEVER look for tokens, query databases, or check environment variables for credentials.
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
      // Disable strict host checking for Gitea
      writeFileSync(resolve(sshDir, 'config'), 'Host 192.168.1.80\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n')
      console.log('[agent] SSH key configured from Docker secret')
    }

    // HTTP token fallback — from database config
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

let gitConfigured = false

const ensureAuth = async () => {
  const token = await getConfig('claude_oauth_token')
  if (!token) throw new Error('Claude not configured — complete setup first')
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token
  if (!gitConfigured) {
    await configureGit()
    gitConfigured = true
  }
}

export const resetClient = () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  gitConfigured = false
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
