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
import { getKnowledge } from './knowledge'
import { classifyMessage, MINIMAL_SYSTEM_PROMPT, type RoutingDecision } from './llm-router'
import { buildSystemPrompt, loadAgentConfig } from './prompt'

// Increase UV thread pool for concurrent TLS handshakes (ARM64 needs this for MCP tool token counting)
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '64'

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
  routing?: RoutingDecision | null
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

/** An ordered content block — text or tool_use — preserving interleaving for faithful replay */
export type InterleavedBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }

export interface AgentResponse {
  content: MessageContent[]
  text: string
  toolCalls: ToolCall[]
  toolResults: Record<string, string>
  /** Ordered content blocks preserving text/tool interleaving for faithful reload rendering */
  interleavedContent: InterleavedBlock[]
  sessionId: string | null
  usage: AgentUsage | null
  /** Why the agent stopped: 'end_turn' (natural), 'max_turns' (hit limit), or other SDK reasons */
  stopReason: string | null
}

export type EventCallback = (event: Record<string, unknown>) => void

// ─── Hook Handlers (exported for testing) ────────────────────────────

export interface ToolFailureInput {
  tool_name: string
  tool_input: unknown
  error: string
}

export const handlePreToolUse = async (_input: unknown): Promise<Record<string, unknown>> => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse' as const,
    permissionDecision: 'deny' as const,
    permissionDecisionReason: 'AskUserQuestion is not available in this environment. Use the ask_user MCP tool instead: ask_user({ question: "...", options: ["A", "B"] })',
  },
})

export const createToolFailureHandler = () => {
  const toolFailures = new Map<string, number>()

  const handler = async (rawInput: unknown): Promise<{ systemMessage: string }> => {
    const input = rawInput as ToolFailureInput
    const failureKey = `${input.tool_name}:${JSON.stringify(input.tool_input)}`
    const retryCount = (toolFailures.get(failureKey) || 0) + 1
    toolFailures.set(failureKey, retryCount)

    console.log(`[agent] Tool ${input.tool_name} failed (attempt ${retryCount}/3): ${input.error}`)

    if (retryCount >= 3) {
      return {
        systemMessage: `The ${input.tool_name} tool has failed ${retryCount} times with the same input: "${input.error}"

This suggests a deeper issue that automatic retry cannot fix. You should:
1. Explain to the operator what you were trying to do
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
   - Tried fixes but still broken AND essential? Ask the operator for help.

**Be fault-resilient:** Don't stop at first exit code failure. Investigate, adapt, continue.

${retryCount === 2 ? 'This is your 2nd attempt. If still blocked, explain the issue to the operator.' : ''}`,
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

${retryCount === 2 ? 'This is your 2nd attempt. If it fails again, you will need to ask the operator for help.' : 'Now continue with your task.'}`,
    }
  }

  return { handler, getRetryCount: (key: string) => toolFailures.get(key) ?? 0 }
}

// System prompt is now built dynamically from config — see lib/core/prompt.ts

// ─── Git Configuration ──────────────────────────────────────────────

const configureGit = async (): Promise<void> => {
  try {
    const agentConfig = loadAgentConfig()

    // When author override is set, use operator's identity for commits
    // and the agent appears only as Co-Authored-By in commit messages.
    const commitName = agentConfig.git.author?.name ?? agentConfig.git.name
    const commitEmail = agentConfig.git.author?.email ?? agentConfig.git.email
    execSync(`git config --global user.name "${commitName}"`)
    execSync(`git config --global user.email "${commitEmail}"`)

    if (agentConfig.git.author) {
      console.log(`[agent] Git author override: ${commitName} <${commitEmail}> (agent as Co-Author: ${agentConfig.git.name} <${agentConfig.git.email}>)`)
    }

    // SSH key — mounted as Docker secret at /run/secrets/gigi_ssh_key
    const sshKeyPath = '/run/secrets/gigi_ssh_key'
    if (existsSync(sshKeyPath)) {
      const sshDir = resolve(homedir(), '.ssh')
      mkdirSync(sshDir, { recursive: true })
      chmodSync(sshDir, 0o700)
      const keyDest = resolve(sshDir, 'id_ed25519')
      writeFileSync(keyDest, readFileSync(sshKeyPath, 'utf8'))
      chmodSync(keyDest, 0o600)
      const giteaHost = (process.env.GITEA_URL || 'http://localhost:3300').replace(/^https?:\/\//, '').replace(/:\d+$/, '')
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

  // OAuth tokens (sk-ant-oat*) use CLAUDE_CODE_OAUTH_TOKEN, API keys use ANTHROPIC_API_KEY
  if (token.startsWith('sk-ant-oat')) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = token
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  }

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

  // Strip CLAUDECODE to avoid "nested session" detection when running inside Claude Code
  const { CLAUDECODE, ...cleanEnv } = process.env as Record<string, string>

  return {
    ...cleanEnv,
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
  { sessionId = null, signal = null, routing = null }: AgentOptions = {}
): Promise<AgentResponse> => {
  await ensureReady()
  const env = await getAgentEnv()

  // Handle abort signal
  if (signal?.aborted) {
    const err = new Error('Agent aborted before start')
    err.name = 'AbortError'
    throw err
  }

  const agentConfig = loadAgentConfig()
  const formatMessages = (msgs: AgentMessage[]): string =>
    msgs
      .map((m) => {
        const text = Array.isArray(m.content)
          ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
          : typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content)
        return `${m.role === 'user' ? 'Operator' : agentConfig.name}: ${text}`
      })
      .join('\n\n')

  let fullText = ''
  let capturedSessionId: string | null = null
  const toolCalls: ToolCall[] = []
  const toolResults: Record<string, string> = {}
  const interleavedContent: InterleavedBlock[] = []
  const startTime = Date.now()
  let turns = 0
  let lastUsage: AgentUsage | null = null
  let agentDoneEmitted = false
  let resultReason: string | null = null

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
      routing: routing ? { complexity: routing.complexity, model: routing.model } : null,
    })
  }

  // Track tool failures for retry limit (max 3 retries per tool+input combination)
  const { handler: toolFailureHandler } = createToolFailureHandler()

  const processResponse = async (response: AsyncIterable<Record<string, unknown>>): Promise<void> => {
    for await (const message of response) {
      // Check abort signal each iteration so stop takes effect mid-stream
      if (signal?.aborted) {
        const err = new Error('Agent aborted')
        err.name = 'AbortError'
        throw err
      }
      if (!capturedSessionId && message.session_id) {
        capturedSessionId = message.session_id as string
      }

      if (message.type === 'assistant' && (message.message as Record<string, unknown>)?.content) {
        turns++
        const content = (message.message as Record<string, unknown>).content as Array<Record<string, unknown>>
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text as string
            // Merge consecutive text blocks in interleaved content
            const lastBlock = interleavedContent[interleavedContent.length - 1]
            if (lastBlock && lastBlock.type === 'text') {
              lastBlock.text += block.text as string
            } else {
              interleavedContent.push({ type: 'text', text: block.text as string })
            }
            safeEmit({ type: 'text_chunk', text: block.text as string })
          }
          if (block.type === 'tool_use') {
            const tc: ToolCall = { toolUseId: block.id as string, name: block.name as string, input: block.input }
            toolCalls.push(tc)
            interleavedContent.push({ type: 'tool_use', toolUseId: tc.toolUseId, name: tc.name, input: tc.input })
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
        resultReason = (message.reason as string) || null
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

  const mcpServers = process.env.SKIP_MCP === '1' ? {} : loadMcpServers(env) as Record<string, never>
  if (Object.keys(mcpServers).length) {
    console.log('[agent] MCP servers config:', JSON.stringify(mcpServers, null, 2))
  }

  // ── Routing & Model Selection ──────────────────────────────────
  const route = routing ?? { complexity: 'complex', model: 'claude-opus-4-6', includeTools: true, maxTurns: 50, useMinimalPrompt: false, reason: 'default' } as RoutingDecision

  // Build system prompt: minimal for simple messages, full + knowledge for complex
  let systemPrompt: string
  if (route.useMinimalPrompt) {
    systemPrompt = MINIMAL_SYSTEM_PROMPT
    console.log(`[agent] Using MINIMAL prompt (${route.complexity}): ${route.reason}`)
  } else {
    // Build configurable prompt from template + config (async for dynamic context)
    const basePrompt = await buildSystemPrompt()

    // Load knowledge and inject into full prompt
    let knowledge = ''
    try {
      knowledge = await getKnowledge()
    } catch (err) {
      console.warn('[agent] Failed to load knowledge:', (err as Error).message)
    }
    systemPrompt = knowledge
      ? basePrompt + '\n\n## Knowledge Base\n\n' + knowledge
      : basePrompt
    console.log(`[agent] Using FULL prompt + knowledge (${route.complexity}): ${route.reason}`)
  }

  // Only include MCP tools if the route requires them
  const effectiveMcpServers = route.includeTools ? mcpServers : {} as Record<string, never>

  const baseOptions = {
    systemPrompt,
    model: route.model,
    executable: process.execPath as 'node' | 'bun' | 'deno',
    env,
    cwd: process.env.WORKSPACE_DIR || '/workspace',
    maxTurns: route.maxTurns,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    persistSession: true,
    mcpServers: effectiveMcpServers,
    extraArgs: {} as Record<string, string>,
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
        return { content: [{ type: 'text', text: fullText }], text: fullText, toolCalls, toolResults, interleavedContent, sessionId: capturedSessionId, usage: lastUsage, stopReason: resultReason }
      } catch (err) {
        console.warn('[agent] Session resume failed, falling back to fresh:', (err as Error).message)
        fullText = ''
        capturedSessionId = null
        lastUsage = null
        toolCalls.length = 0
        interleavedContent.length = 0
        Object.keys(toolResults).forEach((k) => delete toolResults[k])
        agentDoneEmitted = false
      }
    }

    const prompt = formatMessages(messages)
    console.log(`[agent] prompt: ${prompt.length} chars, model: ${baseOptions.model}, complexity: ${route.complexity}, maxTurns: ${route.maxTurns}`)
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
    interleavedContent,
    sessionId: capturedSessionId,
    usage: lastUsage,
    stopReason: resultReason,
  }
}

// ─── Lightweight LLM Query ──────────────────────────────────────────

/**
 * Simple one-shot LLM query — no tools, no MCP, no session persistence.
 *
 * Uses the same auth setup as runAgent (handles OAuth tokens and API keys)
 * but with minimal overhead. Ideal for summary generation, classification,
 * and other short text-in/text-out tasks.
 *
 * @param prompt - The user prompt text
 * @param systemPrompt - System instructions
 * @param model - Model to use (default: claude-haiku-4-5 for cost efficiency)
 * @returns The text response
 */
export const queryLLM = async (
  prompt: string,
  systemPrompt: string,
  model: string = 'claude-haiku-4-5'
): Promise<string> => {
  await ensureReady()
  const env = await getAgentEnv()

  let resultText = ''
  const response = query({
    prompt,
    options: {
      systemPrompt,
      model,
      executable: process.execPath as 'node' | 'bun' | 'deno',
      env,
      cwd: process.env.WORKSPACE_DIR || '/workspace',
      maxTurns: 1,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      mcpServers: {} as Record<string, never>,
      stderr: (data: string) => console.error('[queryLLM]', data.trim()),
    },
  })

  for await (const message of response as unknown as AsyncIterable<Record<string, unknown>>) {
    if (message.type === 'assistant' && (message.message as Record<string, unknown>)?.content) {
      const content = (message.message as Record<string, unknown>).content as Array<Record<string, unknown>>
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          resultText += block.text as string
        }
      }
    }
    if (message.type === 'result' && message.result) {
      resultText = message.result as string
    }
  }

  return resultText
}
