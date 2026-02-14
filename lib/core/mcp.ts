#!/usr/bin/env node
/**
 * MCP Server — Registry-backed tool server
 *
 * Serves all agent tools registered via the tool registry (lib/core/registry.ts).
 * Modules export `agentTools: AgentTool[]` and the registry collects them at startup.
 *
 * Previously tools were hardcoded here. Now this file is a thin MCP ↔ registry bridge:
 *   tools/list  → getMCPToolDefinitions()
 *   tools/call  → executeTool(name, args)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools, getMCPToolDefinitions, executeTool } from './registry'

// ─── Register all module tools ──────────────────────────────────────

// Import agentTools from each module that exposes them.
// This is the "scan" step — adding a new module is one import + registerTools() call.
import { agentTools as toolsAgentTools } from '../tools/index'

registerTools(toolsAgentTools)

// Future modules register here as they're built:
// import { agentTools as kanbanTools } from '../feat-kanban/index'
// registerTools(kanbanTools)
// import { agentTools as viewTools } from '../feat-view/index'
// registerTools(viewTools)

// ─── MCP Server ─────────────────────────────────────────────────────

const server = new Server(
  { name: 'gigi-tools', version: '0.3.0' },
  { capabilities: { tools: {} } }
)

// MCP SDK expects specific schema types; we use `as any` at the boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler('tools/list' as any, async () => ({
  tools: getMCPToolDefinitions(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler('tools/call' as any, async (request: { params: { name: string; arguments: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params

  const { result, error } = await executeTool(name, args).catch((err) => ({
    result: null,
    error: `Error: ${(err as Error).message}`,
  }))

  if (error) {
    return { content: [{ type: 'text', text: error }], isError: true }
  }

  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  return { content: [{ type: 'text', text }] }
})

const transport = new StdioServerTransport()
await server.connect(transport)
