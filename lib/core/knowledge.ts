/**
 * Knowledge Prompt — Persistent learnings loaded into the agent's context
 *
 * Stores structured codebase knowledge, patterns, and solutions in the DB
 * so the agent doesn't need to re-explore from scratch every conversation.
 * This significantly reduces exploratory tool calls (grep, glob, read).
 *
 * Part of issue #21: Token optimization strategies.
 */

import { getConfig, setConfig } from './store'

const CONFIG_KEY = 'knowledge_prompt'

/**
 * Default knowledge base — bootstrapped on first load.
 * The agent can update this via the knowledge MCP tool (future).
 */
const DEFAULT_KNOWLEDGE = `## Codebase Knowledge (auto-updated)

### Architecture Quick Reference
- Entry: src/index.ts → boots HTTP (Hono), WS, Telegram, backup scheduler
- Agent: lib/core/agent.ts — Claude SDK wrapper, system prompt, runAgent()
- Router: lib/core/router.ts — message routing, session management, enforcer
- Store: lib/core/store.ts — PostgreSQL (config, conversations, messages)
- Frontend: web/app/ — Svelte 5 with runes, Vite build to dist/app/
- MCP tools: lib/tools/ (gitea, telegram, ask-user, browser via chrome-devtools)

### Key Patterns
- Sessions persist via conversations.session_id → Claude SDK resume
- Messages stored as JSONB with optional usage tracking
- Tool registry in lib/core/mcp.ts collects tools from lib/tools/
- Events flow: agent → EventBus → WebSocket → Svelte stores
- Gitea proxy at /gitea/* injects X-WEBAUTH-USER for iframe auth

### Common File Locations
- System prompt: lib/core/agent.ts (SYSTEM_PROMPT constant, ~460 lines)
- WS protocol schemas: lib/core/protocol.ts (Zod)
- Chat state: web/app/lib/stores/chat.svelte.ts
- Layout: web/app/components/AppShell.svelte (panels A/B/C/D/F)
- Kanban: web/app/components/GigiKanban.svelte
- Token display: web/app/components/chat/TokenBadge.svelte
- HTTP routes: lib/api/web.ts (Hono)
- Webhook handler: lib/api/webhookRouter.ts

### Infrastructure
- Gitea at $GITEA_URL with repos under the configured org
- Caddy reverse proxy with TLS

### Troubleshooting
- If MCP tools fail: check CHROME_CDP_URL for browser, GITEA_TOKEN for Gitea
- If sessions fail to resume: conversation.session_id may be stale, falls back to fresh
- If git push fails: check HTTP credentials via getConfig('gitea_token')
- Workspace convention: /workspace/gigi = main (read-only), /workspace/gigi-{branch} = work dir
`

/**
 * Load knowledge prompt from DB, or bootstrap with defaults.
 */
export const getKnowledge = async (): Promise<string> => {
  try {
    const stored = await getConfig(CONFIG_KEY)
    if (stored) return stored

    // Bootstrap with defaults
    await setConfig(CONFIG_KEY, DEFAULT_KNOWLEDGE)
    console.log('[knowledge] Bootstrapped default knowledge prompt')
    return DEFAULT_KNOWLEDGE
  } catch (err) {
    console.warn('[knowledge] Failed to load knowledge:', (err as Error).message)
    return DEFAULT_KNOWLEDGE
  }
}

/**
 * Update the knowledge prompt in the DB.
 * This allows the agent (or an admin) to evolve the knowledge base.
 */
export const updateKnowledge = async (content: string): Promise<void> => {
  await setConfig(CONFIG_KEY, content)
  console.log('[knowledge] Knowledge prompt updated')
}

/**
 * Append a new learning to the knowledge base.
 * Useful for incremental learning after tasks.
 */
export const appendKnowledge = async (learning: string): Promise<void> => {
  const current = await getKnowledge()
  const updated = current.trimEnd() + '\n\n### Recent Learning\n' + learning + '\n'
  await setConfig(CONFIG_KEY, updated)
  console.log('[knowledge] Appended new learning')
}
