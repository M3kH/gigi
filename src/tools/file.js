import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ALLOWED_ROOTS = ['/projects', '/workspace', '/app']
const MAX_SIZE = 100_000

const isAllowed = (path) => {
  const resolved = resolve(path)
  return ALLOWED_ROOTS.some(root => resolved.startsWith(root))
}

export const fileTool = {
  name: 'read_file',
  description: 'Read a file or list a directory. Access limited to /projects (read-only project sources), /workspace (working directory), and /app (Gigi source).',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to read' },
      action: {
        type: 'string',
        enum: ['read', 'list'],
        description: 'read a file or list a directory (default: read)'
      }
    },
    required: ['path']
  }
}

export const runFile = async ({ path, action = 'read' }) => {
  if (!isAllowed(path)) {
    return `Access denied: path must be under ${ALLOWED_ROOTS.join(', ')}`
  }

  if (action === 'list') {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
      .join('\n')
  }

  const info = await stat(path)
  if (info.size > MAX_SIZE) {
    return `File too large (${info.size} bytes). Max: ${MAX_SIZE}`
  }
  return readFile(path, 'utf-8')
}
