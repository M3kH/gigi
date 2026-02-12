import { execFile } from 'node:child_process'

const TIMEOUT_MS = 30_000
const MAX_OUTPUT = 10_000

const BLOCKED = [
  /rm\s+(-rf?|--recursive)\s+\//,
  /mkfs/,
  /dd\s+if=/,
  /shutdown/,
  /reboot/,
  /:(){ :|:& };:/
]

export const bashTool = {
  name: 'bash',
  description: 'Run a shell command. Sandboxed with timeout. Cannot run destructive system commands.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to run' }
    },
    required: ['command']
  }
}

export const runBash = async ({ command }) => {
  for (const pattern of BLOCKED) {
    if (pattern.test(command)) {
      return `Blocked: command matches restricted pattern`
    }
  }

  return new Promise((resolve) => {
    execFile('bash', ['-c', command], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' }
    }, (err, stdout, stderr) => {
      let output = ''
      if (stdout) output += stdout
      if (stderr) output += (output ? '\n' : '') + stderr
      if (err && !output) output = err.message
      if (output.length > MAX_OUTPUT) {
        output = output.slice(0, MAX_OUTPUT) + '\n... (truncated)'
      }
      resolve(output || '(no output)')
    })
  })
}
