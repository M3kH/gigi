import { getConfig } from '../store.js'

const request = async (method, path, body = null) => {
  const url = await getConfig('gitea_url')
  const token = await getConfig('gitea_token')
  if (!url || !token) return 'Gitea not configured — complete setup first'

  const opts = {
    method,
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json'
    }
  }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${url}/api/v1${path}`, opts)
  const data = await res.json().catch(() => null)

  if (!res.ok) return `Gitea API error ${res.status}: ${JSON.stringify(data)}`
  return data
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
        description: 'The Gitea action to perform'
      },
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      number: { type: 'integer', description: 'Issue or PR number' },
      title: { type: 'string' },
      body: { type: 'string' },
      head: { type: 'string', description: 'Source branch for PR' },
      base: { type: 'string', description: 'Target branch for PR' },
      private: { type: 'boolean', description: 'Whether repo is private' }
    },
    required: ['action']
  }
}

export const runGitea = async (input) => {
  const { action, owner, repo, number, title, body, head, base } = input

  switch (action) {
    case 'list_repos':
      return request('GET', `/user/repos?limit=50`)

    case 'create_repo':
      return request('POST', '/user/repos', {
        name: repo,
        private: input.private ?? false,
        auto_init: true
      })

    case 'list_issues':
      return request('GET', `/repos/${owner}/${repo}/issues?state=open&limit=20`)

    case 'get_issue':
      return request('GET', `/repos/${owner}/${repo}/issues/${number}`)

    case 'create_issue':
      return request('POST', `/repos/${owner}/${repo}/issues`, { title, body })

    case 'comment_issue':
      return request('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body })

    case 'list_prs':
      return request('GET', `/repos/${owner}/${repo}/pulls?state=open&limit=20`)

    case 'get_pr':
      return request('GET', `/repos/${owner}/${repo}/pulls/${number}`)

    case 'get_pr_diff':
      return request('GET', `/repos/${owner}/${repo}/pulls/${number}.diff`)

    case 'create_pr':
      return request('POST', `/repos/${owner}/${repo}/pulls`, { title, body, head, base })

    default:
      return `Unknown action: ${action}`
  }
}
