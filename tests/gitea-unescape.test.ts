/**
 * Tests for the unescapeText utility used in the Gitea MCP tool.
 *
 * Ensures that literal escape sequences (\n, \t) produced by LLMs
 * in tool-call JSON are properly converted to real characters before
 * being sent to the Gitea API.
 */

import assert from 'node:assert/strict'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { runGitea } from '../lib/tools/gitea'

// ─── Direct unit test of unescapeText (exported indirectly via runGitea) ──

// We test through runGitea by capturing what the API receives.
const BASE = 'http://localhost:9876'
const server = setupServer()

beforeAll(() => {
  process.env.GITEA_URL = BASE
  process.env.GITEA_TOKEN = 'test-token'
  server.listen({ onUnhandledRequest: 'bypass' })
})
afterEach(() => server.resetHandlers())
afterAll(() => {
  delete process.env.GITEA_URL
  delete process.env.GITEA_TOKEN
  server.close()
})

describe('Gitea newline unescaping', () => {
  it('converts literal \\n to real newlines in issue body', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post(`${BASE}/api/v1/repos/idea/gigi/issues`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 1, number: 1, title: 'Test', body: '', state: 'open',
          html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
          labels: [], comments: 0, created_at: '', updated_at: '',
        })
      }),
    )

    await runGitea({
      action: 'create_issue',
      owner: 'idea',
      repo: 'gigi',
      title: 'Line 1\\nLine 2',
      body: '## Summary\\n\\nThis is a test.\\n- Item 1\\n- Item 2',
    })

    assert.equal(capturedBody.title, 'Line 1\nLine 2')
    assert.equal(capturedBody.body, '## Summary\n\nThis is a test.\n- Item 1\n- Item 2')
  })

  it('converts literal \\n to real newlines in PR body', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post(`${BASE}/api/v1/repos/idea/gigi/pulls`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 1, number: 1, title: 'PR', body: '', state: 'open',
          html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
          labels: [], comments: 0, created_at: '', updated_at: '',
        })
      }),
    )

    await runGitea({
      action: 'create_pr',
      owner: 'idea',
      repo: 'gigi',
      title: 'feat: new feature',
      body: '## Summary\\n- Added X\\n- Fixed Y\\n\\nCloses #42',
      head: 'feat/test',
      base: 'main',
    })

    assert.equal(capturedBody.body, '## Summary\n- Added X\n- Fixed Y\n\nCloses #42')
  })

  it('converts literal \\n in issue comments', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post(`${BASE}/api/v1/repos/idea/gigi/issues/5/comments`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 1, body: '', user: { login: 'test', id: 1, avatar_url: '' } })
      }),
    )

    await runGitea({
      action: 'comment_issue',
      owner: 'idea',
      repo: 'gigi',
      number: 5,
      body: 'First line\\nSecond line\\n\\nThird paragraph',
    })

    assert.equal(capturedBody.body, 'First line\nSecond line\n\nThird paragraph')
  })

  it('converts literal \\t to real tabs', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post(`${BASE}/api/v1/repos/idea/gigi/issues`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 1, number: 1, title: 'Test', body: '', state: 'open',
          html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
          labels: [], comments: 0, created_at: '', updated_at: '',
        })
      }),
    )

    await runGitea({
      action: 'create_issue',
      owner: 'idea',
      repo: 'gigi',
      title: 'Test',
      body: 'Code:\\n\\tindented line',
    })

    assert.equal(capturedBody.body, 'Code:\n\tindented line')
  })

  it('leaves strings without escape sequences unchanged', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post(`${BASE}/api/v1/repos/idea/gigi/issues`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 1, number: 1, title: 'Test', body: '', state: 'open',
          html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
          labels: [], comments: 0, created_at: '', updated_at: '',
        })
      }),
    )

    await runGitea({
      action: 'create_issue',
      owner: 'idea',
      repo: 'gigi',
      title: 'Simple title',
      body: 'Simple body with no escapes',
    })

    assert.equal(capturedBody.title, 'Simple title')
    assert.equal(capturedBody.body, 'Simple body with no escapes')
  })

  it('handles real newlines (already correct) without double-converting', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post(`${BASE}/api/v1/repos/idea/gigi/issues`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 1, number: 1, title: 'Test', body: '', state: 'open',
          html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
          labels: [], comments: 0, created_at: '', updated_at: '',
        })
      }),
    )

    await runGitea({
      action: 'create_issue',
      owner: 'idea',
      repo: 'gigi',
      title: 'Test',
      body: 'Line 1\nLine 2\nLine 3',
    })

    // Real newlines should pass through unchanged
    assert.equal(capturedBody.body, 'Line 1\nLine 2\nLine 3')
  })

  it('handles undefined body gracefully', async () => {
    server.use(
      http.post(`${BASE}/api/v1/repos/idea/gigi/issues`, async () => {
        return HttpResponse.json({
          id: 1, number: 1, title: 'Test', body: '', state: 'open',
          html_url: '', user: { login: 'test', id: 1, avatar_url: '' },
          labels: [], comments: 0, created_at: '', updated_at: '',
        })
      }),
    )

    // Should not throw when body is undefined
    const result = await runGitea({
      action: 'create_issue',
      owner: 'idea',
      repo: 'gigi',
      title: 'No body',
    })
    assert.ok(result)
  })
})
