/**
 * Tests for the mock-git test helper itself.
 * Ensures the helper works correctly before relying on it in other tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createGitMock } from './helpers/mock-git'

describe('createGitMock', () => {
  let gitMock: ReturnType<typeof createGitMock>

  beforeEach(() => {
    gitMock = createGitMock()
  })

  it('creates a mock with execFile function', () => {
    expect(gitMock.execFile).toBeDefined()
    expect(typeof gitMock.execFile).toBe('function')
  })

  it('records git command calls', () => {
    gitMock.onDefault(() => ({ stdout: '', stderr: '' }))

    gitMock.execFile('git', ['status'], {}, () => {})

    expect(gitMock.calls()).toHaveLength(1)
    expect(gitMock.calls()[0].args).toEqual(['git', 'status'])
  })

  it('routes to specific subcommand handlers', () => {
    let cloneCalled = false
    let pushCalled = false

    gitMock
      .onClone(() => { cloneCalled = true; return { stdout: 'cloned', stderr: '' } })
      .onPush(() => { pushCalled = true; return { stdout: 'pushed', stderr: '' } })

    gitMock.execFile('git', ['clone', '--mirror', 'url', 'dir'], {}, () => {})
    gitMock.execFile('git', ['push', '--force', 'url'], {}, () => {})

    expect(cloneCalled).toBe(true)
    expect(pushCalled).toBe(true)
  })

  it('calls callback with result for registered handler', () => {
    gitMock.onClone(() => ({ stdout: 'output', stderr: 'info' }))

    let result: unknown
    gitMock.execFile('git', ['clone', 'url'], {}, (_err: unknown, res: unknown) => {
      result = res
    })

    expect(result).toEqual({ stdout: 'output', stderr: 'info' })
  })

  it('calls callback with error for unregistered subcommand', () => {
    let error: Error | null = null
    gitMock.execFile('git', ['fetch'], {}, (err: Error | null) => {
      error = err
    })

    expect(error).toBeTruthy()
    expect(error!.message).toContain('no handler')
  })

  it('uses default handler when no specific handler matches', () => {
    gitMock.onDefault(() => ({ stdout: 'default', stderr: '' }))

    let result: unknown
    gitMock.execFile('git', ['any-command'], {}, (_err: unknown, res: unknown) => {
      result = res
    })

    expect(result).toEqual({ stdout: 'default', stderr: '' })
  })

  it('failOn creates an error-throwing handler', () => {
    gitMock.failOn('clone', 'fatal: repo not found', 128)

    let error: Error & { code?: number } | null = null
    gitMock.execFile('git', ['clone', 'url'], {}, (err: Error | null) => {
      error = err as Error & { code?: number }
    })

    expect(error).toBeTruthy()
    expect(error!.message).toContain('repo not found')
    expect(error!.code).toBe(128)
  })

  it('records cwd from options', () => {
    gitMock.onDefault(() => ({ stdout: '', stderr: '' }))

    gitMock.execFile('git', ['status'], { cwd: '/workspace/project' }, () => {})

    expect(gitMock.calls()[0].cwd).toBe('/workspace/project')
  })

  it('reset clears handlers and call history', () => {
    gitMock.onClone(() => ({ stdout: '', stderr: '' }))
    gitMock.execFile('git', ['clone', 'url'], {}, () => {})

    expect(gitMock.calls()).toHaveLength(1)

    gitMock.reset()

    expect(gitMock.calls()).toHaveLength(0)

    // After reset, clone handler should be gone
    let error: Error | null = null
    gitMock.execFile('git', ['clone', 'url'], {}, (err: Error | null) => {
      error = err
    })
    expect(error).toBeTruthy()
  })

  it('rejects non-git commands', () => {
    let error: Error | null = null
    gitMock.execFile('ls', ['-la'], {}, (err: Error | null) => {
      error = err
    })

    expect(error).toBeTruthy()
    expect(error!.message).toContain('Unexpected command: ls')
  })

  it('supports chainable API', () => {
    const result = gitMock
      .onClone(() => ({ stdout: '', stderr: '' }))
      .onPush(() => ({ stdout: '', stderr: '' }))
      .failOn('fetch', 'error')
      .onDefault(() => ({ stdout: '', stderr: '' }))

    expect(result).toBe(gitMock)
  })

  it('passes args to handler', () => {
    let receivedArgs: string[] = []
    gitMock.on('clone', (args) => {
      receivedArgs = args
      return { stdout: '', stderr: '' }
    })

    gitMock.execFile('git', ['clone', '--mirror', 'https://example.com'], {}, () => {})

    expect(receivedArgs).toEqual(['clone', '--mirror', 'https://example.com'])
  })

  it('passes cwd to handler', () => {
    let receivedCwd: string | undefined
    gitMock.on('push', (_args, cwd) => {
      receivedCwd = cwd
      return { stdout: '', stderr: '' }
    })

    gitMock.execFile('git', ['push', 'origin', 'main'], { cwd: '/my/dir' }, () => {})

    expect(receivedCwd).toBe('/my/dir')
  })
})
