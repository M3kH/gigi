#!/usr/bin/env node
// MCP server exposing only tools Claude Code doesn't have natively:
// - gitea: Gitea API with auto-configured auth
// - telegram_send: Send messages to Mauro on Telegram
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { runGitea } from './tools/gitea.js'
import { runTelegram } from './tools/telegram.js'
import browserTool from './tools/browser.js'

const server = new Server(
  { name: 'gigi-tools', version: '0.2.0' },
  { capabilities: { tools: {} } }
)

const TOOLS = [
  {
    name: 'gitea',
    description: 'Interact with Gitea API. Create repos, PRs, issues, comments. Auth is automatic.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_repos', 'create_repo', 'get_issue', 'list_issues', 'create_issue',
                 'comment_issue', 'create_pr', 'list_prs', 'get_pr', 'get_pr_diff'],
          description: 'The Gitea action to perform'
        },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        number: { type: 'integer', description: 'Issue or PR number' },
        title: { type: 'string' },
        body: { type: 'string' },
        head: { type: 'string', description: 'Source branch for PR' },
        base: { type: 'string', description: 'Target branch for PR' },
        private: { type: 'boolean', description: 'Whether repo is private' }
      },
      required: ['action']
    }
  },
  {
    name: 'telegram_send',
    description: 'Send a message to Mauro on Telegram. Use for notifications, status updates, PR links.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text (supports Markdown)' }
      },
      required: ['text']
    }
  },
  {
    name: 'browser',
    description: browserTool.description,
    inputSchema: {
      type: 'object',
      properties: browserTool.parameters,
      required: ['action']
    }
  }
]

const runners = {
  gitea: runGitea,
  telegram_send: runTelegram,
  browser: browserTool.handler
}

server.setRequestHandler('tools/list', async () => ({ tools: TOOLS }))

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params
  const runner = runners[name]
  if (!runner) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
  try {
    const result = await runner(args)
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    return { content: [{ type: 'text', text }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
