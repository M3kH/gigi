import { runBash } from './bash.js'

export const gitTool = {
  name: 'git',
  description: 'Run git commands. For cloning, branching, committing, pushing. Working directory defaults to /workspace.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Git subcommand and args (e.g. "status", "log --oneline -10")' },
      cwd: { type: 'string', description: 'Working directory (default: /workspace)' }
    },
    required: ['command']
  }
}

export const runGit = async ({ command, cwd = '/workspace' }) => {
  return runBash({ command: `cd "${cwd}" && git ${command}` })
}
