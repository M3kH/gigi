/**
 * Project board manager for Gitea
 *
 * Handles adding issues to projects, moving cards between columns,
 * and keeping labels in sync with board state.
 */

import { execSync } from 'node:child_process'

const GITEA_URL = process.env.GITEA_URL || 'http://192.168.1.80:3000'
const GITEA_TOKEN = process.env.GITEA_TOKEN
const PROJECT_ID = 2 // idea Command Center

// Column name to status label mapping
const COLUMN_TO_STATUS = {
  'Backlog': null, // No status label for backlog
  'Ready': 'status/ready',
  'In Progress': 'status/in-progress',
  'Review': 'status/review',
  'Blocked': 'status/blocked',
  'Done': 'status/done'
}

/**
 * Execute Gitea API call via curl
 */
const apiCall = (method, endpoint, data = null) => {
  if (!GITEA_TOKEN) {
    throw new Error('GITEA_TOKEN not set')
  }

  const url = `${GITEA_URL}/api/v1${endpoint}`
  let cmd = `curl -s -X ${method} -H "Authorization: token ${GITEA_TOKEN}"`

  if (data) {
    cmd += ` -H "Content-Type: application/json" -d '${JSON.stringify(data)}'`
  }

  cmd += ` "${url}"`

  try {
    const response = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    return JSON.parse(response)
  } catch (err) {
    throw new Error(`API call failed: ${err.message}`)
  }
}

/**
 * Get project columns
 */
export const getProjectColumns = async () => {
  return apiCall('GET', `/projects/${PROJECT_ID}/columns`)
}

/**
 * Get column ID by name
 */
export const getColumnId = async (columnName) => {
  const columns = await getProjectColumns()
  const column = columns.find(c => c.title === columnName)
  return column ? column.id : null
}

/**
 * Check if issue is on the project board
 */
export const isIssueOnProject = async (repo, issueNumber) => {
  try {
    // Get all project issues
    const issues = apiCall('GET', `/projects/${PROJECT_ID}/issues`)
    return issues.some(i => i.issue.number === issueNumber && i.issue.repository.name === repo)
  } catch {
    return false
  }
}

/**
 * Add issue to project board
 */
export const addIssueToProject = async (repo, issueNumber) => {
  // First get the issue ID (not the same as issue number)
  const issue = apiCall('GET', `/repos/idea/${repo}/issues/${issueNumber}`)

  if (!issue.id) {
    throw new Error(`Could not find issue ${repo}#${issueNumber}`)
  }

  // Check if already on board
  const onBoard = await isIssueOnProject(repo, issueNumber)
  if (onBoard) {
    console.log(`[project] Issue ${repo}#${issueNumber} already on board`)
    return
  }

  // Add to project
  try {
    apiCall('POST', `/projects/${PROJECT_ID}/issues`, { issue_id: issue.id })
    console.log(`[project] Added ${repo}#${issueNumber} to project board`)
  } catch (err) {
    throw new Error(`Failed to add issue to project: ${err.message}`)
  }
}

/**
 * Get project card for an issue
 */
export const getProjectCard = async (repo, issueNumber) => {
  try {
    const issues = apiCall('GET', `/projects/${PROJECT_ID}/issues`)
    return issues.find(i => i.issue.number === issueNumber && i.issue.repository.name === repo)
  } catch {
    return null
  }
}

/**
 * Move card to column
 */
export const moveCardToColumn = async (cardId, columnName) => {
  const columnId = await getColumnId(columnName)
  if (!columnId) {
    throw new Error(`Column "${columnName}" not found`)
  }

  try {
    // Move card to column (position 0 = top)
    apiCall('POST', `/projects/${PROJECT_ID}/columns/${columnId}/cards/${cardId}/move`, {
      position: 0
    })
    console.log(`[project] Moved card ${cardId} to column "${columnName}"`)
  } catch (err) {
    throw new Error(`Failed to move card: ${err.message}`)
  }
}

/**
 * Update issue labels
 */
export const updateIssueLabels = async (repo, issueNumber, labelsToAdd = [], labelsToRemove = []) => {
  // Get current issue
  const issue = apiCall('GET', `/repos/idea/${repo}/issues/${issueNumber}`)

  // Get current label names
  let currentLabels = issue.labels ? issue.labels.map(l => l.name) : []

  // Remove labels
  currentLabels = currentLabels.filter(l => !labelsToRemove.includes(l))

  // Add new labels
  currentLabels = [...new Set([...currentLabels, ...labelsToAdd])]

  // Update labels
  try {
    apiCall('PUT', `/repos/idea/${repo}/issues/${issueNumber}/labels`, {
      labels: currentLabels
    })
    console.log(`[project] Updated labels for ${repo}#${issueNumber}`)
  } catch (err) {
    throw new Error(`Failed to update labels: ${err.message}`)
  }
}

/**
 * Sync issue status with board position
 * Updates both the label and the board column
 */
export const syncIssueStatus = async (repo, issueNumber, newStatus) => {
  // Map status to column name
  const columnName = Object.keys(COLUMN_TO_STATUS).find(
    k => COLUMN_TO_STATUS[k] === newStatus
  )

  if (!columnName) {
    throw new Error(`Invalid status: ${newStatus}`)
  }

  // Update label (remove old status labels, add new one)
  const allStatusLabels = Object.values(COLUMN_TO_STATUS).filter(Boolean)
  const labelsToRemove = allStatusLabels.filter(l => l !== newStatus)

  await updateIssueLabels(repo, issueNumber, [newStatus], labelsToRemove)

  // Move card on board
  const card = await getProjectCard(repo, issueNumber)
  if (card) {
    await moveCardToColumn(card.id, columnName)
  } else {
    console.log(`[project] Issue ${repo}#${issueNumber} not on board, skipping card move`)
  }
}

/**
 * Ensure issue is properly tracked
 * Call this when loading an issue to ensure it's on the board
 */
export const ensureIssueTracked = async (repo, issueNumber) => {
  // Add to project if not already there
  const onBoard = await isIssueOnProject(repo, issueNumber)
  if (!onBoard) {
    console.log(`[project] Issue ${repo}#${issueNumber} not on board, adding...`)
    await addIssueToProject(repo, issueNumber)
  }

  // Get current status label
  const issue = apiCall('GET', `/repos/idea/${repo}/issues/${issueNumber}`)
  const statusLabel = issue.labels?.find(l => l.name.startsWith('status/'))

  // If no status label, add 'status/ready'
  if (!statusLabel) {
    console.log(`[project] No status label, setting to status/ready`)
    await updateIssueLabels(repo, issueNumber, ['status/ready'], [])
  }
}
