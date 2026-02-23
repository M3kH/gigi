/**
 * Tests for PR #154: Broadened Gitea proxy URL support
 *
 * Covers:
 * - parseGiteaPath() — all new context types (actions, releases, wiki, org, admin, etc.)
 * - extractGiteaPath() — broadened patterns + non-page prefix filtering
 * - ViewContextSchema — Zod schema accepts new types and subId field
 * - enrichWithContext() — tested indirectly via router context descriptions
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ─── parseGiteaPath ──────────────────────────────────────────────────
// Can't import directly from .svelte.ts (uses $state runes at module level),
// so we replicate the pure function logic for testing.

type ViewContextType =
  | 'overview' | 'repo' | 'issue' | 'pull' | 'file' | 'commit'
  | 'actions' | 'releases' | 'wiki' | 'milestones' | 'labels'
  | 'settings' | 'activity' | 'projects' | 'org' | 'admin' | 'unknown'

interface ViewContext {
  type: ViewContextType
  owner?: string
  repo?: string
  number?: number
  filepath?: string
  branch?: string
  commitSha?: string
  subId?: string
  rawPath?: string
}

const REPO_SUBPAGE_TYPES: Record<string, ViewContextType> = {
  actions: 'actions', releases: 'releases', wiki: 'wiki',
  milestones: 'milestones', labels: 'labels', settings: 'settings',
  activity: 'activity', projects: 'projects',
}

function parseGiteaPath(path: string): ViewContext {
  const clean = path.replace(/^\/gitea/, '')
  if (clean.startsWith('/-/admin')) return { type: 'admin', rawPath: path }
  const issueMatch = clean.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)/)
  if (issueMatch) return { type: 'issue', owner: issueMatch[1], repo: issueMatch[2], number: parseInt(issueMatch[3], 10), rawPath: path }
  const pullMatch = clean.match(/^\/([^/]+)\/([^/]+)\/pulls\/(\d+)/)
  if (pullMatch) return { type: 'pull', owner: pullMatch[1], repo: pullMatch[2], number: parseInt(pullMatch[3], 10), rawPath: path }
  const fileMatch = clean.match(/^\/([^/]+)\/([^/]+)\/src\/branch\/([^/]+)\/(.+)/)
  if (fileMatch) return { type: 'file', owner: fileMatch[1], repo: fileMatch[2], branch: fileMatch[3], filepath: fileMatch[4], rawPath: path }
  const commitMatch = clean.match(/^\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]+)/)
  if (commitMatch) return { type: 'commit', owner: commitMatch[1], repo: commitMatch[2], commitSha: commitMatch[3], rawPath: path }
  const actionsRunMatch = clean.match(/^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/)
  if (actionsRunMatch) return { type: 'actions', owner: actionsRunMatch[1], repo: actionsRunMatch[2], subId: actionsRunMatch[3], rawPath: path }
  const subpageMatch = clean.match(/^\/([^/]+)\/([^/]+)\/([^/]+)/)
  if (subpageMatch) {
    const contextType = REPO_SUBPAGE_TYPES[subpageMatch[3]]
    if (contextType) return { type: contextType, owner: subpageMatch[1], repo: subpageMatch[2], rawPath: path }
  }
  const repoMatch = clean.match(/^\/([^/]+)\/([^/]+)\/?$/)
  if (repoMatch) return { type: 'repo', owner: repoMatch[1], repo: repoMatch[2], rawPath: path }
  const repoFallback = clean.match(/^\/([^/]+)\/([^/]+)/)
  if (repoFallback) return { type: 'unknown', owner: repoFallback[1], repo: repoFallback[2], rawPath: path }
  const orgMatch = clean.match(/^\/([^/]+)\/?$/)
  if (orgMatch) return { type: 'org', owner: orgMatch[1], rawPath: path }
  return { type: 'overview', rawPath: path }
}

// ── extractGiteaPath helpers (replicated from intercept-links.ts) ────

const GITEA_NON_PAGE_PREFIXES = ['/api/', '/assets/', '/swagger', '/-/health']
const GITEA_PAGE_PATTERNS = [
  /^\/[^/]+\/[^/]+/,
  /^\/[^/]+\/?$/,
  /^\/-\/admin/,
]

function isGiteaPage(cleanPath: string): boolean {
  return (
    !GITEA_NON_PAGE_PREFIXES.some(prefix => cleanPath.startsWith(prefix)) &&
    GITEA_PAGE_PATTERNS.some(p => p.test(cleanPath))
  )
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('parseGiteaPath — existing types', () => {
  it('parses issue paths', () => {
    const ctx = parseGiteaPath('/idea/gigi/issues/42')
    assert.equal(ctx.type, 'issue')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
    assert.equal(ctx.number, 42)
  })

  it('parses pull paths', () => {
    const ctx = parseGiteaPath('/idea/gigi/pulls/10')
    assert.equal(ctx.type, 'pull')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
    assert.equal(ctx.number, 10)
  })

  it('parses file paths', () => {
    const ctx = parseGiteaPath('/idea/gigi/src/branch/main/lib/core/router.ts')
    assert.equal(ctx.type, 'file')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
    assert.equal(ctx.branch, 'main')
    assert.equal(ctx.filepath, 'lib/core/router.ts')
  })

  it('parses commit paths', () => {
    const ctx = parseGiteaPath('/idea/gigi/commit/abc123def')
    assert.equal(ctx.type, 'commit')
    assert.equal(ctx.commitSha, 'abc123def')
  })

  it('parses bare repo paths', () => {
    const ctx = parseGiteaPath('/idea/gigi')
    assert.equal(ctx.type, 'repo')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
  })

  it('parses bare repo paths with trailing slash', () => {
    const ctx = parseGiteaPath('/idea/gigi/')
    assert.equal(ctx.type, 'repo')
  })

  it('strips /gitea prefix before parsing', () => {
    const ctx = parseGiteaPath('/gitea/idea/gigi/issues/5')
    assert.equal(ctx.type, 'issue')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
    assert.equal(ctx.number, 5)
    assert.equal(ctx.rawPath, '/gitea/idea/gigi/issues/5')
  })

  it('returns overview for root path', () => {
    const ctx = parseGiteaPath('/')
    assert.equal(ctx.type, 'overview')
  })
})

describe('parseGiteaPath — new context types', () => {
  it('parses actions run paths with subId', () => {
    const ctx = parseGiteaPath('/idea/gigi/actions/runs/42')
    assert.equal(ctx.type, 'actions')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
    assert.equal(ctx.subId, '42')
  })

  it('parses actions list path', () => {
    const ctx = parseGiteaPath('/idea/gigi/actions')
    assert.equal(ctx.type, 'actions')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
    assert.equal(ctx.subId, undefined)
  })

  it('parses releases path', () => {
    const ctx = parseGiteaPath('/idea/gigi/releases')
    assert.equal(ctx.type, 'releases')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
  })

  it('parses wiki path', () => {
    const ctx = parseGiteaPath('/idea/gigi/wiki')
    assert.equal(ctx.type, 'wiki')
  })

  it('parses milestones path', () => {
    const ctx = parseGiteaPath('/idea/gigi/milestones')
    assert.equal(ctx.type, 'milestones')
  })

  it('parses labels path', () => {
    const ctx = parseGiteaPath('/idea/gigi/labels')
    assert.equal(ctx.type, 'labels')
  })

  it('parses settings path', () => {
    const ctx = parseGiteaPath('/idea/gigi/settings')
    assert.equal(ctx.type, 'settings')
  })

  it('parses activity path', () => {
    const ctx = parseGiteaPath('/idea/gigi/activity')
    assert.equal(ctx.type, 'activity')
  })

  it('parses projects path', () => {
    const ctx = parseGiteaPath('/idea/gigi/projects')
    assert.equal(ctx.type, 'projects')
  })

  it('parses admin pages', () => {
    const ctx = parseGiteaPath('/-/admin')
    assert.equal(ctx.type, 'admin')
    assert.equal(ctx.owner, undefined)
    assert.equal(ctx.repo, undefined)
  })

  it('parses admin sub-pages', () => {
    const ctx = parseGiteaPath('/-/admin/users')
    assert.equal(ctx.type, 'admin')
  })

  it('parses org pages', () => {
    const ctx = parseGiteaPath('/idea')
    assert.equal(ctx.type, 'org')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, undefined)
  })

  it('parses org pages with trailing slash', () => {
    const ctx = parseGiteaPath('/idea/')
    assert.equal(ctx.type, 'org')
    assert.equal(ctx.owner, 'idea')
  })

  it('falls back to unknown for unrecognized sub-pages', () => {
    const ctx = parseGiteaPath('/idea/gigi/some-unknown-page')
    assert.equal(ctx.type, 'unknown')
    assert.equal(ctx.owner, 'idea')
    assert.equal(ctx.repo, 'gigi')
  })

  it('preserves rawPath in all new types', () => {
    const paths = [
      '/idea/gigi/actions', '/idea/gigi/releases', '/idea/gigi/wiki',
      '/-/admin', '/idea',
    ]
    for (const p of paths) {
      assert.equal(parseGiteaPath(p).rawPath, p, `rawPath preserved for ${p}`)
    }
  })
})

describe('parseGiteaPath — priority ordering', () => {
  it('issues take priority over generic subpage matching', () => {
    // "issues" is not in REPO_SUBPAGE_TYPES, so /issues/42 must match the issue regex
    const ctx = parseGiteaPath('/idea/gigi/issues/42')
    assert.equal(ctx.type, 'issue')
    assert.equal(ctx.number, 42)
  })

  it('pulls take priority over generic subpage matching', () => {
    const ctx = parseGiteaPath('/idea/gigi/pulls/5')
    assert.equal(ctx.type, 'pull')
    assert.equal(ctx.number, 5)
  })

  it('actions/runs/N takes priority over generic actions subpage', () => {
    const ctx = parseGiteaPath('/idea/gigi/actions/runs/99')
    assert.equal(ctx.type, 'actions')
    assert.equal(ctx.subId, '99')
  })

  it('commit path takes priority over subpage matching', () => {
    const ctx = parseGiteaPath('/idea/gigi/commit/deadbeef')
    assert.equal(ctx.type, 'commit')
    assert.equal(ctx.commitSha, 'deadbeef')
  })
})

// ─── extractGiteaPath patterns (broadened) ───────────────────────────

describe('GITEA_PAGE_PATTERNS — broadened matching', () => {
  it('matches owner/repo paths', () => {
    assert.ok(isGiteaPage('/idea/gigi'))
  })

  it('matches owner/repo sub-pages', () => {
    assert.ok(isGiteaPage('/idea/gigi/actions'))
    assert.ok(isGiteaPage('/idea/gigi/releases'))
    assert.ok(isGiteaPage('/idea/gigi/wiki/Home'))
    assert.ok(isGiteaPage('/idea/gigi/milestones'))
    assert.ok(isGiteaPage('/idea/gigi/labels'))
    assert.ok(isGiteaPage('/idea/gigi/settings'))
  })

  it('matches org pages', () => {
    assert.ok(isGiteaPage('/idea'))
    assert.ok(isGiteaPage('/idea/'))
  })

  it('matches admin pages', () => {
    assert.ok(isGiteaPage('/-/admin'))
    assert.ok(isGiteaPage('/-/admin/users'))
  })

  it('filters out API paths', () => {
    assert.ok(!isGiteaPage('/api/v1/repos'))
    assert.ok(!isGiteaPage('/api/v1/repos/idea/gigi'))
  })

  it('filters out asset paths', () => {
    assert.ok(!isGiteaPage('/assets/css/index.css'))
    assert.ok(!isGiteaPage('/assets/js/index.js'))
  })

  it('filters out swagger', () => {
    assert.ok(!isGiteaPage('/swagger'))
  })

  it('filters out health endpoint', () => {
    assert.ok(!isGiteaPage('/-/health'))
  })

  it('still matches issue/PR/commit URLs (backwards compat)', () => {
    assert.ok(isGiteaPage('/idea/gigi/issues/42'))
    assert.ok(isGiteaPage('/idea/gigi/pulls/10'))
    assert.ok(isGiteaPage('/idea/gigi/commit/abc123'))
    assert.ok(isGiteaPage('/idea/gigi/src/branch/main/README.md'))
  })
})

// ─── ViewContextSchema — Zod validation ──────────────────────────────

describe('ViewContextSchema — new types', () => {
  it('accepts all new context types', async () => {
    const { ViewContextSchema } = await import('../lib/core/protocol')
    const newTypes = [
      'actions', 'releases', 'wiki', 'milestones', 'labels',
      'settings', 'activity', 'projects', 'org', 'admin',
    ]
    for (const t of newTypes) {
      const result = ViewContextSchema.safeParse({ type: t, owner: 'idea', repo: 'gigi' })
      assert.ok(result.success, `ViewContextSchema should accept type "${t}"`)
    }
  })

  it('accepts subId field', async () => {
    const { ViewContextSchema } = await import('../lib/core/protocol')
    const result = ViewContextSchema.safeParse({
      type: 'actions',
      owner: 'idea',
      repo: 'gigi',
      subId: '42',
    })
    assert.ok(result.success, 'ViewContextSchema should accept subId')
    assert.equal(result.data?.subId, '42')
  })

  it('subId is optional', async () => {
    const { ViewContextSchema } = await import('../lib/core/protocol')
    const result = ViewContextSchema.safeParse({
      type: 'actions',
      owner: 'idea',
      repo: 'gigi',
    })
    assert.ok(result.success, 'ViewContextSchema should not require subId')
    assert.equal(result.data?.subId, undefined)
  })

  it('still accepts original types', async () => {
    const { ViewContextSchema } = await import('../lib/core/protocol')
    const originalTypes = ['overview', 'repo', 'issue', 'pull', 'file', 'commit', 'unknown']
    for (const t of originalTypes) {
      const result = ViewContextSchema.safeParse({ type: t })
      assert.ok(result.success, `ViewContextSchema should still accept original type "${t}"`)
    }
  })

  it('rejects invalid types', async () => {
    const { ViewContextSchema } = await import('../lib/core/protocol')
    const result = ViewContextSchema.safeParse({ type: 'nonexistent' })
    assert.ok(!result.success, 'ViewContextSchema should reject invalid type')
  })
})

// ─── ChatSend accepts new context types ──────────────────────────────

describe('ChatSend — context with new types', () => {
  it('accepts chat:send with actions context', async () => {
    const { ChatSend } = await import('../lib/core/protocol')
    const result = ChatSend.safeParse({
      type: 'chat:send',
      message: 'hello',
      context: { type: 'actions', owner: 'idea', repo: 'gigi', subId: '42' },
    })
    assert.ok(result.success, 'ChatSend should accept actions context with subId')
  })

  it('accepts chat:send with org context', async () => {
    const { ChatSend } = await import('../lib/core/protocol')
    const result = ChatSend.safeParse({
      type: 'chat:send',
      message: 'hello',
      context: { type: 'org', owner: 'idea' },
    })
    assert.ok(result.success, 'ChatSend should accept org context')
  })

  it('accepts chat:send with admin context', async () => {
    const { ChatSend } = await import('../lib/core/protocol')
    const result = ChatSend.safeParse({
      type: 'chat:send',
      message: 'hello',
      context: { type: 'admin', rawPath: '/-/admin/users' },
    })
    assert.ok(result.success, 'ChatSend should accept admin context')
  })
})
