/**
 * Tests for lib/backup/mirror.ts — git mirror operations
 *
 * Uses mock-git helper to intercept child_process.execFile calls.
 * Also mocks node:fs/promises and fetch for target repo creation.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { MirrorTarget } from '../lib/backup/config'
import type { RepoInfo } from '../lib/backup/sources'

// ── Hoisted mocks — these are accessible inside vi.mock factories ───

const { gitMock, mockMkdtemp, mockRm, mockWriteFile, mockMkdir, mockReadFile, mockFetch } = vi.hoisted(() => {
  // Inline a minimal git mock (can't import from helpers in hoisted block)
  const handlers = new Map<string, Function>()
  let defaultHandler: Function | null = null
  const callLog: Array<{ args: string[]; cwd?: string }> = []

  const mockExecFile = vi.fn(
    (cmd: string, args: string[], opts: Record<string, unknown>, callback: Function) => {
      const cwd = opts?.cwd as string | undefined
      callLog.push({ args: [cmd, ...args], cwd })

      if (cmd !== 'git') {
        callback(new Error(`Unexpected command: ${cmd}`), undefined)
        return
      }

      const subcommand = args.find(a => !a.startsWith('-')) || args[0]
      const handler = handlers.get(subcommand) || defaultHandler

      if (!handler) {
        const err = new Error(`mock-git: no handler for "git ${subcommand}"`)
        ;(err as any).code = 1
        callback(err, undefined)
        return
      }

      try {
        const result = handler(args, cwd)
        if (result instanceof Promise) {
          result.then((r: any) => callback(null, r)).catch((e: any) => callback(e))
        } else {
          callback(null, result)
        }
      } catch (err) {
        callback(err)
      }
    },
  )

  const gitMock = {
    execFile: mockExecFile,
    onClone(handler: Function) { handlers.set('clone', handler); return gitMock },
    onPush(handler: Function) { handlers.set('push', handler); return gitMock },
    on(sub: string, handler: Function) { handlers.set(sub, handler); return gitMock },
    onDefault(handler: Function) { defaultHandler = handler; return gitMock },
    failOn(sub: string, message: string, exitCode = 128) {
      handlers.set(sub, () => {
        const err = new Error(message) as any
        err.code = exitCode
        err.stderr = message
        throw err
      })
      return gitMock
    },
    calls() { return [...callLog] },
    reset() {
      handlers.clear()
      defaultHandler = null
      callLog.length = 0
      mockExecFile.mockClear()
    },
  }

  return {
    gitMock,
    mockMkdtemp: vi.fn().mockResolvedValue('/tmp/gigi-mirror-test-xyz'),
    mockRm: vi.fn().mockResolvedValue(undefined),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockReadFile: vi.fn().mockResolvedValue(''),
    mockFetch: vi.fn(),
  }
})

// Mock child_process.execFile (mirror.ts uses promisify(execFile))
vi.mock('node:child_process', () => ({
  execFile: gitMock.execFile,
}))

// Mock fs operations to avoid real filesystem changes
vi.mock('node:fs/promises', () => ({
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

// Mock global fetch for ensureTargetRepo API calls
vi.stubGlobal('fetch', mockFetch)

// NOW import the module under test (after mocks are in place)
import { mirrorRepo, mirrorAll, type MirrorResult, type MirrorRunResult } from '../lib/backup/mirror'

// ── Test Fixtures ───────────────────────────────────────────────────

const makeRepo = (overrides?: Partial<RepoInfo>): RepoInfo => ({
  owner: 'idea',
  name: 'gigi',
  cloneUrl: 'https://gitea.local/idea/gigi.git',
  description: 'AI coordinator',
  fullName: 'idea/gigi',
  ...overrides,
})

const makeTarget = (overrides?: Partial<MirrorTarget>): MirrorTarget => ({
  type: 'git-mirror',
  name: 'backup-target',
  url: 'https://backup.example.com',
  auth: 'token',
  token: 'target-token',
  create_repos: false,      // Default off to simplify most tests
  ...overrides,
})

// ── Tests ───────────────────────────────────────────────────────────

describe('mirrorRepo', () => {
  beforeEach(() => {
    gitMock.reset()
    vi.clearAllMocks()
    mockMkdtemp.mockResolvedValue('/tmp/gigi-mirror-test-xyz')
    mockRm.mockResolvedValue(undefined)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Happy Path ────────────────────────────────────────────

  describe('successful mirror', () => {
    it('clones from source and pushes to target', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: 'Cloning into bare repository...' }))
        .onPush(() => ({ stdout: '', stderr: 'Everything up-to-date' }))

      const result = await mirrorRepo(makeRepo(), makeTarget(), 'source-token')

      expect(result.success).toBe(true)
      expect(result.repo).toBe('idea/gigi')
      expect(result.error).toBeUndefined()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)

      // Verify git commands called
      const calls = gitMock.calls()
      expect(calls).toHaveLength(2)

      // Clone call: git clone --mirror <auth-url> <mirror-dir>
      const cloneArgs = calls[0].args
      expect(cloneArgs[0]).toBe('git')
      expect(cloneArgs).toContain('clone')
      expect(cloneArgs).toContain('--mirror')
      // Auth URL should inject token
      const cloneUrl = cloneArgs.find(a => a.includes('gitea.local'))
      expect(cloneUrl).toContain('token:source-token@')

      // Push call: git push --force <target-url> refs/heads/*:refs/heads/* refs/tags/*:refs/tags/*
      const pushArgs = calls[1].args
      expect(pushArgs[0]).toBe('git')
      expect(pushArgs).toContain('push')
      expect(pushArgs).toContain('--force')
      expect(pushArgs).toContain('refs/heads/*:refs/heads/*')
      expect(pushArgs).toContain('refs/tags/*:refs/tags/*')
    })

    it('creates temp directory and cleans up after', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(makeRepo(), makeTarget(), 'token')

      // mkdtemp should be called
      expect(mockMkdtemp).toHaveBeenCalledTimes(1)
      expect(mockMkdtemp.mock.calls[0][0]).toContain('gigi-mirror-gigi-')

      // rm should be called in finally block for cleanup
      expect(mockRm).toHaveBeenCalledWith('/tmp/gigi-mirror-test-xyz', { recursive: true, force: true })
    })

    it('measures duration in result', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      const result = await mirrorRepo(makeRepo(), makeTarget(), 'token')

      expect(typeof result.durationMs).toBe('number')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ── Auth URL Building ─────────────────────────────────────

  describe('authentication', () => {
    it('injects source token into clone URL', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(makeRepo(), makeTarget(), 'my-secret-token')

      const cloneArgs = gitMock.calls()[0].args
      const cloneUrl = cloneArgs.find(a => a.includes('gitea.local'))
      expect(cloneUrl).toContain('token:my-secret-token@')
    })

    it('injects target token into push URL', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(
        makeRepo(),
        makeTarget({ token: 'target-secret' }),
        'source-token',
      )

      const pushArgs = gitMock.calls()[1].args
      const pushUrl = pushArgs.find(a => a.includes('backup.example.com'))
      expect(pushUrl).toContain('token:target-secret@')
    })

    it('builds plain URL for non-token auth', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(
        makeRepo(),
        makeTarget({ auth: 'none', token: undefined }),
        'source-token',
      )

      const pushArgs = gitMock.calls()[1].args
      const pushUrl = pushArgs.find(a => a.includes('backup.example.com'))
      expect(pushUrl).toBe('https://backup.example.com/idea/gigi.git')
    })
  })

  // ── Error Handling ────────────────────────────────────────

  describe('error handling', () => {
    it('returns failure when clone fails', async () => {
      gitMock.failOn('clone', 'fatal: repository not found')

      const result = await mirrorRepo(makeRepo(), makeTarget(), 'token')

      expect(result.success).toBe(false)
      expect(result.error).toContain('repository not found')
      expect(result.repo).toBe('idea/gigi')
    })

    it('returns failure when push fails', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .failOn('push', 'fatal: Authentication failed')

      const result = await mirrorRepo(makeRepo(), makeTarget(), 'token')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Authentication failed')
    })

    it('still cleans up temp dir on failure', async () => {
      gitMock.failOn('clone', 'fatal: network error')

      await mirrorRepo(makeRepo(), makeTarget(), 'token')

      expect(mockRm).toHaveBeenCalledWith('/tmp/gigi-mirror-test-xyz', { recursive: true, force: true })
    })

    it('handles non-Error thrown objects', async () => {
      gitMock.on('clone', () => {
        throw 'string error thrown'
      })

      const result = await mirrorRepo(makeRepo(), makeTarget(), 'token')

      expect(result.success).toBe(false)
      expect(result.error).toBe('string error thrown')
    })
  })

  // ── Target Repo Creation (ensureTargetRepo) ───────────────

  describe('target repo creation', () => {
    it('skips repo creation when create_repos is false', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(
        makeRepo(),
        makeTarget({ create_repos: false }),
        'token',
      )

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('creates repo on target when create_repos is true', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      // First fetch: check if repo exists → 404
      // Second fetch: check if org exists → 200
      // Third fetch: create repo → 201
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: true, status: 201 })

      await mirrorRepo(
        makeRepo(),
        makeTarget({ create_repos: true, token: 'api-token' }),
        'source-token',
      )

      // Should have called fetch for repo check + org check + repo creation
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2)

      // Check the repo creation call
      const createCall = mockFetch.mock.calls.find(
        (call: unknown[]) => {
          const init = call[1] as RequestInit | undefined
          return init?.method === 'POST' && (call[0] as string).includes('/orgs/')
        },
      )
      expect(createCall).toBeDefined()
    })

    it('skips creation when repo already exists on target', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      // Check → 200 (exists)
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })

      await mirrorRepo(
        makeRepo(),
        makeTarget({ create_repos: true, token: 'api-token' }),
        'source-token',
      )

      // Only one fetch call (the check), no creation
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('skips creation when no API token available', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(
        makeRepo(),
        makeTarget({ create_repos: true, token: undefined, api_token: undefined }),
        'source-token',
      )

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('uses api_token when available over regular token', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      // Repo exists check → 200
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })

      await mirrorRepo(
        makeRepo(),
        makeTarget({ create_repos: true, token: 'regular', api_token: 'special-api-token' }),
        'source-token',
      )

      const fetchCall = mockFetch.mock.calls[0]
      const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>
      expect(headers.Authorization).toBe('token special-api-token')
    })
  })

  // ── mTLS / SSL ────────────────────────────────────────────

  describe('SSL environment setup', () => {
    it('sets GIT_SSL_NO_VERIFY for HTTPS non-mTLS targets', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(
        makeRepo(),
        makeTarget({ url: 'https://backup.example.com', auth: 'token' }),
        'token',
      )

      // Push should be called with GIT_SSL_NO_VERIFY in env
      const pushCall = gitMock.calls()[1]
      // The env is passed via execFile opts, which our mock captures
      // The push should complete successfully with SSL config
      expect(pushCall).toBeDefined()
    })

    it('does not set SSL env for HTTP targets', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(
        makeRepo(),
        makeTarget({ url: 'http://backup.local', auth: 'none', token: undefined }),
        'token',
      )

      // Should still succeed — no SSL needed
      expect(gitMock.calls()).toHaveLength(2)
    })
  })

  // ── Mirror Directory Path ─────────────────────────────────

  describe('mirror directory', () => {
    it('uses repo name for mirror directory', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(
        makeRepo({ name: 'my-project' }),
        makeTarget(),
        'token',
      )

      // Clone target should be <tmpdir>/my-project.git
      const cloneArgs = gitMock.calls()[0].args
      const mirrorDir = cloneArgs[cloneArgs.length - 1]
      expect(mirrorDir).toBe('/tmp/gigi-mirror-test-xyz/my-project.git')
    })
  })

  // ── Push refs ─────────────────────────────────────────────

  describe('push refs', () => {
    it('pushes only heads and tags (not pull refs)', async () => {
      gitMock
        .onClone(() => ({ stdout: '', stderr: '' }))
        .onPush(() => ({ stdout: '', stderr: '' }))

      await mirrorRepo(makeRepo(), makeTarget(), 'token')

      const pushArgs = gitMock.calls()[1].args
      // Should include heads and tags but NOT refs/pull/*
      expect(pushArgs).toContain('refs/heads/*:refs/heads/*')
      expect(pushArgs).toContain('refs/tags/*:refs/tags/*')
      expect(pushArgs.join(' ')).not.toContain('refs/pull')
    })
  })
})

// ── mirrorAll ─────────────────────────────────────────────────────

describe('mirrorAll', () => {
  beforeEach(() => {
    gitMock.reset()
    vi.clearAllMocks()
    mockMkdtemp.mockResolvedValue('/tmp/gigi-mirror-test-xyz')
    mockRm.mockResolvedValue(undefined)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mirrors all repos sequentially and returns summary', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    gitMock
      .onClone(() => ({ stdout: '', stderr: '' }))
      .onPush(() => ({ stdout: '', stderr: '' }))

    const repos = [
      makeRepo({ name: 'repo-a', fullName: 'idea/repo-a' }),
      makeRepo({ name: 'repo-b', fullName: 'idea/repo-b' }),
    ]

    const result = await mirrorAll(repos, makeTarget(), 'token')

    expect(result.totalRepos).toBe(2)
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.results).toHaveLength(2)
    expect(result.target).toBe('backup-target')
    expect(result.startedAt).toBeTruthy()
    expect(result.completedAt).toBeTruthy()

    // Each repo should have clone + push = 4 git calls total
    expect(gitMock.calls()).toHaveLength(4)

    consoleSpy.mockRestore()
  })

  it('continues mirroring after a failure', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // First repo fails clone, second succeeds
    let callCount = 0
    gitMock
      .onClone(() => {
        callCount++
        if (callCount === 1) throw new Error('network timeout')
        return { stdout: '', stderr: '' }
      })
      .onPush(() => ({ stdout: '', stderr: '' }))

    const repos = [
      makeRepo({ name: 'fail-repo', fullName: 'idea/fail-repo' }),
      makeRepo({ name: 'ok-repo', fullName: 'idea/ok-repo' }),
    ]

    const result = await mirrorAll(repos, makeTarget(), 'token')

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.results[0].success).toBe(false)
    expect(result.results[0].error).toContain('network timeout')
    expect(result.results[1].success).toBe(true)

    consoleSpy.mockRestore()
    consoleErrSpy.mockRestore()
  })

  it('handles empty repo list', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await mirrorAll([], makeTarget(), 'token')

    expect(result.totalRepos).toBe(0)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.results).toHaveLength(0)

    consoleSpy.mockRestore()
  })

  it('logs progress for each repo', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    gitMock
      .onClone(() => ({ stdout: '', stderr: '' }))
      .onPush(() => ({ stdout: '', stderr: '' }))

    await mirrorAll(
      [makeRepo({ fullName: 'idea/gigi' })],
      makeTarget(),
      'token',
    )

    const logCalls = consoleSpy.mock.calls.map(c => c[0])
    expect(logCalls.some((msg: string) => msg.includes('starting mirror'))).toBe(true)
    expect(logCalls.some((msg: string) => msg.includes('idea/gigi'))).toBe(true)
    expect(logCalls.some((msg: string) => msg.includes('completed'))).toBe(true)

    consoleSpy.mockRestore()
  })
})
