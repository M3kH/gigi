/**
 * CI Monitor — Auto-detect CI failures on Gigi's PRs and attempt fixes
 *
 * When Gitea Actions report a workflow_run or workflow_job completion with
 * conclusion=failure on a PR authored by gigi, this module:
 * 1. Fetches the CI logs to understand what broke
 * 2. Routes the failure context to an agent session
 * 3. The agent analyzes, fixes, and pushes — closing the loop
 *
 * Guard rails: max retry count per PR to prevent infinite fix loops.
 */

import { getConfig } from './store'

// ─── Types ───────────────────────────────────────────────────────────

export interface CIRunInfo {
  /** Gitea Actions run ID */
  runId: number
  /** Repository name (not full_name) */
  repo: string
  /** Repository owner/org */
  owner: string
  /** Branch name (e.g. "feat/my-feature") */
  branch: string
  /** Commit SHA that was tested */
  headSha: string
  /** Workflow name (e.g. "Test Pull Request") */
  workflowName: string
  /** Run conclusion: success | failure | cancelled | skipped */
  conclusion: string
  /** Associated PR number, if any */
  prNumber?: number
  /** The URL to view the run in Gitea UI */
  htmlUrl?: string
}

export interface CIJobLog {
  jobName: string
  stepName?: string
  log: string
}

// ─── Retry Tracking ──────────────────────────────────────────────────

export const MAX_FIX_ATTEMPTS = 2

/** In-memory retry tracker: "owner/repo#prNumber" → attempt count */
const fixAttempts = new Map<string, number>()

function fixKey(owner: string, repo: string, prNumber: number): string {
  return `${owner}/${repo}#${prNumber}`
}

/**
 * Check if we should attempt an auto-fix for this PR.
 * Returns false if max attempts exceeded.
 */
export function shouldAutoFix(owner: string, repo: string, prNumber: number): boolean {
  const key = fixKey(owner, repo, prNumber)
  const attempts = fixAttempts.get(key) ?? 0
  return attempts < MAX_FIX_ATTEMPTS
}

/**
 * Record that a fix attempt is being made for this PR.
 * Returns the current attempt number (1-based).
 */
export function trackFixAttempt(owner: string, repo: string, prNumber: number): number {
  const key = fixKey(owner, repo, prNumber)
  const attempts = (fixAttempts.get(key) ?? 0) + 1
  fixAttempts.set(key, attempts)
  return attempts
}

/**
 * Reset the fix attempt counter for a PR (e.g. when CI passes).
 */
export function resetFixAttempts(owner: string, repo: string, prNumber: number): void {
  const key = fixKey(owner, repo, prNumber)
  fixAttempts.delete(key)
}

/**
 * Get current fix attempt count for a PR.
 */
export function getFixAttempts(owner: string, repo: string, prNumber: number): number {
  const key = fixKey(owner, repo, prNumber)
  return fixAttempts.get(key) ?? 0
}

// ─── Log Fetching ────────────────────────────────────────────────────

/**
 * Fetch CI job logs from Gitea Actions API.
 *
 * Gitea's Actions API for run logs:
 * - GET /api/v1/repos/{owner}/{repo}/actions/tasks (list all tasks)
 * - Individual job logs: GET /api/v1/repos/{owner}/{repo}/actions/tasks/{taskId}/logs
 *
 * The `runs` endpoint doesn't directly expose per-step logs,
 * so we fetch the task list and match by run_id.
 */
export async function fetchRunLogs(
  owner: string,
  repo: string,
  runId: number,
): Promise<CIJobLog[]> {
  const token = process.env.GITEA_TOKEN || await getConfig('gitea_token')
  if (!token) throw new Error('No gitea_token configured')

  const baseUrl = process.env.GITEA_URL || await getConfig('gitea_url') || 'http://localhost:3300'
  const logs: CIJobLog[] = []

  try {
    // List tasks (jobs) for this repo — filter by status to find recent failures
    const tasksUrl = `${baseUrl}/api/v1/repos/${owner}/${repo}/actions/tasks?limit=20`
    const tasksRes = await fetch(tasksUrl, {
      headers: { Authorization: `token ${token}`, Accept: 'application/json' },
    })

    if (!tasksRes.ok) {
      console.warn(`[ci-monitor] Failed to list tasks: HTTP ${tasksRes.status}`)
      return logs
    }

    const tasksData = await tasksRes.json() as {
      workflow_runs?: Array<{
        id: number
        run_number: number
        status: string
        conclusion: string
      }>
      tasks?: Array<{
        id: number
        name: string
        run_id: number
        status: string
        log_length: number
      }>
    }

    // Gitea may return tasks in different structures depending on version
    // Try to find tasks that belong to our run
    const tasks = tasksData.tasks ?? []
    const matchingTasks = tasks.filter(t => t.run_id === runId)

    for (const task of matchingTasks) {
      try {
        const logUrl = `${baseUrl}/api/v1/repos/${owner}/${repo}/actions/tasks/${task.id}/logs`
        const logRes = await fetch(logUrl, {
          headers: { Authorization: `token ${token}`, Accept: 'text/plain' },
        })

        if (logRes.ok) {
          const logText = await logRes.text()
          logs.push({
            jobName: task.name,
            log: logText,
          })
        }
      } catch (err) {
        console.warn(`[ci-monitor] Failed to fetch log for task ${task.id}:`, (err as Error).message)
      }
    }

    // If we couldn't find matching tasks by run_id, try fetching via the run endpoint
    if (logs.length === 0) {
      try {
        const runJobsUrl = `${baseUrl}/api/v1/repos/${owner}/${repo}/actions/runs/${runId}/jobs`
        const jobsRes = await fetch(runJobsUrl, {
          headers: { Authorization: `token ${token}`, Accept: 'application/json' },
        })

        if (jobsRes.ok) {
          const jobsData = await jobsRes.json() as {
            jobs?: Array<{ id: number; name: string; status: string; conclusion: string }>
          }

          for (const job of jobsData.jobs ?? []) {
            if (job.conclusion === 'failure') {
              try {
                // Try to get the job's log
                const logUrl = `${baseUrl}/api/v1/repos/${owner}/${repo}/actions/runs/${runId}/jobs/${job.id}/logs`
                const logRes = await fetch(logUrl, {
                  headers: { Authorization: `token ${token}`, Accept: 'text/plain' },
                })
                if (logRes.ok) {
                  logs.push({ jobName: job.name, log: await logRes.text() })
                }
              } catch { /* try next job */ }
            }
          }
        }
      } catch (err) {
        console.warn(`[ci-monitor] Fallback job log fetch failed:`, (err as Error).message)
      }
    }
  } catch (err) {
    console.error(`[ci-monitor] Log fetch error:`, (err as Error).message)
  }

  return logs
}

// ─── PR Resolution ──────────────────────────────────────────────────

/**
 * Find the PR associated with a workflow run by matching the head branch.
 * Returns the PR number and author if found.
 */
export async function findPRForRun(
  owner: string,
  repo: string,
  branch: string,
): Promise<{ number: number; author: string; title: string; htmlUrl: string } | null> {
  const token = process.env.GITEA_TOKEN || await getConfig('gitea_token')
  if (!token) return null

  const baseUrl = process.env.GITEA_URL || await getConfig('gitea_url') || 'http://localhost:3300'

  try {
    const url = `${baseUrl}/api/v1/repos/${owner}/${repo}/pulls?state=open&limit=50`
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return null

    const prs = await res.json() as Array<{
      number: number
      title: string
      html_url: string
      head: { ref: string }
      user: { login: string }
    }>

    const match = prs.find(pr => pr.head.ref === branch)
    if (!match) return null

    return {
      number: match.number,
      author: match.user.login,
      title: match.title,
      htmlUrl: match.html_url,
    }
  } catch (err) {
    console.warn(`[ci-monitor] Failed to find PR for branch ${branch}:`, (err as Error).message)
    return null
  }
}

// ─── Payload Parsing ────────────────────────────────────────────────

/**
 * Parse a Gitea webhook payload for workflow_run events.
 *
 * Gitea sends workflow_run events with this structure:
 * {
 *   action: "completed",
 *   workflow_run: {
 *     id, name, head_branch, head_sha, status, conclusion,
 *     event, html_url, pull_requests, ...
 *   },
 *   repository: { name, full_name, ... }
 * }
 */
export function parseWorkflowRunPayload(payload: Record<string, unknown>): CIRunInfo | null {
  const action = payload.action as string | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  const run = payload.workflow_run as Record<string, unknown> | undefined

  if (!run || !repo) return null
  // Only care about completed runs
  if (action !== 'completed') return null

  const repoName = repo.name as string
  const ownerObj = repo.owner as Record<string, unknown> | undefined
  const owner = ownerObj?.login as string || (repo.full_name as string)?.split('/')[0] || ''

  const conclusion = (run.conclusion as string) || ''
  const branch = (run.head_branch as string) || ''
  const headSha = (run.head_sha as string) || ''
  const runId = (run.id as number) || 0
  const workflowName = (run.name as string) || (run.display_title as string) || ''
  const htmlUrl = (run.html_url as string) || ''

  // Try to extract PR number from the payload's pull_requests array
  let prNumber: number | undefined
  const pullRequests = run.pull_requests as Array<Record<string, unknown>> | undefined
  if (pullRequests?.length) {
    prNumber = pullRequests[0].number as number
  }

  return {
    runId,
    repo: repoName,
    owner,
    branch,
    headSha,
    workflowName,
    conclusion,
    prNumber,
    htmlUrl,
  }
}

/**
 * Parse a Gitea webhook payload for workflow_job events.
 */
export function parseWorkflowJobPayload(payload: Record<string, unknown>): CIRunInfo | null {
  const action = payload.action as string | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  const job = payload.workflow_job as Record<string, unknown> | undefined

  if (!job || !repo) return null
  if (action !== 'completed') return null

  const repoName = repo.name as string
  const ownerObj = repo.owner as Record<string, unknown> | undefined
  const owner = ownerObj?.login as string || (repo.full_name as string)?.split('/')[0] || ''

  const conclusion = (job.conclusion as string) || ''
  const branch = (job.head_branch as string) || ''
  const headSha = (job.head_sha as string) || ''
  const runId = (job.run_id as number) || 0
  const workflowName = (job.workflow_name as string) || (job.name as string) || ''
  const htmlUrl = (job.html_url as string) || ''

  return {
    runId,
    repo: repoName,
    owner,
    branch,
    headSha,
    workflowName,
    conclusion,
    htmlUrl,
  }
}

// ─── Message Builder ────────────────────────────────────────────────

/**
 * Build the agent context message for a CI failure.
 * This gives the agent enough info to understand what happened and fix it.
 */
export function buildCIFailureMessage(
  runInfo: CIRunInfo,
  logs: CIJobLog[],
  attempt: number,
): string {
  const logSection = logs.length > 0
    ? logs.map(l => {
        // Truncate very long logs to keep the context manageable
        const truncatedLog = l.log.length > 4000
          ? l.log.slice(-4000) + '\n... (truncated, showing last 4000 chars)'
          : l.log
        return `### Job: ${l.jobName}\n\`\`\`\n${truncatedLog}\n\`\`\``
      }).join('\n\n')
    : '_No logs could be fetched. Check the CI run manually._'

  return [
    `[CI Failure — Auto-fix attempt ${attempt}/${MAX_FIX_ATTEMPTS}]`,
    '',
    `**Workflow:** ${runInfo.workflowName}`,
    `**Repository:** ${runInfo.owner}/${runInfo.repo}`,
    `**Branch:** ${runInfo.branch}`,
    `**Commit:** ${runInfo.headSha.slice(0, 8)}`,
    runInfo.prNumber ? `**PR:** #${runInfo.prNumber}` : '',
    runInfo.htmlUrl ? `**Run URL:** ${runInfo.htmlUrl}` : '',
    '',
    '## CI Logs',
    '',
    logSection,
    '',
    '## Instructions',
    '',
    'The CI pipeline failed on your PR. You should:',
    '1. Analyze the log output above to understand what failed',
    '2. Check out the branch and investigate the relevant source/test files',
    '3. Fix the issue and push the fix to the same branch',
    '4. The CI will automatically re-run after your push',
    '',
    attempt >= MAX_FIX_ATTEMPTS
      ? '**WARNING: This is the last auto-fix attempt. If this fails, the operator will be notified.**'
      : '',
  ].filter(Boolean).join('\n')
}
