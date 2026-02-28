/**
 * Git Mock Helper — mock child_process.execFile for git commands
 *
 * Intercepts execFile('git', [...args]) calls and returns configurable
 * responses. No real git operations are performed.
 *
 * Usage:
 *   import { createGitMock } from './helpers/mock-git'
 *
 *   const gitMock = createGitMock()
 *   gitMock.onClone(() => ({ stdout: '', stderr: 'Cloning...' }))
 *   gitMock.onPush(() => ({ stdout: '', stderr: 'Everything up-to-date' }))
 *
 *   // In your test, vi.mock('node:child_process') returns gitMock.execFile
 */

import { vi } from 'vitest'

export interface GitExecResult {
  stdout: string
  stderr: string
}

export type GitCommandHandler = (
  args: string[],
  cwd?: string,
) => GitExecResult | Promise<GitExecResult>

export interface GitMock {
  /** The mock execFile function (promisified-compatible) */
  execFile: ReturnType<typeof vi.fn>

  /** Register a handler for `git clone` commands */
  onClone: (handler: GitCommandHandler) => GitMock

  /** Register a handler for `git push` commands */
  onPush: (handler: GitCommandHandler) => GitMock

  /** Register a handler for any git subcommand by name */
  on: (subcommand: string, handler: GitCommandHandler) => GitMock

  /** Register a default/fallback handler for unmatched commands */
  onDefault: (handler: GitCommandHandler) => GitMock

  /** Make a specific subcommand fail with an error */
  failOn: (subcommand: string, message: string, exitCode?: number) => GitMock

  /** Get a log of all git commands that were called */
  calls: () => Array<{ args: string[]; cwd?: string }>

  /** Reset all handlers and call history */
  reset: () => void
}

/**
 * Create an ExecFileError that matches what child_process.execFile produces.
 * This is what promisify(execFile) throws on non-zero exit codes.
 */
const createExecError = (message: string, exitCode: number, cmd: string, args: string[]): Error & { code: number; stderr: string; stdout: string; cmd: string } => {
  const error = new Error(message) as Error & { code: number; stderr: string; stdout: string; cmd: string }
  error.code = exitCode
  error.stderr = message
  error.stdout = ''
  error.cmd = `${cmd} ${args.join(' ')}`
  return error
}

/**
 * Create a git mock that intercepts execFile('git', args, opts, callback) calls.
 * Works with the promisify(execFile) pattern used in mirror.ts.
 */
export const createGitMock = (): GitMock => {
  const handlers = new Map<string, GitCommandHandler>()
  let defaultHandler: GitCommandHandler | null = null
  const callLog: Array<{ args: string[]; cwd?: string }> = []

  // The mock function that replaces execFile
  // promisify(execFile) calls: execFile(cmd, args, opts, callback)
  const mockExecFile = vi.fn(
    (cmd: string, args: string[], opts: Record<string, unknown>, callback: (err: Error | null, result?: GitExecResult) => void) => {
      // Record the call
      const cwd = opts?.cwd as string | undefined
      callLog.push({ args: [cmd, ...args], cwd })

      // Only handle git commands
      if (cmd !== 'git') {
        callback(new Error(`Unexpected command: ${cmd}`), undefined)
        return
      }

      // Find the git subcommand (first non-flag arg)
      const subcommand = args.find(a => !a.startsWith('-')) || args[0]

      const handler = handlers.get(subcommand) || defaultHandler

      if (!handler) {
        callback(
          createExecError(`mock-git: no handler for "git ${subcommand}"`, 1, cmd, args),
          undefined,
        )
        return
      }

      // Execute handler (sync or async)
      try {
        const result = handler(args, cwd)
        if (result instanceof Promise) {
          result
            .then(r => callback(null, r))
            .catch(err => callback(err))
        } else {
          callback(null, result)
        }
      } catch (err) {
        callback(err as Error)
      }
    },
  )

  const mock: GitMock = {
    execFile: mockExecFile,

    onClone(handler) {
      handlers.set('clone', handler)
      return mock
    },

    onPush(handler) {
      handlers.set('push', handler)
      return mock
    },

    on(subcommand, handler) {
      handlers.set(subcommand, handler)
      return mock
    },

    onDefault(handler) {
      defaultHandler = handler
      return mock
    },

    failOn(subcommand, message, exitCode = 128) {
      handlers.set(subcommand, (_args) => {
        throw createExecError(message, exitCode, 'git', [subcommand])
      })
      return mock
    },

    calls() {
      return [...callLog]
    },

    reset() {
      handlers.clear()
      defaultHandler = null
      callLog.length = 0
      mockExecFile.mockClear()
    },
  }

  return mock
}
