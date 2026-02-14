/**
 * MCP Tool — Gitea API
 *
 * Provides authenticated access to Gitea: repos, issues, PRs, comments.
 * Logs self-generated actions to filter webhooks.
 */

import { getConfig, logAction } from '../core/store'

const request = async (method: string, path: string, body: unknown = null): Promise<unknown> => {
  const url = await getConfig('gitea_url')
  const token = await getConfig('gitea_token')
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
  description: 'Interact with Gitea API. Create repos, PRs, issues, comments. Read issues and PR details.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_repos', 'create_repo', 'get_issue', 'list_issues', 'create_issue',
               'comment_issue', 'create_pr', 'list_prs', 'get_pr', 'get_pr_diff'],
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

export const runGitea = async (input: GiteaInput): Promise<unknown> => {
  const { action, owner, repo, number, title, body, head, base } = input

  let result: unknown
  switch (action) {
    case 'list_repos':
      return request('GET', '/user/repos?limit=50')

    case 'create_repo':
      return request('POST', '/user/repos', {
        name: repo,
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
