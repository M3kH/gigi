/**
 * CI Monitor Tests
 *
 * Tests for the CI auto-monitor feature (#152):
 *
 * 1. Payload parsing — workflow_run and workflow_job event parsing
 * 2. Retry tracking — guard rails to prevent infinite fix loops
 * 3. Message building — failure context message construction
 * 4. CI router — routing logic for workflow events
 */

import assert from 'node:assert/strict'

import {
  parseWorkflowRunPayload,
  parseWorkflowJobPayload,
  shouldAutoFix,
  trackFixAttempt,
  resetFixAttempts,
  getFixAttempts,
  buildCIFailureMessage,
  MAX_FIX_ATTEMPTS,
  type CIRunInfo,
  type CIJobLog,
} from '../lib/core/ci-monitor'

// ─── Test Fixtures ──────────────────────────────────────────────────

function makeWorkflowRunPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'completed',
    repository: {
      name: 'gigi',
      full_name: 'gigi/gigi',
      owner: { login: 'gigi' },
    },
    workflow_run: {
      id: 42,
      name: 'Test Pull Request',
      head_branch: 'feat/my-feature',
      head_sha: 'abc123def456',
      status: 'completed',
      conclusion: 'failure',
      event: 'pull_request',
      html_url: 'https://gitea.local/gigi/gigi/actions/runs/42',
      pull_requests: [{ number: 10 }],
      ...overrides,
    },
  }
}

function makeWorkflowJobPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'completed',
    repository: {
      name: 'gigi',
      full_name: 'gigi/gigi',
      owner: { login: 'gigi' },
    },
    workflow_job: {
      id: 99,
      run_id: 42,
      name: 'test',
      workflow_name: 'Test Pull Request',
      head_branch: 'feat/my-feature',
      head_sha: 'abc123def456',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://gitea.local/gigi/gigi/actions/runs/42/jobs/99',
      ...overrides,
    },
  }
}

function makeRunInfo(overrides: Partial<CIRunInfo> = {}): CIRunInfo {
  return {
    runId: 42,
    repo: 'gigi',
    owner: 'gigi',
    branch: 'feat/my-feature',
    headSha: 'abc123def456',
    workflowName: 'Test Pull Request',
    conclusion: 'failure',
    prNumber: 10,
    htmlUrl: 'https://gitea.local/gigi/gigi/actions/runs/42',
    ...overrides,
  }
}

// ─── Payload Parsing ────────────────────────────────────────────────

describe('parseWorkflowRunPayload', () => {
  it('parses a completed failure workflow_run', () => {
    const result = parseWorkflowRunPayload(makeWorkflowRunPayload())
    assert.ok(result)
    assert.equal(result.runId, 42)
    assert.equal(result.repo, 'gigi')
    assert.equal(result.owner, 'gigi')
    assert.equal(result.branch, 'feat/my-feature')
    assert.equal(result.headSha, 'abc123def456')
    assert.equal(result.workflowName, 'Test Pull Request')
    assert.equal(result.conclusion, 'failure')
    assert.equal(result.prNumber, 10)
    assert.equal(result.htmlUrl, 'https://gitea.local/gigi/gigi/actions/runs/42')
  })

  it('parses a completed success workflow_run', () => {
    const result = parseWorkflowRunPayload(
      makeWorkflowRunPayload({ conclusion: 'success' })
    )
    assert.ok(result)
    assert.equal(result.conclusion, 'success')
  })

  it('returns null for non-completed actions', () => {
    const payload = makeWorkflowRunPayload()
    payload.action = 'in_progress'
    const result = parseWorkflowRunPayload(payload)
    assert.equal(result, null)
  })

  it('returns null for missing workflow_run', () => {
    const result = parseWorkflowRunPayload({
      action: 'completed',
      repository: { name: 'gigi' },
    })
    assert.equal(result, null)
  })

  it('returns null for missing repository', () => {
    const result = parseWorkflowRunPayload({
      action: 'completed',
      workflow_run: { id: 42, conclusion: 'failure' },
    })
    assert.equal(result, null)
  })

  it('handles missing pull_requests array', () => {
    const payload = makeWorkflowRunPayload()
    delete (payload.workflow_run as Record<string, unknown>).pull_requests
    const result = parseWorkflowRunPayload(payload)
    assert.ok(result)
    assert.equal(result.prNumber, undefined)
  })

  it('extracts owner from full_name if owner.login is missing', () => {
    const payload = makeWorkflowRunPayload()
    delete (payload.repository as Record<string, unknown>).owner
    const result = parseWorkflowRunPayload(payload)
    assert.ok(result)
    assert.equal(result.owner, 'gigi')
  })
})

describe('parseWorkflowJobPayload', () => {
  it('parses a completed failure workflow_job', () => {
    const result = parseWorkflowJobPayload(makeWorkflowJobPayload())
    assert.ok(result)
    assert.equal(result.runId, 42)
    assert.equal(result.repo, 'gigi')
    assert.equal(result.owner, 'gigi')
    assert.equal(result.branch, 'feat/my-feature')
    assert.equal(result.conclusion, 'failure')
    assert.equal(result.workflowName, 'Test Pull Request')
  })

  it('returns null for non-completed actions', () => {
    const payload = makeWorkflowJobPayload()
    payload.action = 'started'
    const result = parseWorkflowJobPayload(payload)
    assert.equal(result, null)
  })

  it('returns null for missing workflow_job', () => {
    const result = parseWorkflowJobPayload({
      action: 'completed',
      repository: { name: 'gigi' },
    })
    assert.equal(result, null)
  })
})

// ─── Retry Tracking ─────────────────────────────────────────────────

describe('retry tracking', () => {
  beforeEach(() => {
    // Reset state between tests
    resetFixAttempts('gigi', 'gigi', 999)
  })

  it('starts with 0 attempts', () => {
    assert.equal(getFixAttempts('gigi', 'gigi', 999), 0)
  })

  it('allows auto-fix when under max attempts', () => {
    assert.equal(shouldAutoFix('gigi', 'gigi', 999), true)
  })

  it('tracks fix attempts', () => {
    const attempt1 = trackFixAttempt('gigi', 'gigi', 999)
    assert.equal(attempt1, 1)
    assert.equal(getFixAttempts('gigi', 'gigi', 999), 1)

    const attempt2 = trackFixAttempt('gigi', 'gigi', 999)
    assert.equal(attempt2, 2)
    assert.equal(getFixAttempts('gigi', 'gigi', 999), 2)
  })

  it('blocks auto-fix after max attempts', () => {
    for (let i = 0; i < MAX_FIX_ATTEMPTS; i++) {
      trackFixAttempt('gigi', 'gigi', 999)
    }
    assert.equal(shouldAutoFix('gigi', 'gigi', 999), false)
  })

  it('resets fix attempts', () => {
    trackFixAttempt('gigi', 'gigi', 999)
    trackFixAttempt('gigi', 'gigi', 999)
    assert.equal(getFixAttempts('gigi', 'gigi', 999), 2)

    resetFixAttempts('gigi', 'gigi', 999)
    assert.equal(getFixAttempts('gigi', 'gigi', 999), 0)
    assert.equal(shouldAutoFix('gigi', 'gigi', 999), true)
  })

  it('tracks different PRs independently', () => {
    trackFixAttempt('gigi', 'gigi', 1)
    trackFixAttempt('gigi', 'gigi', 1)
    trackFixAttempt('gigi', 'gigi', 2)

    assert.equal(getFixAttempts('gigi', 'gigi', 1), 2)
    assert.equal(getFixAttempts('gigi', 'gigi', 2), 1)
    assert.equal(shouldAutoFix('gigi', 'gigi', 1), false)
    assert.equal(shouldAutoFix('gigi', 'gigi', 2), true)
  })

  it('tracks different repos independently', () => {
    trackFixAttempt('gigi', 'gigi', 5)
    trackFixAttempt('gigi', 'other-repo', 5)

    assert.equal(getFixAttempts('gigi', 'gigi', 5), 1)
    assert.equal(getFixAttempts('gigi', 'other-repo', 5), 1)
  })
})

// ─── Message Building ───────────────────────────────────────────────

describe('buildCIFailureMessage', () => {
  it('builds a message with all run info', () => {
    const runInfo = makeRunInfo()
    const logs: CIJobLog[] = [{
      jobName: 'test',
      log: 'FAIL src/index.test.ts\n  ✕ should work (5ms)\n\nError: expected true but got false',
    }]

    const message = buildCIFailureMessage(runInfo, logs, 1)

    assert.ok(message.includes('[CI Failure — Auto-fix attempt 1/2]'))
    assert.ok(message.includes('Test Pull Request'))
    assert.ok(message.includes('gigi/gigi'))
    assert.ok(message.includes('feat/my-feature'))
    assert.ok(message.includes('abc123de'))
    assert.ok(message.includes('#10'), 'should include PR number')
    assert.ok(message.includes('FAIL src/index.test.ts'))
    assert.ok(message.includes('expected true but got false'))
  })

  it('handles missing logs gracefully', () => {
    const runInfo = makeRunInfo()
    const message = buildCIFailureMessage(runInfo, [], 1)

    assert.ok(message.includes('No logs could be fetched'))
  })

  it('truncates very long logs', () => {
    const runInfo = makeRunInfo()
    const longLog = 'x'.repeat(5000)
    const logs: CIJobLog[] = [{ jobName: 'test', log: longLog }]

    const message = buildCIFailureMessage(runInfo, logs, 1)

    assert.ok(message.includes('truncated'))
    // Should contain the LAST 4000 chars (tail), not the first
    assert.ok(message.length < longLog.length + 500)
  })

  it('shows warning on last attempt', () => {
    const runInfo = makeRunInfo()
    const message = buildCIFailureMessage(runInfo, [], MAX_FIX_ATTEMPTS)

    assert.ok(message.includes('last auto-fix attempt'))
    assert.ok(message.includes('operator will be notified'))
  })

  it('does not show warning on first attempt', () => {
    const runInfo = makeRunInfo()
    const message = buildCIFailureMessage(runInfo, [], 1)

    assert.ok(!message.includes('last auto-fix attempt'))
  })

  it('handles missing optional fields', () => {
    const runInfo = makeRunInfo({ prNumber: undefined, htmlUrl: undefined })
    const message = buildCIFailureMessage(runInfo, [], 1)

    assert.ok(!message.includes('PR:'))
    assert.ok(!message.includes('Run URL:'))
  })

  it('includes multiple job logs', () => {
    const runInfo = makeRunInfo()
    const logs: CIJobLog[] = [
      { jobName: 'typecheck', log: 'error TS2345: Argument of type...' },
      { jobName: 'test', log: 'FAIL tests/foo.test.ts' },
    ]

    const message = buildCIFailureMessage(runInfo, logs, 1)

    assert.ok(message.includes('### Job: typecheck'))
    assert.ok(message.includes('### Job: test'))
    assert.ok(message.includes('error TS2345'))
    assert.ok(message.includes('FAIL tests/foo.test.ts'))
  })
})

// ─── MAX_FIX_ATTEMPTS constant ──────────────────────────────────────

describe('MAX_FIX_ATTEMPTS', () => {
  it('is 2', () => {
    assert.equal(MAX_FIX_ATTEMPTS, 2)
  })
})
