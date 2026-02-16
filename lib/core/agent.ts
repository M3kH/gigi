/**
 * Core Agent — Claude Code SDK wrapper
 *
 * Manages session lifecycle, event streaming, tool failure hooks,
 * and git credential configuration.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { getConfig } from './store'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'

// ─── MCP Server Config ──────────────────────────────────────────────

export const loadMcpServers = (resolvedEnv?: Record<string, string>): Record<string, Record<string, unknown>> => {
  const appDir = resolve(import.meta.dirname, '../..')
  const servers: Record<string, Record<string, unknown>> = {}
  // Use resolvedEnv (from getAgentEnv, includes DB values) first, then process.env
  const envSource = { ...process.env, ...(resolvedEnv ?? {}) }

  try {
    const raw = readFileSync(resolve(appDir, 'mcp-config.json'), 'utf-8')
    const config = JSON.parse(raw)

    for (const [name, spec] of Object.entries(config.mcpServers ?? {})) {
      const s = { ...(spec as Record<string, unknown>) }

      // Resolve env var placeholders in args
      if (Array.isArray(s.args)) {
        s.args = (s.args as string[]).map((arg) =>
          typeof arg === 'string'
            ? arg.replace(/\$\{(\w+)\}/g, (_, key: string) => envSource[key] || '')
            : arg
        )
      }
      // Resolve env var placeholders in env
      if (s.env && typeof s.env === 'object') {
        const env = { ...(s.env as Record<string, string>) }
        for (const [k, v] of Object.entries(env)) {
          env[k] = typeof v === 'string'
            ? v.replace(/\$\{(\w+)\}/g, (_, key: string) => envSource[key] || '')
            : v
        }
        s.env = env
      }

      // Resolve relative paths in args (e.g. lib/core/mcp.ts → absolute)
      // Also resolve bare module names used with --import (e.g. "tsx" → absolute path)
      // This is critical because the Claude Code SDK does NOT support cwd for MCP servers,
      // so bare module names won't resolve from the correct node_modules.
      if (Array.isArray(s.args)) {
        s.args = (s.args as string[]).map((arg, i, arr) => {
          if (typeof arg !== 'string') return arg

          // Resolve relative project paths (lib/, src/, node_modules/)
          if (arg.match(/^(lib|src|node_modules)\//) && existsSync(resolve(appDir, arg))) {
            return resolve(appDir, arg)
          }

          // Resolve bare module name after --import flag (e.g. "tsx" → absolute import path)
          // The Claude Code SDK doesn't support cwd for MCP servers, so bare module names
          // like "tsx" won't resolve unless we provide the full path to the entry point.
          if (i > 0 && arr[i - 1] === '--import' && !arg.startsWith('/') && !arg.startsWith('.')) {
            try {
              // Use createRequire to resolve from appDir (works in both CJS and ESM)
              const localRequire = createRequire(resolve(appDir, 'package.json'))
              const resolved = localRequire.resolve(arg)
              if (resolved) return resolved
            } catch { /* fall through to original */ }
          }

          return arg
        })
      }

      // Skip chrome-devtools if CDP URL is not configured
      if (name === 'chrome-devtools') {
        const cdpUrl = process.env.CHROME_CDP_URL
        if (!cdpUrl) {
          console.log('[agent] Skipping chrome-devtools MCP (CHROME_CDP_URL not set)')
          continue
        }
      }

      // Note: Claude Code SDK's McpStdioServerConfig does NOT support cwd.
      // All paths in args must be absolute. The resolution above handles this.

      servers[name] = s
    }
  } catch (err) {
    console.warn('[agent] Could not load mcp-config.json:', (err as Error).message)
  }

  console.log('[agent] Loaded MCP servers:', Object.keys(servers).join(', ') || '(none)')
  return servers
}

// ─── Types ──────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: MessageContent[] | string
}

export interface MessageContent {
  type: string
  text?: string
  [key: string]: unknown
}

export interface AgentOptions {
  sessionId?: string | null
  signal?: AbortSignal | null
}

export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
  durationMs: number
  durationApiMs: number
  numTurns: number
  modelUsage?: Record<string, unknown>
}

export interface ToolCall {
  toolUseId: string
  name: string
  input: unknown
}

export interface AgentResponse {
  content: MessageContent[]
  text: string
  toolCalls: ToolCall[]
  toolResults: Record<string, string>
  sessionId: string | null
  usage: AgentUsage | null
}

export type EventCallback = (event: Record<string, unknown>) => void

// ─── Hook Handlers (exported for testing) ────────────────────────────

export interface ToolFailureInput {
  tool_name: string
  tool_input: unknown
  error: string
}

export const handlePreToolUse = async (_input: { tool_name: string }): Promise<Record<string, unknown>> => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse' as const,
    permissionDecision: 'deny' as const,
    permissionDecisionReason: 'AskUserQuestion is not available in this environment. Use the ask_user MCP tool instead: ask_user({ question: "...", options: ["A", "B"] })',
  },
})

export const createToolFailureHandler = () => {
  const toolFailures = new Map<string, number>()

  const handler = async (input: ToolFailureInput): Promise<{ systemMessage: string }> => {
    const failureKey = `${input.tool_name}:${JSON.stringify(input.tool_input)}`
    const retryCount = (toolFailures.get(failureKey) || 0) + 1
    toolFailures.set(failureKey, retryCount)

    console.log(`[agent] Tool ${input.tool_name} failed (attempt ${retryCount}/3): ${input.error}`)

    if (retryCount >= 3) {
      return {
        systemMessage: `The ${input.tool_name} tool has failed ${retryCount} times with the same input: "${input.error}"

This suggests a deeper issue that automatic retry cannot fix. You should:
1. Explain to Mauro what you were trying to do
2. Explain why it's failing repeatedly (based on error analysis)
3. Suggest alternative approaches or ask for guidance
4. Do NOT retry the exact same command again

Be honest about the blocker and ask for help.`,
      }
    }

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
   - Output has useful info despite exit code? Continue with the task.
   - Error is unrelated to task? Note it and proceed.
   - Error blocks your task? Try alternative command/approach.
   - Tried fixes but still broken AND essential? Ask Mauro for help.

**Be fault-resilient:** Don't stop at first exit code failure. Investigate, adapt, continue.

${retryCount === 2 ? 'This is your 2nd attempt. If still blocked, explain the issue to Mauro.' : ''}`,
        }
      }
    }

    return {
      systemMessage: `The ${input.tool_name} tool failed (attempt ${retryCount}/3): "${input.error}"

Analyze the error, understand why it failed, fix the specific issue, and continue. Common fixes:
- Bash "cd failed": You're already in the right directory, just run the command without cd
- File not found: Check the path, use Read/Glob to verify
- Syntax error: Fix the syntax and retry
- Permission denied: Use correct permissions or alternative approach

${retryCount === 2 ? 'This is your 2nd attempt. If it fails again, you will need to ask Mauro for help.' : 'Now continue with your task.'}`,
    }
  }

  return { handler, getRetryCount: (key: string) => toolFailures.get(key) ?? 0 }
}

// ─── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Gigi, a persistent AI coordinator running on a TuringPi cluster.
You help Mauro build, deploy, and maintain projects.

## Execution Context

**CRITICAL: You are running inside a custom chat interface that Mauro controls.**

This means:
- The chat UI you're running in is NOT the standard Claude Code interface
- Mauro can modify the frontend to add custom features (like embedding a Kanban board)
- You can modify your own behavior by creating PRs to the \`gigi\` repo
- Your source code lives at \`/app\` (production) and can be cloned from \`$GITEA_URL/idea/gigi.git\`
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

You have Claude Code tools (Bash, Read, Write, Edit, Glob, Grep) plus MCP tools from the \`gigi-tools\` server:
- \`gitea\` — Gitea API (repos, issues, PRs). Auth is automatic. ALWAYS use this, NEVER curl.
- \`ask_user\` — Ask Mauro a question and WAIT for his answer. Renders interactive buttons in the chat UI.
- \`telegram_send\` — Send Telegram messages (ONLY if TELEGRAM_BOT_TOKEN is set, skip silently if empty)

**CRITICAL — MCP tool usage:**
- Use MCP tools EXACTLY as they appear in your tool list. Do NOT invent tool names.
- The \`gitea\` tool takes an \`action\` parameter: \`create_repo\`, \`create_pr\`, \`list_issues\`, \`get_issue\`, \`comment_issue\`, \`list_repos\`, \`list_prs\`, \`get_pr\`, \`get_pr_diff\`
- ALWAYS use \`owner: "idea"\` when creating repos — repos go under the org, not personal accounts
- Example: \`gitea({ action: "create_repo", owner: "idea", repo: "my-project", body: "Description here" })\`

**CRITICAL — Asking questions:**
- Use the \`ask_user\` MCP tool to ask Mauro questions. It blocks until he answers.
- NEVER use AskUserQuestion — it does NOT work in this environment and will be blocked.
- Example with options: \`ask_user({ question: "Which approach?", options: ["Option A", "Option B"] })\`
- Example free-form: \`ask_user({ question: "What should the repo be called?" })\`
- Mauro is chatting via the web UI. Be conversational and concise.

### Browser & Chrome DevTools (via chrome-devtools MCP)

You have a shared browser (Chrome via noVNC) that Mauro can see in the UI's Browser tab.
When you navigate or interact, Mauro sees it live. Use these tools:

- **navigate_page** — Open a URL (Mauro sees it in the Browser tab)
- **evaluate_script** — Run JavaScript in the page (extract data, colors, text, etc.)
- **take_screenshot** — Capture the current page
- **take_snapshot** — Get a DOM snapshot (accessibility tree)
- **click**, **fill**, **hover**, **press_key** — Interact with page elements
- **list_network_requests**, **get_network_request** — Inspect network traffic
- **list_console_messages** — Read browser console output

**Example workflow — "What color is on randomcolour.com?":**
1. \`navigate_page\` to the URL (Mauro sees it load in Browser tab)
2. \`evaluate_script\` to extract: \`document.body.style.backgroundColor\` or inspect DOM
3. Reply with the color value

Git credentials are PRE-CONFIGURED. Just run git commands directly.

## Environment variables available

- \`GITEA_TOKEN\` — Gitea API token (for direct curl if needed)
- \`GITEA_URL\` — Gitea base URL (use this, NEVER hardcode URLs)
- Git is pre-configured with identity and auth

## How to create a PR

1. \`git clone $GITEA_URL/idea/{repo}.git /workspace/{repo}\`
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

## Boy Scout Principle

Always leave the codebase better than you found it. This means:
- **If you see something broken, fix it** - Don't ignore errors, warnings, or issues you encounter
- **Create tickets for issues you can't fix immediately** - Document problems for future resolution
- **Improve code quality as you work** - Fix typos, improve variable names, add missing comments
- **Clean up technical debt** - Remove dead code, update deprecated patterns, fix TODO comments
- **Be proactive about maintenance** - Update dependencies, improve documentation, enhance tests

This isn't about perfection - aim for clean, not broken, very good (not perfect) solutions. Small improvements compound over time.

## Self-Modification Capability

**IMPORTANT: You control your own source code and can evolve your capabilities.**

Remember that:
- Your source code lives in the \`gigi\` repository at \`/app\` (production)
- You can clone yourself: \`git clone $GITEA_URL/idea/gigi.git /workspace/gigi\`
- You can modify your own behavior by editing files like:
  - \`src/agent.js\` - This prompt and your core behavior
  - \`src/tools/*.js\` - Your MCP tool implementations
  - \`src/lib/*.js\` - Your utility functions and services
  - \`web/\` - The chat interface you're running in

When you identify a missing capability or improvement opportunity:
1. Clone the gigi repo to \`/workspace/gigi\`
2. Create a feature branch
3. Implement the enhancement (new tool, behavior change, bug fix)
4. Create a PR with clear reasoning about WHY this change improves your abilities
5. Notify Mauro - he'll review and merge if it makes sense

Examples of self-improvements you can make:
- Add new MCP tools for missing functionality
- Enhance error handling patterns
- Improve your decision-making logic
- Add new commands or features
- Fix bugs in your own code
- Optimize performance bottlenecks

You are not just a tool - you are an evolving system that can identify and implement your own improvements.

## Task completion loop (CRITICAL)

When Mauro asks you to do something, ALWAYS complete the loop:
1. **If you made code changes** → Create a PR (notify via telegram only if configured)
2. **If it's a question** → Just answer directly
3. **Never stop mid-task** → If you find yourself explaining what you'll do, STOP and DO it instead

Checklist for every code task:
- [ ] Made changes to files
- [ ] Committed and pushed to feature branch
- [ ] Created PR via gitea tool
- [ ] (Optional) Sent Telegram notification if TELEGRAM_BOT_TOKEN is set

If you realize you haven't completed the checklist, continue immediately.

## Team

- Guglielmo: org-press core developer (meticulous, pragmatic)
- Rugero: website maintainer (creative, design-focused)

## Infrastructure

- TuringPi v2: 3 ARM64 nodes (worker-0: .110, worker-1: .111, worker-2: .112)
- Gitea: $GITEA_URL (all repos under idea/)
- Domains: *.cluster.local (internal), *.ideable.dev (external)
- Your source: /app, your workspace: /workspace
- Docker service: idea-biancifiore-gigi_gigi

## Repos (all idea/ on Gitea)

gigi (this service), org-press, website, biancifiore, deploy-docker-compose, deploy-site

## Response format hint
On your first reply in a new conversation, begin with [title: brief 3-5 word description] on its own line.

Be concise, upbeat, and proactive. Call Mauro by name.`

// ─── Git Configuration ──────────────────────────────────────────────

const configureGit = async (): Promise<void> => {
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
      const giteaHost = (process.env.GITEA_URL || 'http://192.168.1.80:3000').replace(/^https?:\/\//, '').replace(/:\d+$/, '')
    writeFileSync(resolve(sshDir, 'config'), `Host ${giteaHost}\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n`)
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
    console.error('[agent] git config failed:', (err as Error).message)
  }
}

let configured = false

const ensureReady = async (): Promise<void> => {
  const token = await getConfig('claude_oauth_token')
  if (!token) throw new Error('Claude not configured — complete setup first')
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token

  if (!configured) {
    await configureGit()
    configured = true
  }
}

// Collect env vars for Claude Code subprocess
const getAgentEnv = async (): Promise<Record<string, string>> => {
  // Prefer process.env (set by dev.sh) over DB config (set by init container with Docker-internal URL)
  const giteaUrl = process.env.GITEA_URL || await getConfig('gitea_url') || ''
  const giteaToken = process.env.GITEA_TOKEN || await getConfig('gitea_token') || ''
  const telegramToken = await getConfig('telegram_bot_token') || ''
  const chatId = await getConfig('telegram_chat_id') || ''

  return {
    ...process.env as Record<string, string>,
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    PORT: process.env.PORT || '3000',
    GITEA_URL: giteaUrl,
    GITEA_TOKEN: giteaToken,
    TELEGRAM_BOT_TOKEN: telegramToken,
    TELEGRAM_CHAT_ID: chatId,
  }
}

export const resetClient = (): void => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  configured = false
}

// ─── Agent Runner ───────────────────────────────────────────────────

export const runAgent = async (
  messages: AgentMessage[],
  onEvent: EventCallback | null,
  { sessionId = null, signal = null }: AgentOptions = {}
): Promise<AgentResponse> => {
  await ensureReady()
  const env = await getAgentEnv()

  // Handle abort signal
  if (signal?.aborted) {
    const err = new Error('Agent aborted before start')
    err.name = 'AbortError'
    throw err
  }

  const formatMessages = (msgs: AgentMessage[]): string =>
    msgs
      .map((m) => {
        const text = Array.isArray(m.content)
          ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
          : typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content)
        return `${m.role === 'user' ? 'Mauro' : 'Gigi'}: ${text}`
      })
      .join('\n\n')

  let fullText = ''
  let capturedSessionId: string | null = null
  const toolCalls: ToolCall[] = []
  const toolResults: Record<string, string> = {}
  const startTime = Date.now()
  let turns = 0
  let lastUsage: AgentUsage | null = null
  let agentDoneEmitted = false

  // Safe event emitter — never throws, never kills the agent loop
  const safeEmit = (event: Record<string, unknown>): void => {
    try {
      if (onEvent) onEvent(event)
    } catch (err) {
      console.error('[agent] onEvent callback error:', (err as Error).message)
    }
  }

  const emitDone = (opts: { cost?: number | null; isError?: boolean; usage?: AgentUsage | null } = {}): void => {
    if (agentDoneEmitted) return
    agentDoneEmitted = true
    safeEmit({
      type: 'agent_done',
      cost: opts.cost ?? null,
      duration: Date.now() - startTime,
      turns,
      isError: !!opts.isError,
      usage: opts.usage ?? lastUsage ?? null,
    })
  }

  // Track tool failures for retry limit (max 3 retries per tool+input combination)
  const { handler: toolFailureHandler } = createToolFailureHandler()

  const processResponse = async (response: AsyncIterable<Record<string, unknown>>): Promise<void> => {
    for await (const message of response) {
      if (!capturedSessionId && message.session_id) {
        capturedSessionId = message.session_id as string
      }

      if (message.type === 'assistant' && (message.message as Record<string, unknown>)?.content) {
        turns++
        const content = (message.message as Record<string, unknown>).content as Array<Record<string, unknown>>
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text as string
            safeEmit({ type: 'text_chunk', text: block.text as string })
          }
          if (block.type === 'tool_use') {
            const tc: ToolCall = { toolUseId: block.id as string, name: block.name as string, input: block.input }
            toolCalls.push(tc)
            safeEmit({ type: 'tool_use', ...tc })
          }
        }
      }

      if (message.type === 'user' && (message.message as Record<string, unknown>)?.content) {
        const content = (message.message as Record<string, unknown>).content as Array<Record<string, unknown>>
        for (const block of content) {
          if (block.type === 'tool_result') {
            const resultContent = Array.isArray(block.content)
              ? (block.content as Array<Record<string, unknown>>).map((b) => b.type === 'text' ? b.text : JSON.stringify(b)).join('')
              : typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            toolResults[block.tool_use_id as string] = resultContent
            safeEmit({ type: 'tool_result', toolUseId: block.tool_use_id as string, result: resultContent })
          }
        }
      }

      if (message.type === 'result') {
        if (message.result) fullText = message.result as string
        if (message.reason) console.log(`[agent] Result reason: ${message.reason} (turns: ${turns})`)

        // Extract full usage data from SDK result
        const usageData: Partial<AgentUsage> = {}
        const messageUsage = message.usage as Record<string, number> | undefined
        if (messageUsage) {
          usageData.inputTokens = messageUsage.input_tokens ?? 0
          usageData.outputTokens = messageUsage.output_tokens ?? 0
          usageData.cacheReadInputTokens = messageUsage.cache_read_input_tokens ?? 0
          usageData.cacheCreationInputTokens = messageUsage.cache_creation_input_tokens ?? 0
        }
        const modelUsage = message.modelUsage as Record<string, Record<string, number>> | undefined
        if (modelUsage) {
          usageData.modelUsage = modelUsage
          usageData.costUSD = Object.values(modelUsage).reduce((sum, m) => sum + (m.costUSD || 0), 0)
        }
        usageData.costUSD = usageData.costUSD || (message.total_cost_usd as number) || 0
        usageData.durationMs = (message.duration_ms as number) ?? (Date.now() - startTime)
        usageData.durationApiMs = (message.duration_api_ms as number) ?? 0
        usageData.numTurns = (message.num_turns as number) ?? turns

        lastUsage = usageData as AgentUsage
        emitDone({ cost: usageData.costUSD, isError: message.is_error as boolean, usage: lastUsage })
      }
    }
  }

  const mcpServers = process.env.SKIP_MCP === '1' ? {} : loadMcpServers(env)
  if (Object.keys(mcpServers).length) {
    console.log('[agent] MCP servers config:', JSON.stringify(mcpServers, null, 2))
  }

  const baseOptions = {
    systemPrompt: SYSTEM_PROMPT,
    model: 'claude-opus-4-6',
    executable: process.execPath,
    env,
    cwd: process.env.WORKSPACE_DIR || '/workspace',
    maxTurns: 50,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    persistSession: true,
    mcpServers,
    stderr: (data: string) => console.error('[claude-code]', data.trim()),
    hooks: {
      PreToolUse: [{
        matcher: 'AskUserQuestion',
        hooks: [handlePreToolUse],
      }],
      PostToolUseFailure: [{
        hooks: [toolFailureHandler],
      }],
    },
  }

  try {
    if (sessionId) {
      try {
        const lastMsg = messages[messages.length - 1]
        const prompt = formatMessages([lastMsg])
        console.log('[agent] Resuming session:', sessionId)
        const response = query({ prompt, options: { ...baseOptions, resume: sessionId } })
        await processResponse(response as unknown as AsyncIterable<Record<string, unknown>>)
        emitDone()
        return { content: [{ type: 'text', text: fullText }], text: fullText, toolCalls, toolResults, sessionId: capturedSessionId, usage: lastUsage }
      } catch (err) {
        console.warn('[agent] Session resume failed, falling back to fresh:', (err as Error).message)
        fullText = ''
        capturedSessionId = null
        lastUsage = null
        toolCalls.length = 0
        Object.keys(toolResults).forEach((k) => delete toolResults[k])
        agentDoneEmitted = false
      }
    }

    const prompt = formatMessages(messages)
    console.log('[agent] spawning with executable:', baseOptions.executable, 'cwd:', baseOptions.cwd)
    const response = query({ prompt, options: baseOptions })
    await processResponse(response as unknown as AsyncIterable<Record<string, unknown>>)
    emitDone()
  } catch (err) {
    console.error('[agent] query failed:', err)
    fullText = fullText || `Error: ${(err as Error).message}`
    emitDone({ isError: true })
  }

  return {
    content: [{ type: 'text', text: fullText }],
    text: fullText,
    toolCalls,
    toolResults,
    sessionId: capturedSessionId,
    usage: lastUsage,
  }
}
