/**
 * MCP Tool — Gitea API
 *
 * Provides authenticated access to Gitea: repos, issues, PRs, comments.
 * Logs self-generated actions to filter webhooks.
 */

import { z } from 'zod'
import { getConfig, logAction } from '../core/store'
import type { AgentTool } from '../core/registry'

const request = async (method: string, path: string, body: unknown = null): Promise<unknown> => {
  const url = process.env.GITEA_URL || await getConfig('gitea_url')
  const token = process.env.GITEA_TOKEN || await getConfig('gitea_token')
  if (!url || !token) return 'Gitea not configured — complete setup first'

  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
    },
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${url}/api/v1${path}`, opts)
  const data = await res.json().catch(() => null)

  if (!res.ok) return `Gitea API error ${res.status}: ${JSON.stringify(data)}`
  return data
}

export interface GiteaInput {
  action: string
  owner?: string
  repo?: string
  number?: number
  title?: string
  body?: string
  head?: string
  base?: string
  private?: boolean
}

export const giteaTool = {
  name: 'gitea',
  description: 'Interact with Gitea API. Create repos, PRs, issues, comments. Read issues, PR details, and comments.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_repos', 'create_repo', 'get_issue', 'list_issues', 'create_issue',
               'comment_issue', 'list_comments', 'create_pr', 'list_prs', 'get_pr', 'get_pr_diff'],
        description: 'The Gitea action to perform',
      },
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      number: { type: 'integer', description: 'Issue or PR number' },
      title: { type: 'string' },
      body: { type: 'string' },
      head: { type: 'string', description: 'Source branch for PR' },
      base: { type: 'string', description: 'Target branch for PR' },
      private: { type: 'boolean', description: 'Whether repo is private' },
    },
    required: ['action'],
  },
}

/**
 * Unescape literal escape sequences (e.g. backslash-n) that LLMs
 * commonly produce in JSON tool-call strings.  Without this, Gitea
 * receives "\\n" as two characters instead of an actual newline.
 */
const unescapeText = (s: string | undefined): string | undefined =>
  s?.replace(/\\n/g, '\n').replace(/\\t/g, '\t')

export const runGitea = async (input: GiteaInput): Promise<unknown> => {
  const { action, owner, repo, number, head, base } = input
  const title = unescapeText(input.title)
  const body  = unescapeText(input.body)

  let result: unknown
  switch (action) {
    case 'list_repos':
      return request('GET', '/user/repos?limit=50')

    case 'create_repo':
      // Create under org if owner is specified, otherwise under user
      return request('POST', owner ? `/orgs/${owner}/repos` : '/user/repos', {
        name: repo,
        description: body || '',
        private: input.private ?? false,
        auto_init: true,
      })

    case 'list_issues':
      return request('GET', `/repos/${owner}/${repo}/issues?state=open&limit=20`)

    case 'get_issue':
      return request('GET', `/repos/${owner}/${repo}/issues/${number}`)

    case 'create_issue':
      result = await request('POST', `/repos/${owner}/${repo}/issues`, { title, body })
      if (result && typeof result === 'object' && 'number' in result) {
        await logAction('create_issue', repo!, `${(result as { number: number }).number}`, { title })
      }
      return result

    case 'comment_issue':
      result = await request('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body })
      if (result && typeof result === 'object' && !('startsWith' in result)) {
        await logAction('comment_issue', repo!, `${number}`, { preview: body?.slice(0, 100) })
      }
      return result

    case 'list_comments':
      // Works for both issues and PRs (Gitea uses the issues endpoint for both)
      return request('GET', `/repos/${owner}/${repo}/issues/${number}/comments`)

    case 'list_prs':
      return request('GET', `/repos/${owner}/${repo}/pulls?state=open&limit=20`)

    case 'get_pr':
      return request('GET', `/repos/${owner}/${repo}/pulls/${number}`)

    case 'get_pr_diff':
      return request('GET', `/repos/${owner}/${repo}/pulls/${number}.diff`)

    case 'create_pr':
      result = await request('POST', `/repos/${owner}/${repo}/pulls`, { title, body, head, base })
      if (result && typeof result === 'object' && 'number' in result) {
        await logAction('create_pr', repo!, `${(result as { number: number }).number}`, { title, head, base })
      }
      return result

    default:
      return `Unknown action: ${action}`
  }
}

// ─── Agent Tools (convention: agentTools export) ────────────────────

const GiteaActionSchema = z.object({
  action: z.enum([
    'list_repos', 'create_repo', 'get_issue', 'list_issues', 'create_issue',
    'comment_issue', 'list_comments', 'create_pr', 'list_prs', 'get_pr', 'get_pr_diff',
  ]).describe('The Gitea action to perform'),
  owner: z.string().optional().describe('Repository owner'),
  repo: z.string().optional().describe('Repository name'),
  number: z.number().optional().describe('Issue or PR number'),
  title: z.string().optional(),
  body: z.string().optional(),
  head: z.string().optional().describe('Source branch for PR'),
  base: z.string().optional().describe('Target branch for PR'),
  private: z.boolean().optional().describe('Whether repo is private'),
})

export const agentTools: AgentTool[] = [
  {
    name: 'gitea',
    description: 'Interact with Gitea API. Create repos, PRs, issues, comments. Auth is automatic.',
    schema: GiteaActionSchema,
    handler: runGitea,
    context: 'server',
    permission: 'gitea.manage',
  },
]
