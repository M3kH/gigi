/**
 * API Gitea — Gitea API client types.
 */

export type GiteaAction =
  | 'list_repos'
  | 'create_repo'
  | 'get_issue'
  | 'list_issues'
  | 'create_issue'
  | 'comment_issue'
  | 'list_prs'
  | 'get_pr'
  | 'get_pr_diff'
  | 'create_pr'

export interface GiteaToolInput {
  action: GiteaAction
  owner?: string
  repo?: string
  title?: string
  body?: string
  head?: string
  base?: string
  number?: number
  state?: string
  labels?: string[]
}

export interface GiteaToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}
