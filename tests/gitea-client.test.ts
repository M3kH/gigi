/**
 * Tests for lib/api-gitea/client.ts — Gitea API client
 *
 * Tests the buildUrl utility and createGiteaClient factory.
 * Uses MSW (Mock Service Worker) for HTTP mocking.
 */

import assert from 'node:assert/strict'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createGiteaClient } from '../lib/api-gitea/client'
import { GiteaApiError, GiteaNetworkError } from '../lib/api-gitea/errors'

// ─── buildUrl tests (re-implemented for unit testing) ────────────────

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string => {
  const url = new URL(`/api/v1${path}`, baseUrl)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

describe('buildUrl', () => {
  it('constructs API v1 URL', () => {
    const url = buildUrl('http://localhost:3300', '/repos/idea/gigi')
    assert.equal(url, 'http://localhost:3300/api/v1/repos/idea/gigi')
  })

  it('adds query parameters', () => {
    const url = buildUrl('http://localhost:3300', '/user/repos', { limit: 50, page: 2 })
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('limit'), '50')
    assert.equal(parsed.searchParams.get('page'), '2')
  })

  it('skips undefined query values', () => {
    const url = buildUrl('http://localhost:3300', '/repos', { limit: 10, page: undefined })
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('limit'), '10')
    assert.equal(parsed.searchParams.has('page'), false)
  })

  it('handles boolean query values', () => {
    const url = buildUrl('http://localhost:3300', '/repos', { private: true })
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('private'), 'true')
  })

  it('handles trailing slash on baseUrl', () => {
    const url = buildUrl('http://localhost:3300/', '/user')
    assert.ok(url.includes('/api/v1/user'))
  })
})

// ─── createGiteaClient tests with MSW ─────────────────────────────────

const BASE_URL = 'http://localhost:9999'
const TOKEN = 'test-token-123'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('createGiteaClient', () => {
  it('creates a client with all method groups', () => {
    const client = createGiteaClient(BASE_URL, TOKEN)
    assert.ok(client.repos, 'should have repos namespace')
    assert.ok(client.issues, 'should have issues namespace')
    assert.ok(client.pulls, 'should have pulls namespace')
    assert.ok(client.users, 'should have users namespace')
    assert.ok(client.orgs, 'should have orgs namespace')
    assert.ok(client.projects, 'should have projects namespace')
    assert.ok(client.request, 'should have raw request escape hatch')
  })

  describe('repos', () => {
    it('list() sends correct request with auth', async () => {
      let capturedAuth = ''
      server.use(
        http.get(`${BASE_URL}/api/v1/user/repos`, ({ request }) => {
          capturedAuth = request.headers.get('Authorization') || ''
          return HttpResponse.json([
            {
              id: 1, name: 'gigi', full_name: 'idea/gigi',
              owner: { id: 1, login: 'idea', full_name: 'Idea Org', email: '', avatar_url: '', html_url: '' },
              html_url: '', clone_url: '', default_branch: 'main',
              archived: false, stars_count: 0, forks_count: 0, open_issues_count: 0, description: '',
            },
          ])
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      const repos = await client.repos.list({ limit: 10 })

      assert.equal(capturedAuth, `token ${TOKEN}`)
      assert.equal(repos.length, 1)
      assert.equal(repos[0].name, 'gigi')
    })

    it('get() fetches a specific repo', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/repos/idea/gigi`, () => {
          return HttpResponse.json({
            id: 1, name: 'gigi', full_name: 'idea/gigi',
            owner: { id: 1, login: 'idea', full_name: 'Idea Org', email: '', avatar_url: '', html_url: '' },
            html_url: '', clone_url: '', default_branch: 'main',
            archived: false, stars_count: 0, forks_count: 0, open_issues_count: 0, description: '',
          })
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      const repo = await client.repos.get('idea', 'gigi')
      assert.equal(repo.name, 'gigi')
    })
  })

  describe('issues', () => {
    it('get() fetches a specific issue', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/repos/idea/gigi/issues/42`, () => {
          return HttpResponse.json({
            id: 42, number: 42, title: 'Test issue', body: '', state: 'open',
            html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
            labels: [], comments: 0, created_at: '', updated_at: '',
          })
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      const issue = await client.issues.get('idea', 'gigi', 42)
      assert.equal(issue.number, 42)
      assert.equal(issue.title, 'Test issue')
    })

    it('create() sends POST with body', async () => {
      let capturedBody: unknown
      server.use(
        http.post(`${BASE_URL}/api/v1/repos/idea/gigi/issues`, async ({ request }) => {
          capturedBody = await request.json()
          return HttpResponse.json({
            id: 100, number: 100, title: 'New issue', body: 'Description', state: 'open',
            html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
            labels: [], comments: 0, created_at: '', updated_at: '',
          })
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      const issue = await client.issues.create('idea', 'gigi', {
        title: 'New issue',
        body: 'Description',
      })
      assert.equal(issue.number, 100)
      assert.deepEqual((capturedBody as Record<string, unknown>).title, 'New issue')
    })
  })

  describe('error handling', () => {
    it('throws GiteaApiError on 404', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/repos/idea/nonexistent`, () => {
          return HttpResponse.json({ message: 'Not Found' }, { status: 404 })
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      try {
        await client.repos.get('idea', 'nonexistent')
        assert.fail('should have thrown')
      } catch (err) {
        assert.ok(err instanceof GiteaApiError)
        assert.equal(err.status, 404)
        assert.ok(err.isNotFound)
      }
    })

    it('throws GiteaApiError on 401', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/user`, () => {
          return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      try {
        await client.users.me()
        assert.fail('should have thrown')
      } catch (err) {
        assert.ok(err instanceof GiteaApiError)
        assert.equal(err.status, 401)
        assert.ok(err.isUnauthorized)
      }
    })

    it('throws GiteaApiError on 422 validation', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v1/repos/idea/gigi/issues`, () => {
          return HttpResponse.json({ message: 'Validation Failed' }, { status: 422 })
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      try {
        await client.issues.create('idea', 'gigi', { title: '' })
        assert.fail('should have thrown')
      } catch (err) {
        assert.ok(err instanceof GiteaApiError)
        assert.ok(err.isValidation)
      }
    })
  })

  describe('pulls', () => {
    it('getDiff() returns raw text', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/repos/idea/gigi/pulls/10.diff`, () => {
          return new HttpResponse('diff --git a/file.ts b/file.ts\n+new line', {
            headers: { 'Content-Type': 'text/plain' },
          })
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      const diff = await client.pulls.getDiff('idea', 'gigi', 10)
      assert.ok(diff.includes('diff --git'))
    })
  })

  describe('orgs', () => {
    it('list() fetches authenticated user orgs', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/user/orgs`, () => {
          return HttpResponse.json([
            { id: 1, name: 'idea', username: 'idea', avatar_url: '', description: '' },
          ])
        })
      )

      const client = createGiteaClient(BASE_URL, TOKEN)
      const orgs = await client.orgs.list()
      assert.equal(orgs.length, 1)
      assert.equal(orgs[0].name, 'idea')
    })
  })
})
