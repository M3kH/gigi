/**
 * API — Gitea Proxy Endpoints
 *
 * Server-side proxy to Gitea REST API for the frontend SPA.
 * The Gitea client uses Node APIs (Buffer, etc) and needs auth tokens,
 * so the frontend calls these thin proxy endpoints instead.
 */

import { Hono } from 'hono'
import { createGiteaClient, type GiteaClient } from '../api-gitea'

// ─── Singleton client ───────────────────────────────────────────────

let client: GiteaClient | null = null

const getClient = (): GiteaClient => {
  if (!client) {
    const baseUrl = process.env.GITEA_URL || 'http://192.168.1.80:3000'
    const token = process.env.GITEA_TOKEN
    if (!token) throw new Error('GITEA_TOKEN not set')
    client = createGiteaClient(baseUrl, token)
  }
  return client
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
      const gitea = getClient()
      const org = 'idea'

      // Fetch repos and recent issues/PRs in parallel
      const [repos, allConvs] = await Promise.all([
        gitea.orgs.listRepos(org, { limit: 50 }),
        // We'll get conversations from the store endpoint separately
        Promise.resolve([]),
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
      const gitea = getClient()
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
      const gitea = getClient()
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
      const gitea = getClient()
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
      const gitea = getClient()
      const { owner, repo } = c.req.param()
      const num = parseInt(c.req.param('number'), 10)
      const pr = await gitea.pulls.get(owner, repo, num)
      return c.json(pr)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  return api
}
