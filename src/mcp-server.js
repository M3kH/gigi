#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { runBash } from './tools/bash.js'
import { runGit } from './tools/git.js'
import { runGitea } from './tools/gitea.js'
import { runFile, runWriteFile } from './tools/file.js'
import { runDocker } from './tools/docker.js'
import { runTelegram } from './tools/telegram.js'

const server = new Server(
  { name: 'gigi-tools', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

const TOOLS = [
  {
    name: 'bash',
    description: 'Run a shell command. Sandboxed with timeout. Cannot run destructive system commands.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run' }
      },
      required: ['command']
    }
  },
  {
    name: 'git',
    description: 'Run git commands. For cloning, branching, committing, pushing. Working directory defaults to /workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Git subcommand and args (e.g. "status", "log --oneline -10")' },
        cwd: { type: 'string', description: 'Working directory (default: /workspace)' }
      },
      required: ['command']
    }
  },
  {
    name: 'gitea',
    description: 'Interact with Gitea API. Create repos, PRs, issues, comments. Read issues and PR details.',
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
    name: 'read_file',
    description: 'Read a file or list a directory. Access limited to /projects, /workspace, and /app.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to read' },
        action: { type: 'string', enum: ['read', 'list'], description: 'read a file or list a directory (default: read)' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Only /workspace is writable. Creates parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to write (must be under /workspace)' },
        content: { type: 'string', description: 'File content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'docker',
    description: 'Inspect Docker services, containers, and logs. Read-only operations only.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['services', 'ps', 'logs', 'inspect'], description: 'Docker action' },
        service: { type: 'string', description: 'Service or container name' },
        tail: { type: 'integer', description: 'Number of log lines (default: 50)' }
      },
      required: ['action']
    }
  },
  {
    name: 'telegram_send',
    description: 'Send a message to Mauro on Telegram. Use for notifications, status updates, PR links, alerts.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text (supports Markdown)' }
      },
      required: ['text']
    }
  }
]

const runners = {
  bash: runBash,
  git: runGit,
  gitea: runGitea,
  read_file: runFile,
  write_file: runWriteFile,
  docker: runDocker,
  telegram_send: runTelegram
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
