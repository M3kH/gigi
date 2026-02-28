/**
 * Tests for lib/backup/sources.ts — repo resolution from backup sources
 *
 * Mocks the Gitea API client to test source resolution logic without network calls.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock the Gitea client module before importing sources
vi.mock('../lib/api-gitea/client', () => ({
  createGiteaClient: vi.fn(),
}))

import { resolveRepos, type RepoInfo } from '../lib/backup/sources'
import { createGiteaClient } from '../lib/api-gitea/client'

const mockedCreateGiteaClient = vi.mocked(createGiteaClient)

// ─── Helpers ──────────────────────────────────────────────────────────

const makeRepo = (owner: string, name: string, description = '') => ({
  name,
  description,
  // The Gitea API returns more fields but sources.ts only uses name + description
  id: Math.floor(Math.random() * 10000),
  full_name: `${owner}/${name}`,
  clone_url: `https://gitea.local/${owner}/${name}.git`,
  html_url: `https://gitea.local/${owner}/${name}`,
  ssh_url: `git@gitea.local:${owner}/${name}.git`,
  owner: { login: owner, id: 1 },
  private: false,
  fork: false,
  archived: false,
  empty: false,
  mirror: false,
  size: 100,
  default_branch: 'main',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const createMockGiteaClient = () => ({
  request: vi.fn(),
  repos: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    getContents: vi.fn(),
    createFile: vi.fn(),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
    listBranches: vi.fn(),
    getBranch: vi.fn(),
    listLabels: vi.fn(),
    createLabel: vi.fn(),
  },
  issues: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    editComment: vi.fn(),
    getLabels: vi.fn(),
    setLabels: vi.fn(),
    setLabelsByName: vi.fn(),
  },
  pulls: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    getDiff: vi.fn(),
    merge: vi.fn(),
    listComments: vi.fn(),
  },
  projects: {
    listColumns: vi.fn(),
    listCards: vi.fn(),
    addIssue: vi.fn(),
    moveCard: vi.fn(),
  },
  users: {
    me: vi.fn(),
    get: vi.fn(),
    listRepos: vi.fn(),
  },
  orgs: {
    list: vi.fn(),
    get: vi.fn(),
    listRepos: vi.fn(),
    listMembers: vi.fn(),
  },
})

// ─── Tests ────────────────────────────────────────────────────────────

describe('resolveRepos', () => {
  let mockClient: ReturnType<typeof createMockGiteaClient>

  beforeEach(() => {
    mockClient = createMockGiteaClient()
    mockedCreateGiteaClient.mockReturnValue(mockClient as unknown as ReturnType<typeof createGiteaClient>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Org Sources ─────────────────────────────────────────────

  describe('org source', () => {
    it('resolves repos from a single org', async () => {
      mockClient.orgs.listRepos.mockResolvedValueOnce([
        makeRepo('idea', 'gigi'),
        makeRepo('idea', 'website'),
      ])

      const repos = await resolveRepos(
        [{ org: 'idea' }],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(2)
      expect(repos[0]).toEqual({
        owner: 'idea',
        name: 'gigi',
        cloneUrl: 'https://gitea.local/idea/gigi.git',
        description: '',
        fullName: 'idea/gigi',
      })
      expect(repos[1]).toEqual({
        owner: 'idea',
        name: 'website',
        cloneUrl: 'https://gitea.local/idea/website.git',
        description: '',
        fullName: 'idea/website',
      })

      // Verify API was called correctly
      expect(mockClient.orgs.listRepos).toHaveBeenCalledWith('idea', { limit: 50, page: 1 })
    })

    it('paginates through multiple pages of repos', async () => {
      // First page: full batch of 50
      const firstBatch = Array.from({ length: 50 }, (_, i) => makeRepo('org', `repo-${i}`))
      // Second page: partial batch (end of pagination)
      const secondBatch = [makeRepo('org', 'repo-50'), makeRepo('org', 'repo-51')]

      mockClient.orgs.listRepos
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(secondBatch)

      const repos = await resolveRepos(
        [{ org: 'org' }],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(52)
      expect(mockClient.orgs.listRepos).toHaveBeenCalledTimes(2)
      expect(mockClient.orgs.listRepos).toHaveBeenCalledWith('org', { limit: 50, page: 1 })
      expect(mockClient.orgs.listRepos).toHaveBeenCalledWith('org', { limit: 50, page: 2 })
    })

    it('handles empty org (no repos)', async () => {
      mockClient.orgs.listRepos.mockResolvedValueOnce([])

      const repos = await resolveRepos(
        [{ org: 'empty-org' }],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(0)
    })

    it('strips trailing slashes from base URL', async () => {
      mockClient.orgs.listRepos.mockResolvedValueOnce([
        makeRepo('idea', 'gigi'),
      ])

      const repos = await resolveRepos(
        [{ org: 'idea' }],
        'https://gitea.local///',
        'test-token',
      )

      expect(repos[0].cloneUrl).toBe('https://gitea.local/idea/gigi.git')
    })
  })

  // ── Repo Sources ────────────────────────────────────────────

  describe('repo source', () => {
    it('resolves a single repo by owner/name', async () => {
      mockClient.repos.get.mockResolvedValueOnce(makeRepo('idea', 'gigi', 'AI coordinator'))

      const repos = await resolveRepos(
        [{ repo: 'idea/gigi' }],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(1)
      expect(repos[0]).toEqual({
        owner: 'idea',
        name: 'gigi',
        cloneUrl: 'https://gitea.local/idea/gigi.git',
        description: 'AI coordinator',
        fullName: 'idea/gigi',
      })
      expect(mockClient.repos.get).toHaveBeenCalledWith('idea', 'gigi')
    })

    it('returns empty array for invalid repo spec (no slash)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const repos = await resolveRepos(
        [{ repo: 'invalid-no-slash' }],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(0)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid repo spec'),
      )
      consoleSpy.mockRestore()
    })

    it('returns empty array when repo API call fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockClient.repos.get.mockRejectedValueOnce(new Error('404 Not Found'))

      const repos = await resolveRepos(
        [{ repo: 'idea/nonexistent' }],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(0)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to resolve repo'),
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })
  })

  // ── Match Sources (not yet implemented) ─────────────────────

  describe('match source', () => {
    it('warns and returns empty for match source', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const repos = await resolveRepos(
        [{ match: 'idea/*' } as any],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(0)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('match'),
      )
      consoleSpy.mockRestore()
    })
  })

  // ── Unknown Source Type ─────────────────────────────────────

  describe('unknown source', () => {
    it('returns empty for unknown source shape', async () => {
      const repos = await resolveRepos(
        [{ something: 'unexpected' } as any],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(0)
    })
  })

  // ── Deduplication ───────────────────────────────────────────

  describe('deduplication', () => {
    it('deduplicates repos that appear in multiple sources', async () => {
      // Same repo appears in both org listing and explicit repo source
      mockClient.orgs.listRepos.mockResolvedValueOnce([
        makeRepo('idea', 'gigi'),
        makeRepo('idea', 'website'),
      ])
      mockClient.repos.get.mockResolvedValueOnce(makeRepo('idea', 'gigi', 'duplicate'))

      const repos = await resolveRepos(
        [{ org: 'idea' }, { repo: 'idea/gigi' }],
        'https://gitea.local',
        'test-token',
      )

      // gigi should only appear once (from the org source, since it came first)
      expect(repos).toHaveLength(2)
      const names = repos.map(r => r.fullName)
      expect(names).toEqual(['idea/gigi', 'idea/website'])
    })
  })

  // ── Multiple Sources ────────────────────────────────────────

  describe('multiple sources', () => {
    it('combines repos from multiple sources', async () => {
      mockClient.orgs.listRepos.mockResolvedValueOnce([
        makeRepo('idea', 'gigi'),
      ])
      mockClient.repos.get.mockResolvedValueOnce(makeRepo('other', 'project'))

      const repos = await resolveRepos(
        [{ org: 'idea' }, { repo: 'other/project' }],
        'https://gitea.local',
        'test-token',
      )

      expect(repos).toHaveLength(2)
      expect(repos[0].fullName).toBe('idea/gigi')
      expect(repos[1].fullName).toBe('other/project')
    })
  })

  // ── Client Creation ─────────────────────────────────────────

  describe('client creation', () => {
    it('creates Gitea client with correct URL and token', async () => {
      mockClient.orgs.listRepos.mockResolvedValueOnce([])

      await resolveRepos(
        [{ org: 'idea' }],
        'https://gitea.local',
        'my-secret-token',
      )

      expect(mockedCreateGiteaClient).toHaveBeenCalledWith(
        'https://gitea.local',
        'my-secret-token',
      )
    })
  })
})
