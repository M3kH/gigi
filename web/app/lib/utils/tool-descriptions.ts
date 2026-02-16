/**
 * Tool name → human-readable description map
 */

const descriptions: Record<string, string> = {
  Bash: 'Run shell command',
  bash: 'Run shell command',
  Read: 'Read file',
  read_file: 'Read file',
  Write: 'Write file',
  write_file: 'Write file',
  Edit: 'Edit file',
  Grep: 'Search file contents',
  Glob: 'Find files',
  WebFetch: 'Fetch web page',
  Task: 'Run sub-agent',
  ask_user: 'Ask user',
  telegram_send: 'Send Telegram message',
  browser: 'Control browser',
  gitea: 'Gitea API',
  git: 'Git operation',
  docker: 'Docker inspection',
}

export function getToolDescription(name: string): string {
  if (descriptions[name]) return descriptions[name]
  // Handle MCP tool names like mcp__server__tool_name
  const mcpMatch = name.match(/^mcp__[^_]+__(.+)$/)
  if (mcpMatch && descriptions[mcpMatch[1]]) return descriptions[mcpMatch[1]]
  // Fallback: humanize the name
  return name.replace(/[_-]/g, ' ')
}
