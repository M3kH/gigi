/**
 * Issue handler for /issue command
 *
 * Parses `/issue <repo>#<number>` and fetches issue context from Gitea
 * Stores current issue context in memory for agent to act on
 * Ensures issues are tracked on the project board
 */

import { execSync } from 'node:child_process'
import { ensureIssueTracked } from './project_manager.js'

// In-memory issue context (could be persisted to DB later)
let currentIssue = null

/**
 * Parse /issue command
 * @param {string} text - Message text
 * @returns {object|null} - { repo, number } or null
 */
export const parseIssueCommand = (text) => {
  const match = text.match(/^\/issue\s+([a-z0-9-]+)#(\d+)$/i)
  if (!match) return null
  return { repo: match[1], number: parseInt(match[2], 10) }
}

/**
 * Fetch issue from Gitea and load into context
 * @param {string} repo - Repository name
 * @param {number} number - Issue number
 * @returns {object} - Issue data
 */
export const loadIssue = async (repo, number) => {
  const giteaUrl = process.env.GITEA_URL || 'http://192.168.1.80:3000'
  const giteaToken = process.env.GITEA_TOKEN

  if (!giteaToken) {
    throw new Error('GITEA_TOKEN not set')
  }

  const url = `${giteaUrl}/api/v1/repos/idea/${repo}/issues/${number}`

  try {
    const response = execSync(
      `curl -s -H "Authorization: token ${giteaToken}" "${url}"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    )

    const issue = JSON.parse(response)

    if (issue.message) {
      throw new Error(`Gitea API error: ${issue.message}`)
    }

    currentIssue = {
      repo,
      number,
      title: issue.title,
      body: issue.body || '',
      state: issue.state,
      labels: issue.labels || [],
      url: issue.html_url,
      created_at: issue.created_at,
      updated_at: issue.updated_at
    }

    // Ensure issue is tracked on the project board
    try {
      await ensureIssueTracked(repo, number)
      console.log(`[issue] Ensured ${repo}#${number} is tracked on project board`)
    } catch (err) {
      console.error(`[issue] Failed to ensure tracking: ${err.message}`)
      // Don't fail the whole operation if project tracking fails
    }

    return currentIssue
  } catch (err) {
    throw new Error(`Failed to fetch issue ${repo}#${number}: ${err.message}`)
  }
}

/**
 * Get current issue context
 * @returns {object|null}
 */
export const getCurrentIssue = () => currentIssue

/**
 * Format issue as context for agent
 * @returns {string}
 */
export const formatIssueContext = () => {
  if (!currentIssue) return ''

  const labels = currentIssue.labels.map(l => l.name).join(', ')

  return `## Current Issue Context

**Repository**: idea/${currentIssue.repo}
**Issue**: #${currentIssue.number} - ${currentIssue.title}
**State**: ${currentIssue.state}
**Labels**: ${labels || 'none'}
**URL**: ${currentIssue.url}

### Description

${currentIssue.body}

---

You are now working on this issue.

## Your Responsibilities

1. **Ensure proper tracking**: This issue has been automatically added to the "idea Command Center" project board.

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

/**
 * Clear current issue context
 */
export const clearIssue = () => {
  currentIssue = null
}
