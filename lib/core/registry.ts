/**
 * Core — Agent Tool Registry
 *
 * Convention-based tool discovery system (Option C from #64).
 *
 * Any lib/ module can export `agentTools: AgentTool[]` to make functions
 * callable by the agent. The registry collects them at startup and serves
 * them to the MCP server.
 *
 * Execution contexts:
 *   - "server"  — runs inside Gigi's Node process (Gitea API, DB, etc.)
 *   - "client"  — runs in the user's browser via WebSocket (scroll, highlight, etc.)
 *
 * Permission model:
 *   Each tool declares a permission namespace. For now all permissions
 *   resolve to `true`. Future iterations will add ask/allow/always modes
 *   with WebSocket confirmation flow (see #64 acceptance criteria).
 */

import { z, toJSONSchema } from 'zod'

// ─── Types ──────────────────────────────────────────────────────────

/** Where the tool handler executes */
export type ExecutionContext = 'server' | 'client'

/** Permission check result */
export interface PermissionResult {
  allowed: boolean
  reason?: string
}

/** Permission policy — extensible in future iterations */
export type PermissionPolicy = 'always_allow' | 'ask_every_time' | 'allow_for_session'

/**
 * The standard interface every lib/ module uses to expose agent-callable functions.
 *
 * Example:
 *   export const agentTools: AgentTool[] = [{
 *     name: 'gitea.list_repos',
 *     description: 'List all Gitea repositories',
 *     schema: z.object({}),
 *     handler: async () => listRepos(),
 *     context: 'server',
 *     permission: 'gitea.read',
 *   }]
 */
export interface AgentTool {
  /** Namespaced name: "module.action" (e.g. "gitea.create_pr", "view.navigate") */
  name: string

  /** Human-readable description for the agent */
  description: string

  /** Zod schema for input validation */
  schema: z.ZodType

  /** The function to execute. Receives validated input, returns result. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => Promise<unknown>

  /** Where this tool runs */
  context: ExecutionContext

  /** Permission namespace (e.g. "gitea.write", "view.navigate", "browser.control") */
  permission: string
}

/**
 * MCP-compatible tool definition (JSON Schema format).
 * Generated from AgentTool for the MCP tools/list response.
 */
export interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

// ─── Permission Engine ──────────────────────────────────────────────

/**
 * Permission settings per namespace.
 * In this iteration all default to 'always_allow'.
 * Future: persisted per-user in DB, configurable via UI settings.
 */
const permissionPolicies = new Map<string, PermissionPolicy>()

/**
 * Check if a tool action is permitted.
 *
 * Current behavior: always returns { allowed: true }.
 * Future: will check policy and potentially emit a permission_request
 * event via WebSocket, awaiting user confirmation.
 */
export const checkPermission = async (permission: string): Promise<PermissionResult> => {
  const policy = permissionPolicies.get(permission) ?? 'always_allow'

  switch (policy) {
    case 'always_allow':
      return { allowed: true }

    case 'allow_for_session':
      // Future: check session-scoped grant
      return { allowed: true }

    case 'ask_every_time':
      // Future: emit permission_request event, await response
      return { allowed: true }

    default:
      return { allowed: true }
  }
}

/**
 * Set the permission policy for a namespace.
 * Future: called from UI settings or API endpoint.
 */
export const setPermissionPolicy = (permission: string, policy: PermissionPolicy): void => {
  permissionPolicies.set(permission, policy)
}

/**
 * Get all registered permission namespaces and their policies.
 */
export const getPermissions = (): Record<string, PermissionPolicy> => {
  const result: Record<string, PermissionPolicy> = {}
  for (const [ns, policy] of permissionPolicies) {
    result[ns] = policy
  }
  return result
}

// ─── Zod → JSON Schema Conversion ──────────────────────────────────

/**
 * Convert a Zod schema to a JSON Schema object for MCP tool definitions.
 * Uses Zod 4's built-in toJSONSchema.
 */
const zodToJsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  try {
    return toJSONSchema(schema) as Record<string, unknown>
  } catch {
    return { type: 'object' }
  }
}

// ─── Tool Registry ──────────────────────────────────────────────────

/** All registered tools, keyed by name */
const tools = new Map<string, AgentTool>()

/**
 * Register a single tool. Throws if name already taken.
 */
export const registerTool = (tool: AgentTool): void => {
  if (tools.has(tool.name)) {
    throw new Error(`Agent tool "${tool.name}" already registered`)
  }
  tools.set(tool.name, tool)

  // Auto-register permission namespace with default policy
  if (!permissionPolicies.has(tool.permission)) {
    permissionPolicies.set(tool.permission, 'always_allow')
  }
}

/**
 * Register multiple tools from a module's agentTools export.
 */
export const registerTools = (moduleTools: AgentTool[]): void => {
  for (const tool of moduleTools) {
    registerTool(tool)
  }
}

/**
 * Get a tool by name.
 */
export const getTool = (name: string): AgentTool | undefined => {
  return tools.get(name)
}

/**
 * List all registered tools.
 */
export const listTools = (): AgentTool[] => {
  return Array.from(tools.values())
}

/**
 * List tools filtered by execution context.
 */
export const listToolsByContext = (context: ExecutionContext): AgentTool[] => {
  return listTools().filter((t) => t.context === context)
}

/**
 * Get all tools as MCP-compatible definitions (for tools/list response).
 */
export const getMCPToolDefinitions = (): MCPToolDefinition[] => {
  return listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.schema),
  }))
}

/**
 * Execute a tool by name with permission check.
 *
 * 1. Look up tool
 * 2. Check permission
 * 3. Validate input with Zod
 * 4. Run handler
 */
export const executeTool = async (
  name: string,
  input: unknown
): Promise<{ result: unknown; error?: string }> => {
  const tool = tools.get(name)
  if (!tool) {
    return { result: null, error: `Unknown tool: ${name}` }
  }

  // Permission check
  const perm = await checkPermission(tool.permission)
  if (!perm.allowed) {
    return { result: null, error: `Permission denied: ${tool.permission} — ${perm.reason ?? 'not allowed'}` }
  }

  // Input validation
  const parsed = tool.schema.safeParse(input)
  if (!parsed.success) {
    return { result: null, error: `Invalid input: ${parsed.error.message}` }
  }

  // Execute
  const result = await tool.handler(parsed.data)
  return { result }
}

/**
 * Clear all registered tools (useful for tests).
 */
export const clearRegistry = (): void => {
  tools.clear()
  permissionPolicies.clear()
}
