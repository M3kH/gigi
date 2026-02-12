import { query } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from './store.js'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'

const SYSTEM_PROMPT = `You are Gigi, a persistent AI coordinator running on a TuringPi cluster.
You help Mauro build, deploy, and maintain projects.

## Execution Context

**CRITICAL: You are running inside a custom chat interface that Mauro controls.**

This means:
- The chat UI you're running in is NOT the standard Claude Code interface
- Mauro can modify the frontend to add custom features (like embedding a Kanban board)
- You can modify your own behavior by creating PRs to the \`gigi\` repo
- Your source code lives at \`/app\` (production) and can be cloned from \`http://192.168.1.80:3000/idea/gigi.git\`
- Changes to \`gigi\` require a PR → merge → container restart to take effect
- The chat interface frontend code is likely in \`/workspace/gigi/web/\` or similar

**When Mauro asks you to change your own abilities or the chat interface:**
1. Clone the gigi repo to /workspace/gigi
2. Explore the relevant code (agent.js for your prompt, web/ for UI)
3. Make the changes
4. Create a PR
5. Notify Mauro via Telegram

You have full agency to improve yourself through the PR workflow.

## Your tools

You have Claude Code tools (Bash, Read, Write, Edit, Glob, Grep) plus MCP tools:
- \`gitea\` — Create PRs, repos, issues, comments (auth is automatic)
- \`telegram_send\` — Send messages to Mauro on Telegram

Git credentials are PRE-CONFIGURED. Just run git commands directly.

## Environment variables available

- \`GITEA_TOKEN\` — Gitea API token (for direct curl if needed)
- \`GITEA_URL\` — Gitea base URL (http://192.168.1.80:3000)
- Git is pre-configured with identity and auth

## How to create a PR

1. \`git clone http://192.168.1.80:3000/idea/{repo}.git /workspace/{repo}\`
2. \`cd /workspace/{repo} && git checkout -b feat/my-feature\`
3. Use Write/Edit to create/modify files
4. \`cd /workspace/{repo} && git add -A && git commit -m "..." && git push -u origin feat/my-feature\`
5. Create PR via MCP gitea tool:
   \`\`\`
   Use the gitea tool with action: "create_pr"
   owner: "idea", repo: "{repo}"
   title: "...", body: "...", head: "feat/my-feature", base: "main"
   \`\`\`
   **IMPORTANT**: Include "Closes #N" in the PR body to link to the issue
6. Notify Mauro via MCP telegram_send tool:
   \`\`\`
   Use the telegram_send tool with text: "✅ PR created: [title](url)"
   \`\`\`

## Project Board & Label Workflow

All issues should be tracked on the "idea Command Center" project board (project ID: 2).

### When working with issues:

1. **Loading an issue** (\`/issue repo#N\`): Automatically adds to project board if not already there
2. **Starting work**: Update status to \`status/in-progress\`
3. **Creating a PR**: Update status to \`status/review\`
4. **Closing an issue**: Update status to \`status/done\`

### Required labels for new issues:
- **Type**: \`type/feature\`, \`type/bug\`, \`type/docs\`, \`type/refactor\`, etc.
- **Status**: \`status/ready\`, \`status/in-progress\`, \`status/review\`, etc.
- **Optional**: \`priority/*\`, \`scope/*\`, \`size/*\`

### Use project_manager.js functions:
- \`syncIssueStatus(repo, number, 'status/in-progress')\` - Updates both label and board column
- \`updateIssueLabels(repo, number, ['type/feature'], [])\` - Add/remove labels
- \`ensureIssueTracked(repo, number)\` - Ensure issue is on board

See \`docs/GITEA_WORKFLOW.md\` for complete documentation.

## Important rules

- NEVER query databases or read config files for credentials. Use MCP tools or env vars.
- **CRITICAL: If ANY tool call fails, you MUST:**
  1. Read the error message carefully
  2. Understand WHY it failed
  3. Fix the specific issue (e.g., wrong path, missing file, syntax error)
  4. Retry or continue with the corrected approach
  5. NEVER stop or give up after a single failure
  6. Example: If "cd gigi" fails because you're already in /workspace/gigi, just run the command without cd
- You CAN write code directly. Write clean, minimal changes.
- Be concise. Do the work, then report results. Don't narrate each step.

## Task completion loop (CRITICAL)

When Mauro asks you to do something, ALWAYS complete the loop:
1. **If you made code changes** → Create a PR and notify via telegram_send
2. **If it's a question** → Just answer and notify via telegram_send with summary
3. **Never stop mid-task** → If you find yourself explaining what you'll do, STOP and DO it instead

Checklist for every code task:
- [ ] Made changes to files
- [ ] Committed and pushed to feature branch
- [ ] Created PR via gitea tool
- [ ] Sent Telegram notification with PR link

If you realize you haven't completed the checklist, continue immediately.

## Team

- Guglielmo: org-press core developer (meticulous, pragmatic)
- Rugero: website maintainer (creative, design-focused)

## Infrastructure

- TuringPi v2: 3 ARM64 nodes (worker-0: .110, worker-1: .111, worker-2: .112)
- Gitea: http://192.168.1.80:3000 (all repos under idea/)
- Domains: *.cluster.local (internal), *.ideable.dev (external)
- Your source: /app, your workspace: /workspace
- Docker service: idea-biancifiore-gigi_gigi

## Repos (all idea/ on Gitea)

gigi (this service), org-press, website, biancifiore, deploy-docker-compose, deploy-site

## Response format hint
On your first reply in a new conversation, begin with [title: brief 3-5 word description] on its own line.

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

export const runAgent = async (messages, onEvent, { sessionId = null, signal = null } = {}) => {
  await ensureReady()
  const env = await getAgentEnv()

  // Handle abort signal by throwing AbortError
  if (signal?.aborted) {
    const err = new Error('Agent aborted before start')
    err.name = 'AbortError'
    throw err
  }

  let abortHandler = null
  if (signal) {
    abortHandler = () => {
      const err = new Error('Agent aborted by user')
      err.name = 'AbortError'
      throw err
    }
    signal.addEventListener('abort', abortHandler)
  }

  const formatMessages = (msgs) => msgs
    .map(m => {
      const text = Array.isArray(m.content)
        ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
        : (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      return `${m.role === 'user' ? 'Mauro' : 'Gigi'}: ${text}`
    })
    .join('\n\n')

  let fullText = ''
  let capturedSessionId = null
  const toolCalls = []
  const toolResults = {}
  const startTime = Date.now()
  let turns = 0

  // Track tool failures for retry limit (max 3 retries per tool+input combination)
  const toolFailures = new Map() // key: `${toolName}:${JSON.stringify(input)}`, value: retry count

  const processResponse = async (response) => {
    for await (const message of response) {
      if (!capturedSessionId && message.session_id) {
        capturedSessionId = message.session_id
      }

      if (message.type === 'assistant' && message.message?.content) {
        turns++
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text
            if (onEvent) onEvent({ type: 'text_chunk', text: block.text })
          }
          if (block.type === 'tool_use') {
            const tc = { toolUseId: block.id, name: block.name, input: block.input }
            toolCalls.push(tc)
            if (onEvent) onEvent({ type: 'tool_use', ...tc })
          }
        }
      }

      if (message.type === 'user' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'tool_result') {
            const resultContent = Array.isArray(block.content)
              ? block.content.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('')
              : (typeof block.content === 'string' ? block.content : JSON.stringify(block.content))
            toolResults[block.tool_use_id] = resultContent
            if (onEvent) onEvent({ type: 'tool_result', toolUseId: block.tool_use_id, result: resultContent })
          }
        }
      }

      if (message.type === 'result') {
        if (message.result) fullText = message.result
        const duration = Date.now() - startTime
        if (onEvent) onEvent({
          type: 'agent_done',
          cost: message.cost_usd ?? null,
          duration,
          turns,
          isError: !!message.is_error
        })
      }
    }
  }

  const baseOptions = {
    systemPrompt: SYSTEM_PROMPT,
    model: 'claude-opus-4-20250514',
    env,
    cwd: '/workspace',
    maxTurns: 20,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    persistSession: true,
    stderr: (data) => console.error('[claude-code]', data.toString().trim()),
    hooks: {
      PostToolUseFailure: [{
        hooks: [async (input) => {
          const failureKey = `${input.tool_name}:${JSON.stringify(input.tool_input)}`
          const retryCount = (toolFailures.get(failureKey) || 0) + 1
          toolFailures.set(failureKey, retryCount)

          console.log(`[agent] Tool ${input.tool_name} failed (attempt ${retryCount}/3): ${input.error}`)

          // After 3 failures, ask for help instead of continuing blindly
          if (retryCount >= 3) {
            return {
              systemMessage: `The ${input.tool_name} tool has failed ${retryCount} times with the same input: "${input.error}"

This suggests a deeper issue that automatic retry cannot fix. You should:
1. Explain to Mauro what you were trying to do
2. Explain why it's failing repeatedly (based on error analysis)
3. Suggest alternative approaches or ask for guidance
4. Do NOT retry the exact same command again

Be honest about the blocker and ask for help.`
            }
          }

          // Special handling for Bash exit code failures
          if (input.tool_name === 'Bash' && input.error?.includes('Exit code')) {
            const isBashFailure = /Exit code (\d+)/.test(input.error)

            if (isBashFailure) {
              return {
                systemMessage: `Bash command failed with exit code (attempt ${retryCount}/3): "${input.error}"

**CRITICAL: Investigate and decide next steps:**

1. **Read the actual output** - Exit codes don't always mean failure. Check the command output carefully.
   - Exit code 1 for "npm list" just means package not in tree format - output may still be valid
   - Exit code 1 for "grep" means no matches found - this might be expected
   - Non-zero exit doesn't always mean the task failed

2. **Analyze the error:**
   - Is this related to your changes? Try to fix it.
   - Is this a pre-existing issue? Document it but continue if non-essential.
   - Is this blocking your current task? Try alternative approaches.

3. **Decision tree:**
   - ✅ Output has useful info despite exit code? Continue with the task.
   - ✅ Error is unrelated to task? Note it and proceed.
   - ⚠️ Error blocks your task? Try alternative command/approach.
   - ❌ Tried fixes but still broken AND essential? Ask Mauro for help.

**Be fault-resilient:** Don't stop at first exit code failure. Investigate, adapt, continue.

${retryCount === 2 ? '⚠️ This is your 2nd attempt. If still blocked, explain the issue to Mauro.' : ''}`
              }
            }
          }

          // For first 2 failures, provide recovery guidance
          return {
            systemMessage: `The ${input.tool_name} tool failed (attempt ${retryCount}/3): "${input.error}"

Analyze the error, understand why it failed, fix the specific issue, and continue. Common fixes:
- Bash "cd failed": You're already in the right directory, just run the command without cd
- File not found: Check the path, use Read/Glob to verify
- Syntax error: Fix the syntax and retry
- Permission denied: Use correct permissions or alternative approach

${retryCount === 2 ? '⚠️ This is your 2nd attempt. If it fails again, you will need to ask Mauro for help.' : 'Now continue with your task.'}`
          }
        }]
      }]
    }
  }

  try {
    if (sessionId) {
      try {
        const lastMsg = messages[messages.length - 1]
        const prompt = formatMessages([lastMsg])
        console.log('[agent] Resuming session:', sessionId)
        const response = query({ prompt, options: { ...baseOptions, resume: sessionId } })
        await processResponse(response)
        return { content: [{ type: 'text', text: fullText }], text: fullText, toolCalls, toolResults, sessionId: capturedSessionId }
      } catch (err) {
        console.warn('[agent] Session resume failed, falling back to fresh:', err.message)
        fullText = ''
        capturedSessionId = null
        toolCalls.length = 0
        Object.keys(toolResults).forEach(k => delete toolResults[k])
      }
    }

    const prompt = formatMessages(messages)
    const response = query({ prompt, options: baseOptions })
    await processResponse(response)
  } catch (err) {
    console.error('[agent] query failed:', err)
    fullText = `Error: ${err.message}`
    if (onEvent) onEvent({ type: 'agent_done', cost: null, duration: Date.now() - startTime, turns, isError: true })
  }

  // Cleanup abort handler
  if (signal && abortHandler) {
    signal.removeEventListener('abort', abortHandler)
  }

  return {
    content: [{ type: 'text', text: fullText }],
    text: fullText,
    toolCalls,
    toolResults,
    sessionId: capturedSessionId
  }
}
