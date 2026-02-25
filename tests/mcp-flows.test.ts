/**
 * MCP Flow Integration Tests
 *
 * Tests end-to-end flows through the tool registry with mocked external services:
 *
 * 1. Gitea tool → API calls (MSW-mocked)
 * 2. ask_user tool → HTTP bridge → event bus → answer resolution
 * 3. Gitea create_repo → action logging for webhook filtering
 * 4. Input validation across all tools
 */

import { describe, it, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { subscribe, emit, type AgentEvent } from '../lib/core/events'
import { askUser, answerQuestion, hasPendingQuestion } from '../lib/core/ask-user'
import { runGitea, type GiteaInput } from '../lib/tools/gitea'
import {
  registerTools,
  clearRegistry,
  executeTool,
} from '../lib/core/registry'
import { agentTools as giteaTools } from '../lib/tools/gitea'
import { agentTools as askUserTools } from '../lib/tools/ask-user'
import {
  createToolFailureHandler,
  handlePreToolUse,
  type ToolFailureInput,
} from '../lib/core/agent'

// ─── MSW Setup ──────────────────────────────────────────────────────

const GITEA_URL = 'http://localhost:3300'

// Track which API endpoints were called
const apiCalls: Array<{ method: string; path: string; body?: unknown }> = []

const handlers = [
  // Gitea: list repos
  http.get(`${GITEA_URL}/api/v1/user/repos`, () => {
    apiCalls.push({ method: 'GET', path: '/user/repos' })
    return HttpResponse.json([
      { id: 1, name: 'gigi', full_name: 'gigi/gigi', html_url: `${GITEA_URL}/gigi/gigi` },
      { id: 2, name: 'website', full_name: 'gigi/website', html_url: `${GITEA_URL}/gigi/website` },
    ])
  }),

  // Gitea: create repo under org
  http.post(`${GITEA_URL}/api/v1/orgs/:owner/repos`, async ({ request, params }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: `/orgs/${params.owner}/repos`, body })
    return HttpResponse.json({
      id: 99,
      name: (body as Record<string, unknown>).name,
      full_name: `${params.owner}/${(body as Record<string, unknown>).name}`,
      number: 99,
    })
  }),

  // Gitea: create repo under user
  http.post(`${GITEA_URL}/api/v1/user/repos`, async ({ request }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: '/user/repos', body })
    return HttpResponse.json({
      id: 100,
      name: (body as Record<string, unknown>).name,
      number: 100,
    })
  }),

  // Gitea: list issues
  http.get(`${GITEA_URL}/api/v1/repos/:owner/:repo/issues`, ({ params }) => {
    apiCalls.push({ method: 'GET', path: `/repos/${params.owner}/${params.repo}/issues` })
    return HttpResponse.json([
      { id: 1, number: 1, title: 'Test issue', state: 'open' },
    ])
  }),

  // Gitea: get issue
  http.get(`${GITEA_URL}/api/v1/repos/:owner/:repo/issues/:number`, ({ params }) => {
    apiCalls.push({ method: 'GET', path: `/repos/${params.owner}/${params.repo}/issues/${params.number}` })
    return HttpResponse.json({
      id: 1, number: Number(params.number), title: 'Test issue', state: 'open', body: 'Description',
    })
  }),

  // Gitea: create issue
  http.post(`${GITEA_URL}/api/v1/repos/:owner/:repo/issues`, async ({ request, params }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: `/repos/${params.owner}/${params.repo}/issues`, body })
    return HttpResponse.json({
      id: 5, number: 5, title: (body as Record<string, unknown>).title, state: 'open',
    })
  }),

  // Gitea: comment on issue
  http.post(`${GITEA_URL}/api/v1/repos/:owner/:repo/issues/:number/comments`, async ({ request, params }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: `/repos/${params.owner}/${params.repo}/issues/${params.number}/comments`, body })
    return HttpResponse.json({
      id: 10, body: (body as Record<string, unknown>).body,
    })
  }),

  // Gitea: list PRs
  http.get(`${GITEA_URL}/api/v1/repos/:owner/:repo/pulls`, ({ params }) => {
    apiCalls.push({ method: 'GET', path: `/repos/${params.owner}/${params.repo}/pulls` })
    return HttpResponse.json([])
  }),

  // Gitea: get PR
  http.get(`${GITEA_URL}/api/v1/repos/:owner/:repo/pulls/:number`, ({ params }) => {
    apiCalls.push({ method: 'GET', path: `/repos/${params.owner}/${params.repo}/pulls/${params.number}` })
    return HttpResponse.json({
      id: 1, number: Number(params.number), title: 'Test PR', state: 'open',
    })
  }),

  // Gitea: create PR
  http.post(`${GITEA_URL}/api/v1/repos/:owner/:repo/pulls`, async ({ request, params }) => {
    const body = await request.json()
    apiCalls.push({ method: 'POST', path: `/repos/${params.owner}/${params.repo}/pulls`, body })
    return HttpResponse.json({
      id: 3, number: 3, title: (body as Record<string, unknown>).title,
    })
  }),
]

const server = setupServer(...handlers)

// ─── Test Lifecycle ──────────────────────────────────────────────────

// Set env vars that the tools read
process.env.GITEA_URL = GITEA_URL
process.env.GITEA_TOKEN = 'test-token'
process.env.PORT = '19876' // Use port nothing listens on — ask_user fails fast with ECONNREFUSED

after(() => {
  server.close()
})

// ─── Gitea API Flows ─────────────────────────────────────────────────

describe('Gitea Tool → API Flows', () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
    apiCalls.length = 0
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('list_repos should call GET /user/repos', async () => {
    const result = await runGitea({ action: 'list_repos' })

    assert.equal(apiCalls.length, 1)
    assert.equal(apiCalls[0].method, 'GET')
    assert.equal(apiCalls[0].path, '/user/repos')
    assert.ok(Array.isArray(result))
    assert.equal((result as Array<{ name: string }>).length, 2)
  })

  it('create_repo with owner should call POST /orgs/{owner}/repos', async () => {
    const result = await runGitea({
      action: 'create_repo',
      owner: 'gigi',
      repo: 'test-project',
      body: 'A test project',
    })

    assert.equal(apiCalls.length, 1)
    assert.equal(apiCalls[0].method, 'POST')
    assert.equal(apiCalls[0].path, '/orgs/gigi/repos')
    assert.deepEqual((apiCalls[0].body as Record<string, unknown>).name, 'test-project')
    assert.deepEqual((apiCalls[0].body as Record<string, unknown>).description, 'A test project')
    assert.ok(result)
  })

  it('create_repo without owner should call POST /user/repos', async () => {
    await runGitea({ action: 'create_repo', repo: 'personal-project' })

    assert.equal(apiCalls.length, 1)
    assert.equal(apiCalls[0].path, '/user/repos')
  })

  it('list_issues should call correct endpoint with owner/repo', async () => {
    const result = await runGitea({ action: 'list_issues', owner: 'gigi', repo: 'gigi' })

    assert.equal(apiCalls[0].path, '/repos/gigi/gigi/issues')
    assert.ok(Array.isArray(result))
  })

  it('get_issue should include issue number in path', async () => {
    await runGitea({ action: 'get_issue', owner: 'gigi', repo: 'gigi', number: 42 })

    assert.equal(apiCalls[0].path, '/repos/gigi/gigi/issues/42')
  })

  it('create_issue should send title and body', async () => {
    const result = await runGitea({
      action: 'create_issue',
      owner: 'gigi',
      repo: 'gigi',
      title: 'Bug: something broken',
      body: 'Steps to reproduce...',
    })

    assert.equal(apiCalls[0].method, 'POST')
    assert.equal(apiCalls[0].path, '/repos/gigi/gigi/issues')
    assert.equal((apiCalls[0].body as Record<string, unknown>).title, 'Bug: something broken')
    assert.equal((apiCalls[0].body as Record<string, unknown>).body, 'Steps to reproduce...')
    assert.equal((result as { number: number }).number, 5)
  })

  it('comment_issue should POST to issue comments endpoint', async () => {
    await runGitea({
      action: 'comment_issue',
      owner: 'gigi',
      repo: 'gigi',
      number: 1,
      body: 'Fixed in PR #3',
    })

    assert.equal(apiCalls[0].path, '/repos/gigi/gigi/issues/1/comments')
    assert.equal((apiCalls[0].body as Record<string, unknown>).body, 'Fixed in PR #3')
  })

  it('create_pr should send title, body, head, base', async () => {
    const result = await runGitea({
      action: 'create_pr',
      owner: 'gigi',
      repo: 'gigi',
      title: 'feat: add ask_user',
      body: 'Closes #5',
      head: 'feat/ask-user',
      base: 'main',
    })

    assert.equal(apiCalls[0].path, '/repos/gigi/gigi/pulls')
    assert.equal((apiCalls[0].body as Record<string, unknown>).title, 'feat: add ask_user')
    assert.equal((apiCalls[0].body as Record<string, unknown>).head, 'feat/ask-user')
    assert.equal((apiCalls[0].body as Record<string, unknown>).base, 'main')
    assert.equal((result as { number: number }).number, 3)
  })

  it('unknown action should return error message', async () => {
    const result = await runGitea({ action: 'delete_everything' } as GiteaInput)
    assert.equal(result, 'Unknown action: delete_everything')
  })

  it('should include Authorization header', async () => {
    let capturedAuth = ''
    server.use(
      http.get(`${GITEA_URL}/api/v1/user/repos`, ({ request }) => {
        capturedAuth = request.headers.get('Authorization') || ''
        return HttpResponse.json([])
      })
    )

    await runGitea({ action: 'list_repos' })
    assert.equal(capturedAuth, 'token test-token')
  })
})

// ─── ask_user Event Bus Flow ─────────────────────────────────────────

describe('ask_user → Event Bus → Answer Flow', () => {
  it('should emit ask_user event with question data', async () => {
    const events: AgentEvent[] = []
    const unsub = subscribe((e) => events.push(e))

    // Start the question (don't await — it blocks)
    const answerPromise = askUser('q-test-1', 'Pick a color', ['Red', 'Blue'], 'conv-123')

    // Event should be emitted immediately
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'ask_user')
    assert.equal(events[0].questionId, 'q-test-1')
    assert.equal(events[0].question, 'Pick a color')
    assert.deepEqual(events[0].options, ['Red', 'Blue'])
    assert.equal(events[0].conversationId, 'conv-123')

    // Resolve it
    answerQuestion('q-test-1', 'Blue')
    const answer = await answerPromise
    assert.equal(answer, 'Blue')

    unsub()
  })

  it('should block until user answers', async () => {
    let resolved = false

    const answerPromise = askUser('q-test-2', 'Yes or no?', ['Yes', 'No'])
    answerPromise.then(() => { resolved = true })

    // Should still be pending
    await new Promise(r => setTimeout(r, 50))
    assert.equal(resolved, false, 'Should not resolve before answer')
    assert.ok(hasPendingQuestion('q-test-2'))

    // Answer it
    answerQuestion('q-test-2', 'Yes')
    await answerPromise
    assert.equal(resolved, true)
    assert.ok(!hasPendingQuestion('q-test-2'))
  })

  it('should handle free-form answer (no options)', async () => {
    const events: AgentEvent[] = []
    const unsub = subscribe((e) => events.push(e))

    const answerPromise = askUser('q-test-3', 'What name?')

    assert.deepEqual(events[0].options, [])

    answerQuestion('q-test-3', 'kids-book-share')
    const answer = await answerPromise
    assert.equal(answer, 'kids-book-share')

    unsub()
  })

  it('should return false for unknown questionId', () => {
    const result = answerQuestion('nonexistent', 'whatever')
    assert.equal(result, false)
  })

  it('should handle multiple concurrent questions', async () => {
    const p1 = askUser('q-multi-1', 'First?', ['A', 'B'])
    const p2 = askUser('q-multi-2', 'Second?', ['X', 'Y'])

    assert.ok(hasPendingQuestion('q-multi-1'))
    assert.ok(hasPendingQuestion('q-multi-2'))

    answerQuestion('q-multi-2', 'Y')
    answerQuestion('q-multi-1', 'A')

    assert.equal(await p1, 'A')
    assert.equal(await p2, 'Y')
  })
})

// ─── Registry Integration ──────────────────────────────────────────

describe('Tool Registry Integration', () => {
  beforeEach(() => {
    clearRegistry()
    server.listen({ onUnhandledRequest: 'bypass' })
    apiCalls.length = 0
  })

  afterEach(() => {
    server.resetHandlers()
    clearRegistry()
  })

  it('gitea tool should be callable through registry', async () => {
    registerTools(giteaTools)

    const { result, error } = await executeTool('gitea', { action: 'list_repos' })

    assert.equal(error, undefined)
    assert.ok(Array.isArray(result))
    assert.ok(apiCalls.length >= 1, `Expected at least 1 API call, got ${apiCalls.length}`)
  })

  it('gitea tool should validate action enum', async () => {
    registerTools(giteaTools)

    const { error } = await executeTool('gitea', { action: 'hack_the_planet' })
    assert.ok(error)
    assert.match(error!, /Invalid input/)
  })

  it('ask_user tool should validate required question field', async () => {
    registerTools(askUserTools)

    const { error } = await executeTool('ask_user', {})
    assert.ok(error)
    assert.match(error!, /Invalid input/)
  })

  it('ask_user tool should accept valid input through registry', async () => {
    registerTools(askUserTools)

    // This will try to connect to localhost:3000 and fail gracefully
    const { result, error } = await executeTool('ask_user', {
      question: 'Test?',
      options: ['Yes', 'No'],
    })

    assert.equal(error, undefined)
    // Should return a failure message since no server is running
    assert.ok(typeof result === 'string')
    assert.ok((result as string).includes('Failed to ask user'))
  })
})

// ─── Gitea API Error Handling ───────────────────────────────────────

describe('Gitea Tool Error Handling', () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
    apiCalls.length = 0
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('should return error message on 404', async () => {
    server.use(
      http.get(`${GITEA_URL}/api/v1/repos/gigi/nonexistent/issues/999`, () => {
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 })
      })
    )

    const result = await runGitea({ action: 'get_issue', owner: 'gigi', repo: 'nonexistent', number: 999 })
    assert.ok(typeof result === 'string')
    assert.ok((result as string).includes('404'))
  })

  it('should return error message on 500', async () => {
    server.use(
      http.get(`${GITEA_URL}/api/v1/user/repos`, () => {
        return HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
      })
    )

    const result = await runGitea({ action: 'list_repos' })
    assert.ok(typeof result === 'string')
    assert.ok((result as string).includes('500'))
  })

  it('should handle missing credentials gracefully', async () => {
    const savedToken = process.env.GITEA_TOKEN
    const savedUrl = process.env.GITEA_URL
    process.env.GITEA_TOKEN = ''
    process.env.GITEA_URL = ''

    const result = await runGitea({ action: 'list_repos' })

    // Restore
    process.env.GITEA_TOKEN = savedToken
    process.env.GITEA_URL = savedUrl

    // With empty token and no DB, getConfig returns null → "not configured"
    assert.equal(result, 'Gitea not configured — complete setup first')
  })
})

// ─── Agent Hook Tests ───────────────────────────────────────────────

describe('Agent Hooks — PostToolUseFailure', () => {
  it('Read tool EISDIR error should return retry guidance', async () => {
    const { handler } = createToolFailureHandler()

    const result = await handler({
      tool_name: 'Read',
      tool_input: { file_path: '/workspace/gigi' },
      error: 'EISDIR: illegal operation on a directory, read',
    })

    assert.ok(result.systemMessage.includes('Read'))
    assert.ok(result.systemMessage.includes('attempt 1/3'))
    assert.ok(result.systemMessage.includes('EISDIR'))
    // Should suggest fixes for file operations
    assert.ok(result.systemMessage.includes('File not found') || result.systemMessage.includes('fix'))
  })

  it('same failure 3 times should give up and ask for help', async () => {
    const { handler } = createToolFailureHandler()

    const input: ToolFailureInput = {
      tool_name: 'Read',
      tool_input: { file_path: '/workspace/gigi' },
      error: 'EISDIR: illegal operation on a directory, read',
    }

    // First two attempts — retry guidance
    const r1 = await handler(input)
    assert.ok(r1.systemMessage.includes('attempt 1/3'))

    const r2 = await handler(input)
    assert.ok(r2.systemMessage.includes('attempt 2/3'))
    assert.ok(r2.systemMessage.includes('2nd attempt'))

    // Third attempt — give up
    const r3 = await handler(input)
    assert.ok(r3.systemMessage.includes('failed 3 times'))
    assert.ok(r3.systemMessage.includes('Do NOT retry'))
    assert.ok(r3.systemMessage.includes('ask for help'))
  })

  it('different inputs should track separately', async () => {
    const { handler } = createToolFailureHandler()

    await handler({ tool_name: 'Read', tool_input: { file_path: '/a' }, error: 'EISDIR' })
    await handler({ tool_name: 'Read', tool_input: { file_path: '/a' }, error: 'EISDIR' })

    // Different file path = separate counter
    const r = await handler({ tool_name: 'Read', tool_input: { file_path: '/b' }, error: 'ENOENT' })
    assert.ok(r.systemMessage.includes('attempt 1/3'), 'Different input should start at attempt 1')
  })

  it('Bash exit code failure should include investigation guidance', async () => {
    const { handler } = createToolFailureHandler()

    const result = await handler({
      tool_name: 'Bash',
      tool_input: { command: 'npm list' },
      error: 'Exit code 1: ...',
    })

    assert.ok(result.systemMessage.includes('Bash command failed'))
    assert.ok(result.systemMessage.includes('Exit codes don\'t always mean failure'))
    assert.ok(result.systemMessage.includes('Investigate'))
  })

  it('Bash non-exit-code failure should get generic guidance', async () => {
    const { handler } = createToolFailureHandler()

    const result = await handler({
      tool_name: 'Bash',
      tool_input: { command: 'something' },
      error: 'Command timed out',
    })

    // Should NOT get the exit code specific message
    assert.ok(!result.systemMessage.includes('Exit codes don\'t always mean failure'))
    assert.ok(result.systemMessage.includes('Analyze the error'))
  })
})

describe('Agent Hooks — PreToolUse', () => {
  it('AskUserQuestion should be denied with redirect to ask_user MCP', async () => {
    const result = await handlePreToolUse({ tool_name: 'AskUserQuestion' })

    const output = result.hookSpecificOutput as {
      hookEventName: string
      permissionDecision: string
      permissionDecisionReason: string
    }

    assert.equal(output.hookEventName, 'PreToolUse')
    assert.equal(output.permissionDecision, 'deny')
    assert.ok(output.permissionDecisionReason.includes('ask_user'))
    assert.ok(output.permissionDecisionReason.includes('MCP'))
  })
})
