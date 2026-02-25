/**
 * Domain — Issue Handler
 *
 * Parses /issue commands, fetches issue context from Gitea,
 * and ensures issues are tracked on the project board.
 */

import { execSync } from 'node:child_process'
import { ensureIssueTracked } from './projects'

const getOrg = () => process.env.GITEA_ORG || 'acme'

// ─── Types ──────────────────────────────────────────────────────────

export interface IssueCommand {
  repo: string
  number: number
}

export interface IssueContext {
  repo: string
  number: number
  title: string
  body: string
  state: string
  labels: Array<{ name: string }>
  url: string
  created_at: string
  updated_at: string
}

// In-memory issue context
let currentIssue: IssueContext | null = null

// ─── Command Parsing ────────────────────────────────────────────────

export const parseIssueCommand = (text: string): IssueCommand | null => {
  const match = text.match(/^\/issue\s+([a-z0-9-]+)#(\d+)$/i)
  if (!match) return null
  return { repo: match[1], number: parseInt(match[2], 10) }
}

// ─── Issue Loading ──────────────────────────────────────────────────

export const loadIssue = async (repo: string, number: number): Promise<IssueContext> => {
  const giteaUrl = process.env.GITEA_URL || 'http://localhost:3300'
  const giteaToken = process.env.GITEA_TOKEN

  if (!giteaToken) throw new Error('GITEA_TOKEN not set')

  const url = `${giteaUrl}/api/v1/repos/${getOrg()}/${repo}/issues/${number}`

  try {
    const response = execSync(
      `curl -s -H "Authorization: token ${giteaToken}" "${url}"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    )

    const issue = JSON.parse(response)

    if (issue.message) throw new Error(`Gitea API error: ${issue.message}`)

    currentIssue = {
      repo,
      number,
      title: issue.title,
      body: issue.body || '',
      state: issue.state,
      labels: issue.labels || [],
      url: issue.html_url,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    }

    try {
      await ensureIssueTracked(repo, number)
      console.log(`[issue] Ensured ${repo}#${number} is tracked on project board`)
    } catch (err) {
      console.error(`[issue] Failed to ensure tracking: ${(err as Error).message}`)
    }

    return currentIssue
  } catch (err) {
    throw new Error(`Failed to fetch issue ${repo}#${number}: ${(err as Error).message}`)
  }
}

// ─── Context Accessors ──────────────────────────────────────────────

export const getCurrentIssue = (): IssueContext | null => currentIssue

export const formatIssueContext = (): string => {
  if (!currentIssue) return ''

  const labels = currentIssue.labels.map((l) => l.name).join(', ')

  return `## Current Issue Context

**Repository**: ${getOrg()}/${currentIssue.repo}
**Issue**: #${currentIssue.number} - ${currentIssue.title}
**State**: ${currentIssue.state}
**Labels**: ${labels || 'none'}
**URL**: ${currentIssue.url}

### Description

${currentIssue.body}

---

You are now working on this issue.

## Your Responsibilities

1. **Ensure proper tracking**: This issue has been automatically added to the "gigi Command Center" project board.

2. **Update status as you work**: Use the project_manager functions to sync status:
   - \`syncIssueStatus(repo, number, 'status/in-progress')\` when starting work
   - \`syncIssueStatus(repo, number, 'status/review')\` when creating a PR
   - \`syncIssueStatus(repo, number, 'status/done')\` when closing

3. **Add appropriate labels**:
   - Type: \`type/feature\`, \`type/bug\`, \`type/docs\`, etc.
   - Priority: \`priority/critical\`, \`priority/high\`, etc.
   - Scope: \`scope/backend\`, \`scope/frontend\`, etc.
   - Size: \`size/xs\` through \`size/xl\`

4. **Keep the board updated**: The project manager will sync label changes with board columns automatically.

5. **Link PRs properly**: Include "Closes #${currentIssue.number}" in PR descriptions.

See \`docs/GITEA_WORKFLOW.md\` for complete workflow documentation.`
}

export const clearIssue = (): void => {
  currentIssue = null
}
