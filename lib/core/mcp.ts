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
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { registerTools, getMCPToolDefinitions, executeTool } from './registry'

// ─── Register all module tools ──────────────────────────────────────

// Import agentTools from each module that exposes them.
// This is the "scan" step — adding a new module is one import + registerTools() call.
import { agentTools as toolsAgentTools } from '../tools/index'

registerTools(toolsAgentTools)

// ─── MCP Server ─────────────────────────────────────────────────────

const server = new Server(
  { name: 'gigi-tools', version: '0.3.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getMCPToolDefinitions(),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const { result, error } = await executeTool(name, args ?? {}).catch((err) => ({
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
