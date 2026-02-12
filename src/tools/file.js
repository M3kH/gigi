import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'

const ALLOWED_ROOTS = ['/projects', '/workspace', '/app']
const WRITABLE_ROOTS = ['/workspace']
const MAX_SIZE = 100_000

const isAllowed = (path) => {
  const resolved = resolve(path)
  return ALLOWED_ROOTS.some(root => resolved.startsWith(root))
}

const isWritable = (path) => {
  const resolved = resolve(path)
  return WRITABLE_ROOTS.some(root => resolved.startsWith(root))
}

export const fileTool = {
  name: 'read_file',
  description: 'Read a file or list a directory. Access limited to /projects (read-only), /workspace (read-write), and /app (read-only).',
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

export const writeFileTool = {
  name: 'write_file',
  description: 'Write content to a file. Only /workspace is writable. Creates parent directories if needed.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to write (must be under /workspace)' },
      content: { type: 'string', description: 'File content to write' }
    },
    required: ['path', 'content']
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

export const runWriteFile = async ({ path, content }) => {
  if (!isWritable(path)) {
    return `Access denied: can only write to ${WRITABLE_ROOTS.join(', ')}`
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
  return `Written ${content.length} bytes to ${path}`
}
