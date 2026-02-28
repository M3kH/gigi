/**
 * Thread Context Stack — 5-layer context injection for threads (Phase 2, Issue #299)
 * Enhanced with smart caching (Issue #304)
 *
 * Automatically assembles layered context when a thread/sub-thread is active.
 * Each layer adds domain-specific knowledge without carrying the entire codebase.
 *
 * The 5 Layers:
 *   1. Global Context   — System prompt, knowledge, repos (already exists, NOT handled here)
 *   2. Repo CLAUDE.md   — Auto-injected from linked repos via Gitea API
 *   3. Ticket Chain      — Parent → current → sibling issues with status
 *   4. Thread Lineage    — Parent thread summary inherited on fork
 *   5. Execution State   — Step-by-step plan progress for task threads
 *
 * Cache optimizations (#304):
 *   - Layer-granular caching with checksums for change detection
 *   - Session-aware: detect changes since last injection, send delta updates
 *   - Fork-from-cache: sub-threads inherit parent context cheaply
 *   - Webhook invalidation: targeted cache busting on events
 *
 * Total budget: ~7K tokens overhead (4K repo + 2K tickets + 1K lineage).
 */

import {
  getThread,
  getThreadRefs,
  getThreadLineage,
  type Thread,
  type ThreadRef,
  type ThreadLineage,
} from './threads.js'

import {
  getCached,
  setCache,
  computeChecksum,
  estimateTokens,
  recordInjection,
  detectChanges,
  cacheContextStack,
  getCachedContextStack,
  clearAll,
  invalidateByPrefix,
  CLAUDE_MD_TTL,
  TICKET_TTL,
  type LayerChecksums,
  type ChangeDetectionResult,
} from './context-cache.js'

// ─── Types ──────────────────────────────────────────────────────────

export interface ContextLayer {
  /** Layer number (2-5; layer 1 is global and handled elsewhere) */
  layer: number
  /** Human-readable name */
  name: string
  /** Formatted content for this layer */
  content: string
  /** Estimated token count (~4 chars per token) */
  estimatedTokens: number
}

export interface ThreadContextStack {
  /** The thread this context was built for */
  threadId: string
  /** All non-empty context layers (2-5) */
  layers: ContextLayer[]
  /** Total estimated tokens across all layers */
  totalTokens: number
  /** Combined formatted text for injection into agent context */
  formatted: string
  /** Checksums for each layer (used for change detection) */
  checksums?: LayerChecksums
}

export interface ContextStackOptions {
  /** Maximum total tokens for all layers combined (default: 7000) */
  maxTokens?: number
  /** Skip fetching CLAUDE.md from repos (default: false) */
  skipRepoContext?: boolean
  /** Skip ticket chain context (default: false) */
  skipTicketChain?: boolean
  /** Skip thread lineage context (default: false) */
  skipLineage?: boolean
  /** Skip execution state context (default: false) */
  skipExecutionState?: boolean
}

/** Options for the cached context builder (#304) */
export interface CachedContextStackOptions extends ContextStackOptions {
  /** Session ID — if provided, enables session-aware change detection */
  sessionId?: string
  /** If true, force rebuild even if cache is valid */
  forceRefresh?: boolean
}

/** Result of a cached context stack build */
export interface CachedContextStackResult {
  /** The context stack (null if no layers have content) */
  stack: ThreadContextStack | null
  /** Whether this was served from cache */
  fromCache: boolean
  /** Change detection result (only when sessionId provided and previous injection exists) */
  changes: ChangeDetectionResult | null
}

// ─── Backward-Compatible Cache API ──────────────────────────────────
// These wrap the new context-cache.ts module to maintain backward compat
// for existing callers (e.g., tests that import from thread-context).

/** Clear all cached context (for testing or invalidation). */
export const clearContextCache = (): void => {
  clearAll()
}

/** Invalidate cache entries matching a prefix (e.g., "claude_md:idea/gigi"). */
export const invalidateCache = (prefix: string): void => {
  invalidateByPrefix(prefix)
}

// ─── Layer 2: Repo CLAUDE.md ────────────────────────────────────────

/**
 * Fetch CLAUDE.md from a Gitea repository.
 * Cached with 5-min TTL and checksum tracking.
 */
export const fetchClaudeMd = async (repo: string): Promise<string | null> => {
  const cacheKey = `claude_md:${repo}`
  const cached = getCached(cacheKey)
  if (cached !== null) return cached === '' ? null : cached

  const giteaUrl = process.env.GITEA_URL
  const giteaToken = process.env.GITEA_TOKEN
  if (!giteaUrl || !giteaToken) return null

  try {
    // Gitea raw file API: GET /api/v1/repos/{owner}/{repo}/raw/{filepath}
    const [owner, repoName] = repo.includes('/') ? repo.split('/', 2) : ['idea', repo]
    const res = await fetch(
      `${giteaUrl}/api/v1/repos/${owner}/${repoName}/raw/CLAUDE.md`,
      { headers: { Authorization: `token ${giteaToken}` } }
    )

    if (!res.ok) {
      // Cache empty result to avoid retrying 404s
      setCache(cacheKey, '', CLAUDE_MD_TTL)
      return null
    }

    const content = await res.text()
    const trimmed = content.trim()
    if (!trimmed) {
      setCache(cacheKey, '', CLAUDE_MD_TTL)
      return null
    }

    setCache(cacheKey, trimmed, CLAUDE_MD_TTL)
    return trimmed
  } catch (err) {
    console.warn(`[thread-context] Failed to fetch CLAUDE.md for ${repo}:`, (err as Error).message)
    return null
  }
}

/**
 * Build Layer 2: Repo Context from CLAUDE.md files of linked repos.
 * Budget: ~4K tokens.
 */
export const buildRepoContext = async (
  refs: ThreadRef[],
  maxTokens: number = 4000
): Promise<ContextLayer | null> => {
  // Collect unique repos from thread refs
  const repos = [...new Set(refs.map(r => r.repo).filter(Boolean))]
  if (repos.length === 0) return null

  const sections: string[] = []
  let totalTokens = 0

  for (const repo of repos) {
    const content = await fetchClaudeMd(repo)
    if (!content) continue

    const tokens = estimateTokens(content)
    if (totalTokens + tokens > maxTokens) {
      // Truncate to fit budget
      const remainingChars = (maxTokens - totalTokens) * 4
      if (remainingChars > 200) {
        sections.push(`## Repository Context: ${repo}\n${content.slice(0, remainingChars)}...\n[truncated to fit token budget]`)
        totalTokens = maxTokens
      }
      break
    }

    sections.push(`## Repository Context: ${repo}\n${content}`)
    totalTokens += tokens
  }

  if (sections.length === 0) return null

  const formatted = sections.join('\n\n')
  return {
    layer: 2,
    name: 'Repo CLAUDE.md',
    content: formatted,
    estimatedTokens: estimateTokens(formatted),
  }
}

// ─── Layer 3: Ticket Chain Context ──────────────────────────────────

interface IssueInfo {
  number: number
  title: string
  state: string
  body: string
  labels: Array<{ name: string }>
  html_url?: string
}

/**
 * Fetch an issue from Gitea with caching.
 */
const fetchIssue = async (repo: string, number: number): Promise<IssueInfo | null> => {
  const cacheKey = `issue:${repo}#${number}`
  const cached = getCached(cacheKey)
  if (cached !== null) {
    try { return JSON.parse(cached) } catch { /* fall through */ }
  }

  const giteaUrl = process.env.GITEA_URL
  const giteaToken = process.env.GITEA_TOKEN
  if (!giteaUrl || !giteaToken) return null

  try {
    const [owner, repoName] = repo.includes('/') ? repo.split('/', 2) : ['idea', repo]
    const res = await fetch(
      `${giteaUrl}/api/v1/repos/${owner}/${repoName}/issues/${number}`,
      { headers: { Authorization: `token ${giteaToken}` } }
    )

    if (!res.ok) return null

    const issue = await res.json() as IssueInfo
    const info: IssueInfo = {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body || '',
      labels: (issue.labels || []).map((l: { name: string }) => ({ name: l.name })),
      html_url: issue.html_url,
    }

    setCache(cacheKey, JSON.stringify(info), TICKET_TTL)
    return info
  } catch (err) {
    console.warn(`[thread-context] Failed to fetch issue ${repo}#${number}:`, (err as Error).message)
    return null
  }
}

/**
 * Extract parent issue number from an issue body.
 * Looks for patterns like "Part of #N", "Parent: #N", "Closes #N" in the body.
 */
const extractParentIssueNumber = (body: string): number | null => {
  // Match "Part of #N" or "Parent issue: #N" or "Parent: #N"
  const match = body.match(/(?:part of|parent(?:\s+issue)?)\s*(?:.*?)#(\d+)/i)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Find status label for display.
 */
const getStatusEmoji = (labels: Array<{ name: string }>): string => {
  for (const l of labels) {
    if (l.name === 'status/done') return '✅'
    if (l.name === 'status/in-progress') return '🔄'
    if (l.name === 'status/review') return '👀'
    if (l.name === 'status/ready') return '📋'
    if (l.name === 'status/blocked') return '🚫'
  }
  return '⬜'
}

/**
 * Build Layer 3: Ticket Chain showing parent → current → sibling issues.
 * Budget: ~2K tokens.
 */
export const buildTicketChain = async (
  refs: ThreadRef[],
  maxTokens: number = 2000
): Promise<ContextLayer | null> => {
  // Find issue refs
  const issueRefs = refs.filter(r => r.ref_type === 'issue' && r.number)
  if (issueRefs.length === 0) return null

  const sections: string[] = ['## Ticket Context']
  let totalTokens = 0

  for (const ref of issueRefs) {
    if (totalTokens >= maxTokens) break

    const issue = await fetchIssue(ref.repo, ref.number!)
    if (!issue) continue

    // Current issue — full body (truncated if needed)
    const bodyBudget = Math.min(1200, (maxTokens - totalTokens) * 4)
    const truncatedBody = issue.body.length > bodyBudget
      ? issue.body.slice(0, bodyBudget) + '...'
      : issue.body
    const statusEmoji = getStatusEmoji(issue.labels)
    sections.push(
      `### Current Issue: ${ref.repo}#${issue.number} — ${issue.title} ${statusEmoji}`,
      truncatedBody
    )
    totalTokens += estimateTokens(truncatedBody) + 20

    // Try to find parent issue
    const parentNum = extractParentIssueNumber(issue.body)
    if (parentNum && totalTokens < maxTokens) {
      const parentIssue = await fetchIssue(ref.repo, parentNum)
      if (parentIssue) {
        const parentBodyBudget = Math.min(500, (maxTokens - totalTokens) * 4)
        const parentBody = parentIssue.body.length > parentBodyBudget
          ? parentIssue.body.slice(0, parentBodyBudget) + '...'
          : parentIssue.body
        const parentEmoji = getStatusEmoji(parentIssue.labels)
        // Insert parent BEFORE current
        sections.splice(1, 0,
          `### Parent Issue: ${ref.repo}#${parentIssue.number} — ${parentIssue.title} ${parentEmoji}`,
          parentBody,
          ''
        )
        totalTokens += estimateTokens(parentBody) + 20
      }
    }
  }

  if (sections.length <= 1) return null

  const formatted = sections.join('\n')
  return {
    layer: 3,
    name: 'Ticket Chain',
    content: formatted,
    estimatedTokens: estimateTokens(formatted),
  }
}

// ─── Layer 4: Thread Lineage ────────────────────────────────────────

/**
 * Build Layer 4: Parent thread summary injected into child thread context.
 * Budget: ~1K tokens.
 */
export const buildThreadLineage = async (
  thread: Thread,
  maxTokens: number = 1000
): Promise<ContextLayer | null> => {
  if (!thread.parent_thread_id) return null

  const parent = await getThread(thread.parent_thread_id)
  if (!parent) return null

  // Use parent's summary (from compaction) or topic as context
  const parentLabel = parent.display_name ?? parent.topic ?? 'Unknown'
  const parentSummary = parent.summary

  if (!parentSummary && !parent.topic) return null

  const sections = [`## Parent Thread Summary`]
  sections.push(`Thread: "${parentLabel}" (${parent.id.slice(0, 8)})`)
  sections.push(`Status: ${parent.status}`)

  if (parentSummary) {
    const budgetChars = maxTokens * 4 - 200 // reserve for header
    const trimmedSummary = parentSummary.length > budgetChars
      ? parentSummary.slice(0, budgetChars) + '...'
      : parentSummary
    sections.push(`\n${trimmedSummary}`)
  } else {
    sections.push(`Topic: ${parent.topic}`)
  }

  // Add parent's refs for context
  try {
    const parentRefs = await getThreadRefs(parent.id)
    if (parentRefs.length > 0) {
      const refLines = parentRefs.map(r => {
        const num = r.number ? `#${r.number}` : r.ref || ''
        const status = r.status ? ` (${r.status})` : ''
        return `- ${r.ref_type} ${r.repo}${num}${status}`
      })
      sections.push(`\nParent refs:\n${refLines.join('\n')}`)
    }
  } catch { /* ignore */ }

  const formatted = sections.join('\n')
  return {
    layer: 4,
    name: 'Thread Lineage',
    content: formatted,
    estimatedTokens: estimateTokens(formatted),
  }
}

// ─── Layer 5: Execution State ───────────────────────────────────────

export interface ExecutionStep {
  id: number
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
}

export interface ExecutionPlan {
  task: string
  steps: ExecutionStep[]
  workspace?: string
  branch?: string
}

/**
 * Build Layer 5: Execution state for task-type threads.
 * The plan is stored in thread metadata (thread events with message_type='execution_plan').
 */
export const buildExecutionState = async (
  thread: Thread,
  _maxTokens: number = 1000
): Promise<ContextLayer | null> => {
  // Only applies to task-type threads (Phase 1 adds 'kind' column)
  const kind = (thread as Thread & { kind?: string }).kind
  if (kind !== 'task') return null

  // Look for execution plan in thread metadata
  // The plan is stored as a thread event with message_type='execution_plan'
  const { getThreadEvents } = await import('./threads.js')
  const planEvents = await getThreadEvents(thread.id, {
    message_type: 'execution_plan',
    limit: 1,
  })

  // Use the latest plan event
  const latestPlan = planEvents[planEvents.length - 1]
  if (!latestPlan) return null

  let plan: ExecutionPlan
  try {
    const content = latestPlan.content
    if (typeof content === 'string') {
      plan = JSON.parse(content)
    } else if (content && typeof content === 'object') {
      plan = content as ExecutionPlan
    } else {
      return null
    }
  } catch {
    return null
  }

  if (!plan.task || !plan.steps?.length) return null

  const statusIcons: Record<string, string> = {
    done: '✅',
    in_progress: '🔄',
    pending: '⬚',
    failed: '❌',
  }

  const sections = ['## Execution Plan']
  sections.push(`Task: ${plan.task}`)
  sections.push('Steps:')

  for (const step of plan.steps) {
    const icon = statusIcons[step.status] || '⬚'
    sections.push(`${step.id}. ${icon} ${step.description}`)
  }

  if (plan.workspace) sections.push(`\nWorkspace: ${plan.workspace}`)
  if (plan.branch) sections.push(`Branch: ${plan.branch}`)

  const formatted = sections.join('\n')
  return {
    layer: 5,
    name: 'Execution State',
    content: formatted,
    estimatedTokens: estimateTokens(formatted),
  }
}

// ─── Main Builder ───────────────────────────────────────────────────

/**
 * Build the full Thread Context Stack (layers 2-5) for a thread.
 *
 * Layer 1 (Global Context) is handled by the system prompt builder
 * and is NOT included here. This function generates the thread-specific
 * context layers that get injected alongside the thread messages.
 *
 * Returns null if no layers have content (e.g., thread has no refs or lineage).
 */
export const buildContextStack = async (
  threadId: string,
  opts: ContextStackOptions = {}
): Promise<ThreadContextStack | null> => {
  const maxTokens = opts.maxTokens ?? 7000

  const thread = await getThread(threadId)
  if (!thread) return null

  const refs = await getThreadRefs(threadId)
  const layers: ContextLayer[] = []
  let remainingTokens = maxTokens
  const checksums: LayerChecksums = {}

  // Layer 2: Repo CLAUDE.md
  if (!opts.skipRepoContext) {
    const repoBudget = Math.min(4000, remainingTokens)
    const repoLayer = await buildRepoContext(refs, repoBudget)
    if (repoLayer) {
      layers.push(repoLayer)
      remainingTokens -= repoLayer.estimatedTokens
      checksums.repoContext = computeChecksum(repoLayer.content)
    }
  }

  // Layer 3: Ticket Chain
  if (!opts.skipTicketChain) {
    const ticketBudget = Math.min(2000, remainingTokens)
    const ticketLayer = await buildTicketChain(refs, ticketBudget)
    if (ticketLayer) {
      layers.push(ticketLayer)
      remainingTokens -= ticketLayer.estimatedTokens
      checksums.ticketChain = computeChecksum(ticketLayer.content)
    }
  }

  // Layer 4: Thread Lineage (parent summary)
  if (!opts.skipLineage) {
    const lineageBudget = Math.min(1000, remainingTokens)
    const lineageLayer = await buildThreadLineage(thread, lineageBudget)
    if (lineageLayer) {
      layers.push(lineageLayer)
      remainingTokens -= lineageLayer.estimatedTokens
      checksums.threadLineage = computeChecksum(lineageLayer.content)
    }
  }

  // Layer 5: Execution State
  if (!opts.skipExecutionState) {
    const execBudget = Math.min(1000, remainingTokens)
    const execLayer = await buildExecutionState(thread, execBudget)
    if (execLayer) {
      layers.push(execLayer)
      checksums.executionState = computeChecksum(execLayer.content)
    }
  }

  if (layers.length === 0) return null

  const totalTokens = layers.reduce((sum, l) => sum + l.estimatedTokens, 0)
  const formatted = layers.map(l => l.content).join('\n\n---\n\n')

  return {
    threadId,
    layers,
    totalTokens,
    formatted,
    checksums,
  }
}

// ─── Cached Builder (#304) ──────────────────────────────────────────

/**
 * Build a context stack with caching and session-aware change detection.
 *
 * This is the main entry point for #304 optimizations:
 * - Checks for a cached stack first (avoids rebuilding)
 * - When sessionId is provided, detects what changed since last injection
 * - Records injection checksums for future change detection
 * - Caches the result for subsequent calls
 *
 * Usage in router.ts:
 *   - New session (no sessionId): call with forceRefresh=true, get full stack
 *   - Resume session: call with sessionId, check changes.hasChanges
 *     - If changes exist, inject only the delta as a system message
 *     - If no changes, skip injection entirely (Claude still has the context)
 */
export const buildContextStackCached = async (
  threadId: string,
  opts: CachedContextStackOptions = {}
): Promise<CachedContextStackResult> => {
  const { sessionId, forceRefresh, ...buildOpts } = opts

  // 1. Try cached stack (unless force refresh)
  if (!forceRefresh) {
    const cached = getCachedContextStack(threadId)
    if (cached) {
      // Reconstruct ThreadContextStack from cached version
      const stack: ThreadContextStack = {
        threadId: cached.threadId,
        layers: cached.layers.map((l, i) => ({
          layer: i + 2,
          name: l.name,
          content: l.content,
          estimatedTokens: l.estimatedTokens,
        })),
        totalTokens: cached.totalTokens,
        formatted: cached.formatted,
        checksums: cached.checksums,
      }

      // If we have a sessionId, check what changed
      const changes = sessionId
        ? detectChanges(sessionId, cached.checksums)
        : null

      return { stack, fromCache: true, changes }
    }
  }

  // 2. Build fresh
  const stack = await buildContextStack(threadId, buildOpts)
  if (!stack) {
    return { stack: null, fromCache: false, changes: null }
  }

  // 3. Cache the result
  const checksums = stack.checksums ?? {}
  cacheContextStack({
    threadId,
    layers: stack.layers.map(l => ({
      name: (layerNameToChecksumKey(l.name) || 'repoContext') as keyof LayerChecksums,
      content: l.content,
      checksum: computeChecksum(l.content),
      estimatedTokens: l.estimatedTokens,
    })),
    totalTokens: stack.totalTokens,
    formatted: stack.formatted,
    checksums,
  })

  // 4. Session tracking
  let changes: ChangeDetectionResult | null = null
  if (sessionId) {
    changes = detectChanges(sessionId, checksums)
    // Record this injection for future change detection
    recordInjection(sessionId, threadId, checksums)
  }

  return { stack, fromCache: false, changes }
}

/** Map layer display names to checksum keys */
const layerNameToChecksumKey = (name: string): keyof LayerChecksums | null => {
  switch (name) {
    case 'Repo CLAUDE.md': return 'repoContext'
    case 'Ticket Chain': return 'ticketChain'
    case 'Thread Lineage': return 'threadLineage'
    case 'Execution State': return 'executionState'
    default: return null
  }
}
