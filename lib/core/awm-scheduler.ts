/**
 * Always Working Mode (AWM) Scheduler
 *
 * Periodically checks for ready issues and triggers the agent
 * when no other agent is currently running. The key insight:
 * conversation status (open/active/closed) ≠ agent running.
 * We gate on `getRunningAgents().length === 0` — the in-memory
 * set of actively executing agent processes.
 *
 * Follows the same pattern as lib/backup/scheduler.ts.
 */

import { getRunningAgents, handleMessage, resumeConversation } from './router'
import { emit } from './events'
import * as store from './store'
import { createGiteaClient } from '../api-gitea'

// ─── State ──────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null
let lastCheck: Date | null = null
let lastTrigger: Date | null = null
let checking = false
let currentIntervalMinutes = 15

// Minimum cooldown between triggers (prevents rapid-fire)
const TRIGGER_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

// Maximum time a check can take before we consider it stuck
const CHECK_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes
let checkStartedAt: number | null = null

// ─── Types ──────────────────────────────────────────────────────────

export interface AwmStatus {
  schedulerActive: boolean
  intervalMinutes: number
  lastCheck: string | null
  lastTrigger: string | null
  agentBusy: boolean
  checking: boolean
}

// ─── Core Check Logic ───────────────────────────────────────────────

const getGiteaClient = async () => {
  const baseUrl = process.env.GITEA_URL || await store.getConfig('gitea_url') || 'http://192.168.1.80:3000'
  const token = process.env.GITEA_TOKEN || await store.getConfig('gitea_token')
  if (!token) return null
  return createGiteaClient(baseUrl, token)
}

/**
 * Fetch issues labeled `status/ready` across all org repos.
 * Returns a formatted summary string for the agent prompt.
 */
const findReadyIssues = async (): Promise<{ summary: string; count: number }> => {
  const gitea = await getGiteaClient()
  if (!gitea) return { summary: '', count: 0 }

  const org = process.env.GITEA_ORG || 'idea'

  try {
    const repos = await gitea.orgs.listRepos(org)
    const allIssues: Array<{ repo: string; number: number; title: string; labels: string[] }> = []

    for (const repo of repos) {
      try {
        const issues = await gitea.issues.list(org, repo.name, {
          state: 'open',
          labels: 'status/ready',
          limit: 10,
        })
        for (const issue of issues) {
          allIssues.push({
            repo: repo.name,
            number: issue.number,
            title: issue.title,
            labels: (issue.labels || []).map((l: { name: string }) => l.name),
          })
        }
      } catch {
        // Skip repos where we can't list issues (permissions, etc.)
      }
    }

    if (allIssues.length === 0) return { summary: '', count: 0 }

    const lines = allIssues.map(i =>
      `- ${i.repo}#${i.number}: ${i.title} [${i.labels.join(', ')}]`
    )

    return {
      summary: lines.join('\n'),
      count: allIssues.length,
    }
  } catch (err) {
    console.error('[awm] failed to fetch ready issues:', (err as Error).message)
    return { summary: '', count: 0 }
  }
}

/**
 * The main check-for-work function, called on each interval tick.
 */
const checkForWork = async (): Promise<void> => {
  if (checking) {
    // Safety valve: if the previous check has been running for too long, reset the flag
    if (checkStartedAt && Date.now() - checkStartedAt > CHECK_TIMEOUT_MS) {
      console.warn('[awm] previous check appears stuck (>3min), resetting')
      checking = false
    } else {
      console.log('[awm] check already in progress, skipping')
      return
    }
  }

  checking = true
  checkStartedAt = Date.now()
  lastCheck = new Date()

  try {
    // Gate 1: Is any agent currently running?
    const running = getRunningAgents()
    if (running.length > 0) {
      console.log(`[awm] agent busy (${running.length} running), skipping`)
      emit({ type: 'awm_check', status: 'skipped', reason: 'agent_busy', runningCount: running.length })
      return
    }

    // Gate 2: Cooldown — don't trigger too frequently
    if (lastTrigger) {
      const elapsed = Date.now() - lastTrigger.getTime()
      if (elapsed < TRIGGER_COOLDOWN_MS) {
        const remaining = Math.ceil((TRIGGER_COOLDOWN_MS - elapsed) / 1000)
        console.log(`[awm] cooldown active (${remaining}s remaining), skipping`)
        emit({ type: 'awm_check', status: 'skipped', reason: 'cooldown', remainingSeconds: remaining })
        return
      }
    }

    // Gate 3: Budget check
    try {
      const budgetStr = await store.getConfig('budget_usd')
      if (budgetStr) {
        const periodStr = await store.getConfig('budget_period_days') || '7'
        const check = await store.checkBudget(parseFloat(budgetStr), parseInt(periodStr))
        if (check.overBudget) {
          console.warn(`[awm] over budget ($${check.periodSpend.toFixed(2)} / $${check.budgetUSD}), skipping`)
          emit({ type: 'awm_check', status: 'skipped', reason: 'over_budget', spend: check.periodSpend, budget: check.budgetUSD })
          return
        }
      }
    } catch (err) {
      console.warn('[awm] budget check failed:', (err as Error).message)
      // Continue — don't block AWM on budget check failure
    }

    // Find ready issues
    console.log('[awm] checking for ready issues...')
    const { summary, count } = await findReadyIssues()

    if (count === 0) {
      console.log('[awm] no ready issues found')
      emit({ type: 'awm_check', status: 'idle', reason: 'no_issues' })
      return
    }

    console.log(`[awm] found ${count} ready issue(s), triggering agent`)
    emit({ type: 'awm_check', status: 'triggering', issueCount: count })

    // Create a new AWM conversation
    const conv = await store.createConversation('awm', 'Always Working Mode')
    await store.addTags(conv.id, ['awm'])

    // Set up routing so handleMessage knows which conversation to use
    const channelId = conv.id
    resumeConversation('awm', channelId, conv.id)

    // Trigger the agent with the issue summary
    const prompt = `[AWM] You have idle time. Here are open issues labeled \`status/ready\` that need work:\n\n${summary}\n\nPick the most suitable one (prefer smaller/well-documented issues) and start working on it. Use \`/issue repo#N\` to begin tracking, then implement the changes, create a PR, and send a notification.`

    lastTrigger = new Date()

    // Fire and forget — the agent will run asynchronously
    handleMessage('awm', channelId, prompt).catch((err) => {
      console.error('[awm] agent trigger failed:', (err as Error).message)
    })

  } catch (err) {
    console.error('[awm] check failed:', (err as Error).message)
  } finally {
    checking = false
    checkStartedAt = null
  }
}

// ─── Scheduler Lifecycle ────────────────────────────────────────────

/**
 * Schedule the next tick using setTimeout. This ensures the next check
 * only fires AFTER the current one completes — no piling up, no stuck intervals.
 */
const scheduleNextTick = (intervalMs: number): void => {
  timer = setTimeout(async () => {
    try {
      await checkForWork()
    } catch (err) {
      console.error('[awm] scheduled check failed:', err)
    }
    // Only reschedule if we haven't been stopped during the check
    if (timer !== null) {
      scheduleNextTick(intervalMs)
    }
  }, intervalMs)
}

/**
 * Start the AWM scheduler. Idempotent — stops existing timer first.
 * Uses self-rescheduling setTimeout (not setInterval) so that the next
 * tick waits for the current check to finish — can never pile up or get stuck.
 */
export const startAwmScheduler = (intervalMinutes: number): void => {
  stopAwmScheduler()

  currentIntervalMinutes = intervalMinutes
  const intervalMs = intervalMinutes * 60 * 1000

  console.log(`[awm] starting scheduler (interval: ${intervalMinutes}m)`)
  emit({ type: 'awm_check', status: 'started', intervalMinutes })

  // Don't run immediately on start — wait for the first interval
  // (the agent may have just booted and needs time to settle)
  scheduleNextTick(intervalMs)

  console.log('[awm] scheduler started')
}

/**
 * Stop the AWM scheduler.
 */
export const stopAwmScheduler = (): void => {
  if (timer) {
    clearTimeout(timer)
    timer = null
    console.log('[awm] scheduler stopped')
    emit({ type: 'awm_check', status: 'stopped' })
  }
}

/**
 * Get current AWM status for API responses.
 */
export const getAwmStatus = (): AwmStatus => ({
  schedulerActive: timer !== null,
  intervalMinutes: currentIntervalMinutes,
  lastCheck: lastCheck?.toISOString() ?? null,
  lastTrigger: lastTrigger?.toISOString() ?? null,
  agentBusy: getRunningAgents().length > 0,
  checking,
})
