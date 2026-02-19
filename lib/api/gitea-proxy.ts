/**
 * API — Gitea Proxy Endpoints
 *
 * Server-side proxy to Gitea REST API for the frontend SPA.
 * The Gitea client uses Node APIs (Buffer, etc) and needs auth tokens,
 * so the frontend calls these thin proxy endpoints instead.
 */

import { Hono } from 'hono'
import { createGiteaClient, type GiteaClient } from '../api-gitea'
import { getConfig, listConversations } from '../core/store'

// ─── Singleton client ───────────────────────────────────────────────

let client: GiteaClient | null = null
let orgName: string | null = null

const getClient = async (): Promise<GiteaClient> => {
  if (!client) {
    const baseUrl = process.env.GITEA_URL || await getConfig('gitea_url') || 'http://192.168.1.80:3000'
    const token = process.env.GITEA_TOKEN || await getConfig('gitea_token')
    if (!token) throw new Error('GITEA_TOKEN not set')
    client = createGiteaClient(baseUrl, token)
  }
  return client
}

const getOrg = async (): Promise<string> => {
  if (!orgName) {
    orgName = process.env.GITEA_ORG || await getConfig('gitea_org') || 'gigi'
  }
  return orgName
}

// ─── Status label definitions ────────────────────────────────────────

const STATUS_LABELS = [
  { name: 'status/ready',       color: '#0075ca', description: 'Ready to be picked up' },
  { name: 'status/in-progress', color: '#e4e669', description: 'Work in progress' },
  { name: 'status/review',      color: '#a2eeef', description: 'In review' },
  { name: 'status/blocked',     color: '#d73a4a', description: 'Blocked by dependency or question' },
  { name: 'status/done',        color: '#0e8a16', description: 'Completed' },
]

/** Cache of repos where labels have been verified/created (per process lifetime) */
const labelReadyRepos = new Set<string>()

/**
 * Ensure all required status/ labels exist in a repo, creating any missing ones.
 * Cached per repo so we only check once per process lifetime.
 */
async function ensureStatusLabels(gitea: GiteaClient, owner: string, repo: string): Promise<void> {
  const key = `${owner}/${repo}`
  if (labelReadyRepos.has(key)) return

  try {
    const existing = await gitea.repos.listLabels(owner, repo)
    const existingNames = new Set(existing.map(l => l.name))

    await Promise.all(
      STATUS_LABELS
        .filter(l => !existingNames.has(l.name))
        .map(l => gitea.repos.createLabel(owner, repo, l))
    )
    labelReadyRepos.add(key)
  } catch (err) {
    console.error(`[gitea-proxy] Failed to ensure labels for ${key}:`, (err as Error).message)
  }
}

// ─── Routes ─────────────────────────────────────────────────────────

export const createGiteaProxy = (): Hono => {
  const api = new Hono()

  /**
   * GET /api/gitea/overview
   *
   * Aggregated dashboard data: repos with open issue/PR counts,
   * recent issues, recent PRs.
   */
  api.get('/overview', async (c) => {
    try {
      const gitea = await getClient()
      const org = await getOrg()

      // Fetch org info and repos in parallel
      const [orgInfo, repos] = await Promise.all([
        gitea.orgs.get(org),
        gitea.orgs.listRepos(org, { limit: 50 }),
      ])

      // For each repo, get open issues and PRs count in parallel
      const repoSummaries = await Promise.all(
        repos.map(async (repo) => {
          const [issues, pulls] = await Promise.allSettled([
            gitea.issues.list(org, repo.name, { state: 'open', limit: 1, type: 'issues' }),
            gitea.pulls.list(org, repo.name, { state: 'open', limit: 1 }),
          ])

          return {
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            html_url: repo.html_url,
            open_issues_count: repo.open_issues_count,
            stars_count: repo.stars_count,
            forks_count: repo.forks_count,
            archived: repo.archived,
            default_branch: repo.default_branch,
            updated_at: repo.updated_at,
            language: (repo as Record<string, unknown>).language || '',
            size: (repo as Record<string, unknown>).size || 0,
            open_pr_count: pulls.status === 'fulfilled' ? pulls.value.length : 0,
          }
        })
      )

      // Sort by last updated
      repoSummaries.sort((a, b) => {
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0
        return dateB - dateA
      })

      return c.json({
        org: { id: orgInfo.id, name: (orgInfo as Record<string, unknown>).username ?? orgInfo.name },
        repos: repoSummaries.filter(r => !r.archived),
        totalRepos: repoSummaries.filter(r => !r.archived).length,
        totalOpenIssues: repoSummaries.reduce((sum, r) => sum + (r.open_issues_count || 0), 0),
        totalOpenPRs: repoSummaries.reduce((sum, r) => sum + r.open_pr_count, 0),
      })
    } catch (err) {
      console.error('[gitea-proxy] overview error:', (err as Error).message)
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  /**
   * GET /api/gitea/repos/:owner/:repo/issues
   */
  api.get('/repos/:owner/:repo/issues', async (c) => {
    try {
      const gitea = await getClient()
      const { owner, repo } = c.req.param()
      const state = c.req.query('state') || 'open'
      const limit = parseInt(c.req.query('limit') || '20', 10)
      const page = parseInt(c.req.query('page') || '1', 10)
      const issues = await gitea.issues.list(owner, repo, { state, limit, page, type: 'issues' })
      return c.json(issues)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  /**
   * GET /api/gitea/repos/:owner/:repo/pulls
   */
  api.get('/repos/:owner/:repo/pulls', async (c) => {
    try {
      const gitea = await getClient()
      const { owner, repo } = c.req.param()
      const state = c.req.query('state') || 'open'
      const limit = parseInt(c.req.query('limit') || '20', 10)
      const pulls = await gitea.pulls.list(owner, repo, { state, limit })
      return c.json(pulls)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  /**
   * GET /api/gitea/repos/:owner/:repo/issues/:number
   */
  api.get('/repos/:owner/:repo/issues/:number', async (c) => {
    try {
      const gitea = await getClient()
      const { owner, repo } = c.req.param()
      const num = parseInt(c.req.param('number'), 10)
      const issue = await gitea.issues.get(owner, repo, num)
      return c.json(issue)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  /**
   * GET /api/gitea/repos/:owner/:repo/pulls/:number
   */
  api.get('/repos/:owner/:repo/pulls/:number', async (c) => {
    try {
      const gitea = await getClient()
      const { owner, repo } = c.req.param()
      const num = parseInt(c.req.param('number'), 10)
      const pr = await gitea.pulls.get(owner, repo, num)
      return c.json(pr)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  /**
   * GET /api/gitea/board
   *
   * Kanban board data: all open issues across org repos, grouped by status/ label.
   * Returns columns (derived from status/ labels) and issue cards.
   */
  api.get('/board', async (c) => {
    try {
      const gitea = await getClient()
      const org = await getOrg()

      // Define board columns from status labels (matches domain/projects.ts)
      const columns = [
        { id: 'backlog', title: 'Backlog', status: null },
        { id: 'ready', title: 'Ready', status: 'status/ready' },
        { id: 'in-progress', title: 'In Progress', status: 'status/in-progress' },
        { id: 'review', title: 'Review', status: 'status/review' },
        { id: 'blocked', title: 'Blocked', status: 'status/blocked' },
        { id: 'done', title: 'Done', status: 'status/done' },
      ]

      // Fetch all repos, then all open issues in parallel
      const repos = await gitea.orgs.listRepos(org, { limit: 50 })
      const activeRepos = repos.filter(r => !r.archived && (r.open_issues_count ?? 0) > 0)

      const allIssues = (
        await Promise.all(
          activeRepos.map(async (repo) => {
            try {
              const issues = await gitea.issues.list(org, repo.name, {
                state: 'open',
                limit: 50,
                type: 'issues',
              })
              return issues.map((issue) => ({ ...issue, _repo: repo.name }))
            } catch {
              return []
            }
          })
        )
      ).flat()

      // Fetch open PRs per active repo (for cross-referencing "Closes #N")
      const allPRs = (
        await Promise.all(
          activeRepos.map(async (repo) => {
            try {
              const prs = await gitea.pulls.list(org, repo.name, { state: 'open', limit: 50 })
              return prs.map((pr) => ({ ...pr, _repo: repo.name }))
            } catch {
              return []
            }
          })
        )
      ).flat()

      // Build PR cross-reference: repo+issueNumber → PR count
      const prLinks = new Map<string, number>()
      for (const pr of allPRs) {
        const body = (pr.body ?? '') + ' ' + (pr.title ?? '')
        const matches = body.matchAll(/(?:closes?|fixes?|resolves?)\s+#(\d+)/gi)
        for (const m of matches) {
          const key = `${pr._repo}#${m[1]}`
          prLinks.set(key, (prLinks.get(key) ?? 0) + 1)
        }
      }

      // Fetch conversations for chat cross-reference (issue-specific via tags)
      let chatLinks = new Map<string, number>()
      try {
        const convs = await listConversations(null, 200)
        for (const conv of convs) {
          if (conv.tags?.length) {
            for (const tag of conv.tags) {
              // Tags like "reponame#42" link to specific issues
              if (tag.includes('#')) {
                chatLinks.set(tag, (chatLinks.get(tag) ?? 0) + 1)
              }
            }
          }
        }
      } catch { /* ignore */ }

      // Group issues into columns by status/ label
      type CardIssue = (typeof allIssues)[number]
      const columnMap = new Map<string, CardIssue[]>()
      for (const col of columns) columnMap.set(col.id, [])

      for (const issue of allIssues) {
        const statusLabel = issue.labels?.find((l) => l.name.startsWith('status/'))
        const col = columns.find((c) => c.status === statusLabel?.name)
        const columnId = col?.id ?? 'backlog'
        columnMap.get(columnId)!.push(issue)
      }

      // Build response
      const board = columns.map((col) => ({
        id: col.id,
        title: col.title,
        status: col.status,
        cards: (columnMap.get(col.id) ?? []).map((issue) => ({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          repo: issue._repo,
          labels: issue.labels ?? [],
          assignee: issue.assignee
            ? { login: issue.assignee.login, avatar_url: issue.assignee.avatar_url }
            : null,
          milestone: issue.milestone ? { title: issue.milestone.title } : null,
          comments: issue.comments ?? 0,
          linked_prs: prLinks.get(`${issue._repo}#${issue.number}`) ?? 0,
          linked_chats: chatLinks.get(`${issue._repo}#${issue.number}`) ?? 0,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          html_url: issue.html_url,
        })),
      }))

      return c.json({ org, columns: board, totalIssues: allIssues.length })
    } catch (err) {
      console.error('[gitea-proxy] board error:', (err as Error).message)
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  /**
   * PATCH /api/gitea/board/move
   *
   * Move an issue card to a different column by updating its status/ label.
   */
  api.patch('/board/move', async (c) => {
    try {
      const gitea = await getClient()
      const { owner, repo, issueNumber, targetColumn } = await c.req.json<{
        owner: string
        repo: string
        issueNumber: number
        targetColumn: string
      }>()

      // Define the column→status mapping
      const columnStatuses: Record<string, string | null> = {
        'backlog': null,
        'ready': 'status/ready',
        'in-progress': 'status/in-progress',
        'review': 'status/review',
        'blocked': 'status/blocked',
        'done': 'status/done',
      }

      const newStatus = columnStatuses[targetColumn]
      if (newStatus === undefined) {
        return c.json({ error: `Invalid column: ${targetColumn}` }, 400)
      }

      // Ensure status labels exist in the repo (Gitea silently ignores
      // unknown label names in PUT /labels, so we must create them first)
      await ensureStatusLabels(gitea, owner, repo)

      // Fetch current labels
      const issue = await gitea.issues.get(owner, repo, issueNumber)
      const currentLabels = (issue.labels ?? []).map((l) => l.name)

      // Remove old status labels, add new one
      const allStatusLabels = Object.values(columnStatuses).filter(Boolean) as string[]
      let newLabels = currentLabels.filter((l) => !allStatusLabels.includes(l))
      if (newStatus) newLabels.push(newStatus)

      await gitea.issues.setLabelsByName(owner, repo, issueNumber, newLabels)

      return c.json({ ok: true, labels: newLabels })
    } catch (err) {
      console.error('[gitea-proxy] board/move error:', (err as Error).message)
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  return api
}
