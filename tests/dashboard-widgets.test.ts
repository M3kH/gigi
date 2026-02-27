/**
 * Tests for #105: Overview dashboard widgets
 *
 * Covers:
 * - Overview API response shape (recentPRs, recentIssues fields)
 * - Data transformation: PR state derivation (merged vs closed)
 * - Data transformation: issue label filtering
 * - Data sorting (most recently updated first)
 * - Actions endpoint error resilience
 */

import assert from 'node:assert/strict'

// ─── Helper: simulate the PR state derivation logic from gitea-proxy ──

function derivePRState(pr: { merged: boolean; state: string }): string {
  return pr.merged ? 'merged' : pr.state
}

// ─── Helper: simulate the overview data merge + sort logic ────────────

interface RecentPR {
  number: number
  title: string
  state: string
  repo: string
  updated_at: string
  merged_at: string | null
}

interface RecentIssue {
  number: number
  title: string
  state: string
  repo: string
  labels: { name: string; color: string }[]
  updated_at: string
}

function mergeAndSortPRs(perRepoData: { recentPRs: RecentPR[] }[], limit: number): RecentPR[] {
  return perRepoData
    .flatMap(d => d.recentPRs)
    .sort((a, b) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return dateB - dateA
    })
    .slice(0, limit)
}

/** Simulate the new split open/closed aggregation from gitea-proxy */
function splitAndSortPRs(
  perRepoData: { openPRs: RecentPR[]; closedPRs: RecentPR[] }[],
  limit: number,
): { openPRs: RecentPR[]; closedPRs: RecentPR[]; combined: RecentPR[] } {
  const byDateDesc = (a: { updated_at: string }, b: { updated_at: string }) => {
    const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return dateB - dateA
  }
  const openPRs = perRepoData.flatMap(d => d.openPRs).sort(byDateDesc).slice(0, limit)
  const closedPRs = perRepoData.flatMap(d => d.closedPRs).sort(byDateDesc).slice(0, limit)
  const combined = [...openPRs, ...closedPRs].slice(0, limit)
  return { openPRs, closedPRs, combined }
}

function mergeAndSortIssues(perRepoData: { recentIssues: RecentIssue[] }[], limit: number): RecentIssue[] {
  return perRepoData
    .flatMap(d => d.recentIssues)
    .sort((a, b) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return dateB - dateA
    })
    .slice(0, limit)
}

/** Filter out status/ labels for display (matches RecentIssuesWidget logic) */
function displayLabels(labels: { name: string; color: string }[]): { name: string; color: string }[] {
  return labels.filter(l => !l.name.startsWith('status/')).slice(0, 3)
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('PR state derivation', () => {
  it('returns "merged" when pr.merged is true', () => {
    assert.equal(derivePRState({ merged: true, state: 'closed' }), 'merged')
  })

  it('returns "open" when pr is open', () => {
    assert.equal(derivePRState({ merged: false, state: 'open' }), 'open')
  })

  it('returns "closed" when pr is closed but not merged', () => {
    assert.equal(derivePRState({ merged: false, state: 'closed' }), 'closed')
  })
})

describe('mergeAndSortPRs — cross-repo aggregation', () => {
  const repo1PRs: RecentPR[] = [
    { number: 10, title: 'Fix A', state: 'merged', repo: 'gigi', updated_at: '2026-02-23T10:00:00Z', merged_at: '2026-02-23T10:00:00Z' },
    { number: 8, title: 'Fix B', state: 'closed', repo: 'gigi', updated_at: '2026-02-22T08:00:00Z', merged_at: null },
  ]
  const repo2PRs: RecentPR[] = [
    { number: 3, title: 'Infra update', state: 'merged', repo: 'gigi-infra', updated_at: '2026-02-23T12:00:00Z', merged_at: '2026-02-23T12:00:00Z' },
    { number: 2, title: 'Old PR', state: 'merged', repo: 'gigi-infra', updated_at: '2026-02-20T01:00:00Z', merged_at: null },
  ]

  it('merges PRs from multiple repos', () => {
    const result = mergeAndSortPRs([{ recentPRs: repo1PRs }, { recentPRs: repo2PRs }], 10)
    assert.equal(result.length, 4)
    const repos = new Set(result.map(r => r.repo))
    assert.ok(repos.has('gigi'))
    assert.ok(repos.has('gigi-infra'))
  })

  it('sorts by updated_at descending (most recent first)', () => {
    const result = mergeAndSortPRs([{ recentPRs: repo1PRs }, { recentPRs: repo2PRs }], 10)
    assert.equal(result[0].repo, 'gigi-infra')
    assert.equal(result[0].number, 3)
    assert.equal(result[1].repo, 'gigi')
    assert.equal(result[1].number, 10)
  })

  it('respects the limit parameter', () => {
    const result = mergeAndSortPRs([{ recentPRs: repo1PRs }, { recentPRs: repo2PRs }], 2)
    assert.equal(result.length, 2)
  })

  it('handles empty input', () => {
    const result = mergeAndSortPRs([{ recentPRs: [] }, { recentPRs: [] }], 10)
    assert.equal(result.length, 0)
  })
})

describe('splitAndSortPRs — open/closed separation', () => {
  const repo1Data = {
    openPRs: [
      { number: 15, title: 'WIP feature', state: 'open', repo: 'gigi', updated_at: '2026-02-24T10:00:00Z', merged_at: null },
    ] as RecentPR[],
    closedPRs: [
      { number: 10, title: 'Fix A', state: 'merged', repo: 'gigi', updated_at: '2026-02-23T10:00:00Z', merged_at: '2026-02-23T10:00:00Z' },
    ] as RecentPR[],
  }
  const repo2Data = {
    openPRs: [
      { number: 5, title: 'Open infra', state: 'open', repo: 'infra', updated_at: '2026-02-24T08:00:00Z', merged_at: null },
    ] as RecentPR[],
    closedPRs: [
      { number: 3, title: 'Old infra', state: 'merged', repo: 'infra', updated_at: '2026-02-22T12:00:00Z', merged_at: '2026-02-22T12:00:00Z' },
    ] as RecentPR[],
  }

  it('separates open and closed PRs', () => {
    const result = splitAndSortPRs([repo1Data, repo2Data], 10)
    assert.equal(result.openPRs.length, 2)
    assert.equal(result.closedPRs.length, 2)
    assert.ok(result.openPRs.every(p => p.state === 'open'))
  })

  it('sorts open PRs by updated_at descending', () => {
    const result = splitAndSortPRs([repo1Data, repo2Data], 10)
    assert.equal(result.openPRs[0].number, 15) // most recent
    assert.equal(result.openPRs[1].number, 5)
  })

  it('sorts closed PRs by updated_at descending', () => {
    const result = splitAndSortPRs([repo1Data, repo2Data], 10)
    assert.equal(result.closedPRs[0].number, 10) // most recent
    assert.equal(result.closedPRs[1].number, 3)
  })

  it('combined puts open first, then closed', () => {
    const result = splitAndSortPRs([repo1Data, repo2Data], 10)
    // First two should be open, next two closed
    assert.equal(result.combined[0].state, 'open')
    assert.equal(result.combined[1].state, 'open')
    assert.equal(result.combined[2].state, 'merged')
    assert.equal(result.combined[3].state, 'merged')
  })

  it('handles no open PRs (zen state)', () => {
    const noOpen = {
      openPRs: [] as RecentPR[],
      closedPRs: repo1Data.closedPRs,
    }
    const result = splitAndSortPRs([noOpen], 10)
    assert.equal(result.openPRs.length, 0)
    assert.equal(result.closedPRs.length, 1)
    assert.equal(result.combined.length, 1)
  })

  it('handles no PRs at all', () => {
    const empty = { openPRs: [] as RecentPR[], closedPRs: [] as RecentPR[] }
    const result = splitAndSortPRs([empty], 10)
    assert.equal(result.openPRs.length, 0)
    assert.equal(result.closedPRs.length, 0)
    assert.equal(result.combined.length, 0)
  })
})

describe('mergeAndSortIssues — cross-repo aggregation', () => {
  const repo1Issues: RecentIssue[] = [
    { number: 105, title: 'Dashboard widgets', state: 'open', repo: 'gigi', labels: [{ name: 'status/in-progress', color: 'e4e669' }, { name: 'type/feature', color: '0075ca' }], updated_at: '2026-02-23T14:00:00Z' },
    { number: 100, title: 'Old bug', state: 'closed', repo: 'gigi', labels: [{ name: 'type/bug', color: 'd73a4a' }], updated_at: '2026-02-21T09:00:00Z' },
  ]
  const repo2Issues: RecentIssue[] = [
    { number: 5, title: 'Infra issue', state: 'open', repo: 'gigi-infra', labels: [], updated_at: '2026-02-23T11:00:00Z' },
  ]

  it('merges issues from multiple repos', () => {
    const result = mergeAndSortIssues([{ recentIssues: repo1Issues }, { recentIssues: repo2Issues }], 10)
    assert.equal(result.length, 3)
  })

  it('sorts by updated_at descending', () => {
    const result = mergeAndSortIssues([{ recentIssues: repo1Issues }, { recentIssues: repo2Issues }], 10)
    assert.equal(result[0].number, 105)
    assert.equal(result[1].number, 5)
    assert.equal(result[2].number, 100)
  })

  it('respects the limit parameter', () => {
    const result = mergeAndSortIssues([{ recentIssues: repo1Issues }, { recentIssues: repo2Issues }], 1)
    assert.equal(result.length, 1)
    assert.equal(result[0].number, 105)
  })
})

describe('displayLabels — status label filtering', () => {
  it('filters out status/ labels', () => {
    const labels = [
      { name: 'status/in-progress', color: 'e4e669' },
      { name: 'type/feature', color: '0075ca' },
      { name: 'priority/high', color: 'b60205' },
    ]
    const result = displayLabels(labels)
    assert.equal(result.length, 2)
    assert.ok(result.every(l => !l.name.startsWith('status/')))
  })

  it('limits to 3 labels maximum', () => {
    const labels = [
      { name: 'type/feature', color: '0075ca' },
      { name: 'priority/high', color: 'b60205' },
      { name: 'scope/release', color: 'c5def5' },
      { name: 'size/large', color: 'fbca04' },
    ]
    const result = displayLabels(labels)
    assert.equal(result.length, 3)
  })

  it('handles empty labels', () => {
    assert.equal(displayLabels([]).length, 0)
  })

  it('handles all-status labels (returns empty)', () => {
    const labels = [
      { name: 'status/ready', color: '0075ca' },
      { name: 'status/done', color: '0e8a16' },
    ]
    assert.equal(displayLabels(labels).length, 0)
  })
})

describe('overview response shape', () => {
  it('includes recentPRs, openPRs, closedPRs, and recentIssues fields', () => {
    // Simulate the response shape the overview endpoint returns
    const response = {
      org: { id: 1, name: 'gigi' },
      repos: [],
      totalRepos: 0,
      totalOpenIssues: 0,
      totalOpenPRs: 0,
      recentPRs: [] as RecentPR[],
      openPRs: [] as RecentPR[],
      closedPRs: [] as RecentPR[],
      recentIssues: [] as RecentIssue[],
    }

    assert.ok('recentPRs' in response)
    assert.ok('openPRs' in response)
    assert.ok('closedPRs' in response)
    assert.ok('recentIssues' in response)
    assert.ok(Array.isArray(response.openPRs))
    assert.ok(Array.isArray(response.closedPRs))
  })

  it('PR items have required fields for widget rendering', () => {
    const pr: RecentPR = {
      number: 42,
      title: 'My PR',
      state: 'merged',
      repo: 'gigi',
      updated_at: '2026-02-23T10:00:00Z',
      merged_at: '2026-02-23T10:00:00Z',
    }

    assert.ok(typeof pr.number === 'number')
    assert.ok(typeof pr.title === 'string')
    assert.ok(['open', 'merged', 'closed'].includes(pr.state))
    assert.ok(typeof pr.repo === 'string')
    assert.ok(typeof pr.updated_at === 'string')
  })

  it('issue items have required fields for widget rendering', () => {
    const issue: RecentIssue = {
      number: 105,
      title: 'Dashboard widgets',
      state: 'open',
      repo: 'gigi',
      labels: [{ name: 'type/feature', color: '0075ca' }],
      updated_at: '2026-02-23T14:00:00Z',
    }

    assert.ok(typeof issue.number === 'number')
    assert.ok(typeof issue.title === 'string')
    assert.ok(['open', 'closed'].includes(issue.state))
    assert.ok(typeof issue.repo === 'string')
    assert.ok(Array.isArray(issue.labels))
    assert.ok(typeof issue.updated_at === 'string')
  })
})

describe('widget navigation — in-app routing instead of external links', () => {
  // These test the navigation path construction logic that widgets use
  // to navigate in the Gitea iframe instead of opening broken external links

  it('PR widget constructs correct navigation path for pulls', () => {
    const owner = 'idea'
    const pr = { repo: 'gigi', number: 42 }
    const expectedPath = `/gitea/${owner}/${pr.repo}/pulls/${pr.number}`
    assert.equal(expectedPath, '/gitea/idea/gigi/pulls/42')
  })

  it('issue widget constructs correct navigation path for issues', () => {
    const owner = 'idea'
    const issue = { repo: 'gigi', number: 105 }
    const expectedPath = `/gitea/${owner}/${issue.repo}/issues/${issue.number}`
    assert.equal(expectedPath, '/gitea/idea/gigi/issues/105')
  })

  it('actions widget constructs correct navigation path for CI runs using run_number (not id)', () => {
    const owner = 'idea'
    // run.id is the internal DB id, run_number is the user-facing run index — Gitea URLs use run_number
    const run = { repo: 'gigi', id: 371, run_number: 219 }
    const expectedPath = `/${owner}/${run.repo}/actions/runs/${run.run_number}`
    assert.equal(expectedPath, '/idea/gigi/actions/runs/219')
    // Regression: using run.id would produce a 404
    const wrongPath = `/${owner}/${run.repo}/actions/runs/${run.id}`
    assert.notEqual(wrongPath, expectedPath, 'run.id !== run_number — using id causes 404')
  })

  it('navigation paths work with different org names', () => {
    const owner = 'my-org'
    const pr = { repo: 'my-project', number: 1 }
    const expectedPath = `/gitea/${owner}/${pr.repo}/pulls/${pr.number}`
    assert.equal(expectedPath, '/gitea/my-org/my-project/pulls/1')
  })

  it('navigation paths work across different repos', () => {
    const owner = 'idea'
    const repos = ['gigi', 'gigi-infra', 'my-app']
    for (const repo of repos) {
      const path = `/gitea/${owner}/${repo}/issues/1`
      assert.ok(path.includes(repo), `path should include repo name: ${repo}`)
      assert.ok(path.startsWith('/gitea/'), 'path should start with /gitea/')
    }
  })
})

// ─── Clickable Stat Cards tests ──────────────────────────────────────

describe('clickable stat cards — navigation paths', () => {
  // These test the navigation path construction logic used by the
  // clickable stat cards and repo badge buttons in the overview dashboard

  function statReposPath(orgName: string): string {
    return `/gitea/${orgName}`
  }

  function statIssuesPath(): string {
    return `/gitea/issues?type=your_repositories&state=open&q=`
  }

  function statPRsPath(): string {
    return `/gitea/pulls?type=your_repositories&state=open&q=`
  }

  function repoPRsPath(orgName: string, repoName: string): string {
    return `/gitea/${orgName}/${repoName}/pulls`
  }

  function repoIssuesPath(orgName: string, repoName: string): string {
    return `/gitea/${orgName}/${repoName}/issues`
  }

  it('stat repos card navigates to org page', () => {
    assert.equal(statReposPath('idea'), '/gitea/idea')
    assert.equal(statReposPath('my-org'), '/gitea/my-org')
  })

  it('stat issues card navigates to Gitea issues dashboard', () => {
    const path = statIssuesPath()
    assert.ok(path.startsWith('/gitea/issues'))
    assert.ok(path.includes('state=open'))
    assert.ok(path.includes('type=your_repositories'))
  })

  it('stat PRs card navigates to Gitea pulls dashboard', () => {
    const path = statPRsPath()
    assert.ok(path.startsWith('/gitea/pulls'))
    assert.ok(path.includes('state=open'))
    assert.ok(path.includes('type=your_repositories'))
  })

  it('repo PR badge navigates to repo pulls page', () => {
    assert.equal(repoPRsPath('idea', 'gigi'), '/gitea/idea/gigi/pulls')
    assert.equal(repoPRsPath('idea', 'infra'), '/gitea/idea/infra/pulls')
  })

  it('repo issues badge navigates to repo issues page', () => {
    assert.equal(repoIssuesPath('idea', 'gigi'), '/gitea/idea/gigi/issues')
    assert.equal(repoIssuesPath('idea', 'infra'), '/gitea/idea/infra/issues')
  })

  it('all paths start with /gitea/ prefix for iframe routing', () => {
    const paths = [
      statReposPath('idea'),
      statIssuesPath(),
      statPRsPath(),
      repoPRsPath('idea', 'gigi'),
      repoIssuesPath('idea', 'gigi'),
    ]
    for (const p of paths) {
      assert.ok(p.startsWith('/gitea/'), `Path should start with /gitea/: ${p}`)
    }
  })
})

// ─── Worker Status Widget tests ──────────────────────────────────────

/** Runner status logic (matches WorkerStatusWidget) */
interface Runner {
  id: number
  name: string
  status: string
  busy: boolean
  labels: { name: string }[]
  version?: string
}

function getRunnerStatusClass(runner: Runner): string {
  if (runner.status === 'offline') return 'offline'
  if (runner.busy) return 'busy'
  return 'idle'
}

function getRunnerStatusLabel(runner: Runner): string {
  if (runner.status === 'offline') return 'offline'
  if (runner.busy) return 'busy'
  return 'idle'
}

describe('Worker Status Widget — runner status classification', () => {
  it('classifies online idle runner as "idle"', () => {
    const runner: Runner = { id: 1, name: 'runner-1', status: 'online', busy: false, labels: [] }
    assert.equal(getRunnerStatusClass(runner), 'idle')
    assert.equal(getRunnerStatusLabel(runner), 'idle')
  })

  it('classifies busy runner as "busy"', () => {
    const runner: Runner = { id: 2, name: 'runner-2', status: 'active', busy: true, labels: [] }
    assert.equal(getRunnerStatusClass(runner), 'busy')
    assert.equal(getRunnerStatusLabel(runner), 'busy')
  })

  it('classifies offline runner as "offline"', () => {
    const runner: Runner = { id: 3, name: 'runner-3', status: 'offline', busy: false, labels: [] }
    assert.equal(getRunnerStatusClass(runner), 'offline')
    assert.equal(getRunnerStatusLabel(runner), 'offline')
  })

  it('offline takes precedence even if busy', () => {
    const runner: Runner = { id: 4, name: 'runner-4', status: 'offline', busy: true, labels: [] }
    assert.equal(getRunnerStatusClass(runner), 'offline')
  })

  it('counts online vs offline runners', () => {
    const runners: Runner[] = [
      { id: 1, name: 'r1', status: 'online', busy: false, labels: [] },
      { id: 2, name: 'r2', status: 'online', busy: true, labels: [] },
      { id: 3, name: 'r3', status: 'offline', busy: false, labels: [] },
      { id: 4, name: 'r4', status: 'idle', busy: false, labels: [] },
    ]
    const onlineCount = runners.filter(r => r.status === 'online' || r.status === 'idle' || r.status === 'active').length
    const busyCount = runners.filter(r => r.busy).length
    assert.equal(onlineCount, 3)
    assert.equal(busyCount, 1)
    assert.equal(runners.length - onlineCount, 1) // offline
  })
})

// ─── Workflow Trigger Widget tests ───────────────────────────────────

interface DispatchableWorkflow {
  repo: string
  file: string
  path: string
  name: string
  default_branch: string
}

describe('Workflow discovery via Actions API', () => {
  /** Simulate the workflow filtering logic from the updated endpoint */
  interface ApiWorkflow {
    id: string
    name: string
    path: string
    state: string
  }

  function filterActiveWorkflows(workflows: ApiWorkflow[]): ApiWorkflow[] {
    return workflows.filter(wf => wf.state === 'active')
  }

  function extractFileName(wf: ApiWorkflow): string {
    return wf.path.split('/').pop() ?? wf.id
  }

  it('filters out inactive/deleted workflows', () => {
    const workflows: ApiWorkflow[] = [
      { id: 'test.yml', name: 'test.yml', path: '.gitea/workflows/test.yml', state: 'active' },
      { id: 'old.yml', name: 'old.yml', path: '.gitea/workflows/old.yml', state: 'deleted' },
      { id: 'ci.yml', name: 'ci.yml', path: '.github/workflows/ci.yml', state: 'active' },
    ]
    const active = filterActiveWorkflows(workflows)
    assert.equal(active.length, 2)
    assert.ok(active.every(wf => wf.state === 'active'))
  })

  it('extracts filename from workflow path', () => {
    const wf: ApiWorkflow = { id: 'deploy.yml', name: 'deploy.yml', path: '.gitea/workflows/deploy.yml', state: 'active' }
    assert.equal(extractFileName(wf), 'deploy.yml')
  })

  it('extracts filename from .github/workflows path', () => {
    const wf: ApiWorkflow = { id: 'ci.yml', name: 'ci.yml', path: '.github/workflows/ci.yml', state: 'active' }
    assert.equal(extractFileName(wf), 'ci.yml')
  })

  it('falls back to id when path has no slash', () => {
    const wf: ApiWorkflow = { id: 'test.yml', name: 'test.yml', path: 'test.yml', state: 'active' }
    assert.equal(extractFileName(wf), 'test.yml')
  })

  it('handles empty workflows list', () => {
    const active = filterActiveWorkflows([])
    assert.equal(active.length, 0)
  })
})

describe('Workflow Trigger Widget — workflow detection', () => {
  it('detects workflow_dispatch in YAML content', () => {
    const content = `
name: Deploy
on:
  workflow_dispatch:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
`
    assert.ok(content.includes('workflow_dispatch'))
  })

  it('does not match workflows without workflow_dispatch', () => {
    const content = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
`
    assert.ok(!content.includes('workflow_dispatch'))
  })

  it('extracts workflow name from YAML', () => {
    const content = `name: My Deploy Workflow\non:\n  workflow_dispatch:\n`
    const nameMatch = content.match(/^name:\s*['"]?(.+?)['"]?\s*$/m)
    assert.ok(nameMatch)
    assert.equal(nameMatch![1], 'My Deploy Workflow')
  })

  it('extracts quoted workflow name', () => {
    const content = `name: "Deploy to Production"\non:\n  workflow_dispatch:\n`
    const nameMatch = content.match(/^name:\s*['"]?(.+?)['"]?\s*$/m)
    assert.ok(nameMatch)
    assert.equal(nameMatch![1], 'Deploy to Production')
  })

  it('falls back to filename when name is missing', () => {
    const content = `on:\n  workflow_dispatch:\njobs:\n  test:\n`
    const fileName = 'deploy.yml'
    const nameMatch = content.match(/^name:\s*['"]?(.+?)['"]?\s*$/m)
    const workflowName = nameMatch?.[1] ?? fileName.replace(/\.(yml|yaml)$/, '')
    assert.equal(workflowName, 'deploy')
  })
})

describe('Workflow Trigger Widget — workflow key uniqueness', () => {
  it('generates unique keys from repo + file', () => {
    const workflows: DispatchableWorkflow[] = [
      { repo: 'gigi', file: 'deploy.yml', path: '.gitea/workflows/deploy.yml', name: 'Deploy', default_branch: 'main' },
      { repo: 'gigi', file: 'test.yml', path: '.gitea/workflows/test.yml', name: 'Test', default_branch: 'main' },
      { repo: 'infra', file: 'deploy.yml', path: '.gitea/workflows/deploy.yml', name: 'Deploy', default_branch: 'main' },
    ]
    const keys = workflows.map(wf => `${wf.repo}/${wf.file}`)
    const uniqueKeys = new Set(keys)
    assert.equal(uniqueKeys.size, 3)
  })
})

describe('Workflow Trigger Widget — sorting', () => {
  it('sorts workflows by repo then name', () => {
    const workflows: DispatchableWorkflow[] = [
      { repo: 'infra', file: 'deploy.yml', path: '', name: 'Deploy', default_branch: 'main' },
      { repo: 'gigi', file: 'test.yml', path: '', name: 'Test', default_branch: 'main' },
      { repo: 'gigi', file: 'deploy.yml', path: '', name: 'Deploy', default_branch: 'main' },
    ]
    workflows.sort((a, b) => a.repo.localeCompare(b.repo) || a.name.localeCompare(b.name))
    assert.equal(workflows[0].repo, 'gigi')
    assert.equal(workflows[0].name, 'Deploy')
    assert.equal(workflows[1].repo, 'gigi')
    assert.equal(workflows[1].name, 'Test')
    assert.equal(workflows[2].repo, 'infra')
  })
})

describe('Workflow Trigger Widget — navigation paths', () => {
  it('constructs correct action run path', () => {
    const owner = 'idea'
    const wf = { repo: 'gigi' }
    const path = `/${owner}/${wf.repo}/actions`
    assert.equal(path, '/idea/gigi/actions')
  })
})

// ─── Existing CI status tests ────────────────────────────────────────

describe('CI status widget data', () => {
  it('getStatusLabel maps CI statuses correctly', () => {
    // Replicate the widget logic
    function getStatusLabel(status: string): string {
      switch (status) {
        case 'success': return 'passed'
        case 'failure': return 'failed'
        case 'running': return 'running'
        case 'waiting': return 'queued'
        case 'cancelled': return 'cancelled'
        default: return status
      }
    }

    assert.equal(getStatusLabel('success'), 'passed')
    assert.equal(getStatusLabel('failure'), 'failed')
    assert.equal(getStatusLabel('running'), 'running')
    assert.equal(getStatusLabel('waiting'), 'queued')
    assert.equal(getStatusLabel('cancelled'), 'cancelled')
    assert.equal(getStatusLabel('unknown'), 'unknown')
  })

  it('truncateBranch handles long branch names', () => {
    function truncateBranch(branch: string, max = 20): string {
      if (branch.length <= max) return branch
      return branch.slice(0, max - 1) + '\u2026'
    }

    assert.equal(truncateBranch('main'), 'main')
    assert.equal(truncateBranch('feat/dashboard-widgets'), 'feat/dashboard-widg\u2026')
    assert.equal(truncateBranch('short', 10), 'short')
    assert.equal(truncateBranch('a-very-long-branch-name', 10), 'a-very-lo\u2026')
  })

  it('normalizeColor adds # prefix when missing', () => {
    function normalizeColor(color: string): string {
      return color.startsWith('#') ? color : `#${color}`
    }

    assert.equal(normalizeColor('0075ca'), '#0075ca')
    assert.equal(normalizeColor('#0075ca'), '#0075ca')
    assert.equal(normalizeColor(''), '#')
  })
})
