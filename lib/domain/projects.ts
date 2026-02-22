/**
 * Domain — Project Board Manager
 *
 * Manages Gitea project board: adding issues, moving cards between columns,
 * and keeping labels in sync with board state.
 */

import { execSync } from 'node:child_process'

const GITEA_URL = process.env.GITEA_URL || 'http://localhost:3300'
const GITEA_TOKEN = process.env.GITEA_TOKEN
const PROJECT_ID = 2 // idea Command Center

// ─── Types ──────────────────────────────────────────────────────────

export interface ProjectColumn {
  id: number
  title: string
}

export interface ProjectCard {
  id: number
  issue: {
    number: number
    repository: { name: string }
  }
}

export interface Issue {
  id: number
  number: number
  title: string
  body: string
  state: string
  labels: Array<{ name: string }>
  html_url: string
}

// Column name to status label mapping
const COLUMN_TO_STATUS: Record<string, string | null> = {
  'Backlog': null,
  'Ready': 'status/ready',
  'In Progress': 'status/in-progress',
  'Review': 'status/review',
  'Blocked': 'status/blocked',
  'Done': 'status/done',
}

// ─── Gitea API ──────────────────────────────────────────────────────

const apiCall = (method: string, endpoint: string, data: unknown = null): unknown => {
  if (!GITEA_TOKEN) throw new Error('GITEA_TOKEN not set')

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
    throw new Error(`API call failed: ${(err as Error).message}`)
  }
}

// ─── Project Columns ────────────────────────────────────────────────

export const getProjectColumns = async (): Promise<ProjectColumn[]> => {
  return apiCall('GET', `/projects/${PROJECT_ID}/columns`) as ProjectColumn[]
}

export const getColumnId = async (columnName: string): Promise<number | null> => {
  const columns = await getProjectColumns()
  const column = columns.find((c) => c.title === columnName)
  return column ? column.id : null
}

// ─── Issue/Board Operations ─────────────────────────────────────────

export const isIssueOnProject = async (repo: string, issueNumber: number): Promise<boolean> => {
  try {
    const issues = apiCall('GET', `/projects/${PROJECT_ID}/issues`) as ProjectCard[]
    return issues.some((i) => i.issue.number === issueNumber && i.issue.repository.name === repo)
  } catch {
    return false
  }
}

export const addIssueToProject = async (repo: string, issueNumber: number): Promise<void> => {
  const issue = apiCall('GET', `/repos/idea/${repo}/issues/${issueNumber}`) as Issue

  if (!issue.id) throw new Error(`Could not find issue ${repo}#${issueNumber}`)

  const onBoard = await isIssueOnProject(repo, issueNumber)
  if (onBoard) {
    console.log(`[project] Issue ${repo}#${issueNumber} already on board`)
    return
  }

  try {
    apiCall('POST', `/projects/${PROJECT_ID}/issues`, { issue_id: issue.id })
    console.log(`[project] Added ${repo}#${issueNumber} to project board`)
  } catch (err) {
    throw new Error(`Failed to add issue to project: ${(err as Error).message}`)
  }
}

export const getProjectCard = async (repo: string, issueNumber: number): Promise<ProjectCard | null> => {
  try {
    const issues = apiCall('GET', `/projects/${PROJECT_ID}/issues`) as ProjectCard[]
    return issues.find((i) => i.issue.number === issueNumber && i.issue.repository.name === repo) ?? null
  } catch {
    return null
  }
}

export const moveCardToColumn = async (cardId: number, columnName: string): Promise<void> => {
  const columnId = await getColumnId(columnName)
  if (!columnId) throw new Error(`Column "${columnName}" not found`)

  try {
    apiCall('POST', `/projects/${PROJECT_ID}/columns/${columnId}/cards/${cardId}/move`, { position: 0 })
    console.log(`[project] Moved card ${cardId} to column "${columnName}"`)
  } catch (err) {
    throw new Error(`Failed to move card: ${(err as Error).message}`)
  }
}

// ─── Labels ─────────────────────────────────────────────────────────

export const updateIssueLabels = async (
  repo: string,
  issueNumber: number,
  labelsToAdd: string[] = [],
  labelsToRemove: string[] = []
): Promise<void> => {
  const issue = apiCall('GET', `/repos/idea/${repo}/issues/${issueNumber}`) as Issue

  let currentLabels = issue.labels ? issue.labels.map((l) => l.name) : []
  currentLabels = currentLabels.filter((l) => !labelsToRemove.includes(l))
  currentLabels = [...new Set([...currentLabels, ...labelsToAdd])]

  try {
    apiCall('PUT', `/repos/idea/${repo}/issues/${issueNumber}/labels`, { labels: currentLabels })
    console.log(`[project] Updated labels for ${repo}#${issueNumber}`)
  } catch (err) {
    throw new Error(`Failed to update labels: ${(err as Error).message}`)
  }
}

// ─── Status Sync ────────────────────────────────────────────────────

export const syncIssueStatus = async (repo: string, issueNumber: number, newStatus: string): Promise<void> => {
  const columnName = Object.keys(COLUMN_TO_STATUS).find((k) => COLUMN_TO_STATUS[k] === newStatus)
  if (!columnName) throw new Error(`Invalid status: ${newStatus}`)

  const allStatusLabels = Object.values(COLUMN_TO_STATUS).filter(Boolean) as string[]
  const labelsToRemove = allStatusLabels.filter((l) => l !== newStatus)

  await updateIssueLabels(repo, issueNumber, [newStatus], labelsToRemove)

  const card = await getProjectCard(repo, issueNumber)
  if (card) {
    await moveCardToColumn(card.id, columnName)
  } else {
    console.log(`[project] Issue ${repo}#${issueNumber} not on board, skipping card move`)
  }
}

export const ensureIssueTracked = async (repo: string, issueNumber: number): Promise<void> => {
  const onBoard = await isIssueOnProject(repo, issueNumber)
  if (!onBoard) {
    console.log(`[project] Issue ${repo}#${issueNumber} not on board, adding...`)
    await addIssueToProject(repo, issueNumber)
  }

  const issue = apiCall('GET', `/repos/idea/${repo}/issues/${issueNumber}`) as Issue
  const statusLabel = issue.labels?.find((l) => l.name.startsWith('status/'))

  if (!statusLabel) {
    console.log(`[project] No status label, setting to status/ready`)
    await updateIssueLabels(repo, issueNumber, ['status/ready'], [])
  }
}
