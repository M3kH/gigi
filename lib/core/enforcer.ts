/**
 * Task Completion Enforcer
 *
 * Tracks active tasks in the database, detects file/branch changes,
 * and enforces the PR → notification completion loop.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import pg from 'pg'

const { Pool } = pg

// ─── Types ──────────────────────────────────────────────────────────

export interface WorkspaceSnapshot {
  exists: boolean
  branch?: string
  hash?: string
  dirtyFiles?: number
  error?: string
}

export interface TaskContext {
  id: number
  conversation_id: string
  repo: string
  issue_number: number
  branch: string | null
  has_code_changes: boolean
  pr_created: boolean
  notified: boolean
  started_at: string
  completed_at: string | null
  workspace_snapshot: WorkspaceSnapshot
}

export interface EnforcementResult {
  action: 'code_changed' | 'branch_pushed' | 'needs_notification'
  task: TaskContext
  repo: string
  issueNumber: number
  branch?: string
}

// ─── Init ───────────────────────────────────────────────────────────

let pool: InstanceType<typeof Pool>

export const initEnforcer = async (dbPool: InstanceType<typeof Pool>): Promise<void> => {
  pool = dbPool
  await migrate()
}

const migrate = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_context (
      id SERIAL PRIMARY KEY,
      conversation_id UUID,
      repo VARCHAR(100),
      issue_number INT,
      branch VARCHAR(200),
      has_code_changes BOOLEAN DEFAULT false,
      pr_created BOOLEAN DEFAULT false,
      notified BOOLEAN DEFAULT false,
      started_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ,
      workspace_snapshot JSONB,
      UNIQUE(conversation_id, repo, issue_number)
    );

    CREATE INDEX IF NOT EXISTS idx_task_context_active
      ON task_context(conversation_id, completed_at) WHERE completed_at IS NULL;
  `)
}

// ─── Task Tracking ──────────────────────────────────────────────────

export const startTask = async (
  conversationId: string,
  repo: string,
  issueNumber: number
): Promise<void> => {
  const snapshot = captureWorkspaceSnapshot(repo)

  await pool.query(`
    INSERT INTO task_context (conversation_id, repo, issue_number, workspace_snapshot)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (conversation_id, repo, issue_number)
    DO UPDATE SET
      has_code_changes = false,
      pr_created = false,
      notified = false,
      started_at = now(),
      completed_at = NULL,
      workspace_snapshot = $4
  `, [conversationId, repo, issueNumber, JSON.stringify(snapshot)])

  console.log(`[task-enforcer] Started tracking ${repo}#${issueNumber}`)
}

export const enforceCompletion = async (conversationId: string): Promise<EnforcementResult | null> => {
  const { rows } = await pool.query(`
    SELECT * FROM task_context
    WHERE conversation_id = $1
      AND completed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `, [conversationId])

  if (rows.length === 0) return null

  const task = rows[0] as TaskContext
  const { repo, issue_number, workspace_snapshot, has_code_changes, pr_created, notified } = task

  // 1. Detect code changes
  if (!has_code_changes) {
    const currentSnapshot = captureWorkspaceSnapshot(repo)
    const hasChanges = detectChanges(workspace_snapshot, currentSnapshot)

    if (hasChanges) {
      await pool.query(`
        UPDATE task_context SET has_code_changes = true WHERE id = $1
      `, [task.id])

      console.log(`[task-enforcer] Code changes detected for ${repo}#${issue_number}`)
      return { action: 'code_changed', task, repo, issueNumber: issue_number }
    }
  }

  // 2. Detect PR creation (git push to feature branch)
  if (has_code_changes && !pr_created) {
    const branchPushed = checkBranchPushed(repo)

    if (branchPushed) {
      await pool.query(`
        UPDATE task_context SET pr_created = true, branch = $2 WHERE id = $1
      `, [task.id, branchPushed])

      console.log(`[task-enforcer] Branch pushed: ${branchPushed} for ${repo}#${issue_number}`)
      return { action: 'branch_pushed', task, repo, issueNumber: issue_number, branch: branchPushed }
    }
  }

  // 3. Ensure Telegram notification sent
  if (pr_created && !notified) {
    console.log(`[task-enforcer] PR created but notification missing for ${repo}#${issue_number}`)
    return { action: 'needs_notification', task, repo, issueNumber: issue_number, branch: task.branch ?? undefined }
  }

  return null
}

export const markNotified = async (
  conversationId: string,
  repo: string,
  issueNumber: number
): Promise<void> => {
  await pool.query(`
    UPDATE task_context
    SET notified = true, completed_at = now()
    WHERE conversation_id = $1
      AND repo = $2
      AND issue_number = $3
      AND completed_at IS NULL
  `, [conversationId, repo, issueNumber])

  console.log(`[task-enforcer] Task completed: ${repo}#${issueNumber}`)
}

export const getCurrentTask = async (conversationId: string): Promise<TaskContext | null> => {
  const { rows } = await pool.query(`
    SELECT * FROM task_context
    WHERE conversation_id = $1
      AND completed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `, [conversationId])

  return (rows[0] as TaskContext) || null
}

// ─── Snapshot Helpers ───────────────────────────────────────────────

function captureWorkspaceSnapshot(repo: string): WorkspaceSnapshot {
  const repoPath = `/workspace/${repo}`
  if (!existsSync(repoPath)) return { exists: false }

  try {
    const gitStatus = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8' })
    const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf8' }).trim()
    const gitHash = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim()

    return {
      exists: true,
      branch: gitBranch,
      hash: gitHash,
      dirtyFiles: gitStatus.split('\n').filter((l) => l.trim()).length,
    }
  } catch (err) {
    return { exists: true, error: (err as Error).message }
  }
}

function detectChanges(before: WorkspaceSnapshot, after: WorkspaceSnapshot): boolean {
  if (!before || !after) return false
  if (!before.exists || !after.exists) return false
  if (before.hash !== after.hash) return true
  if ((after.dirtyFiles || 0) > (before.dirtyFiles || 0)) return true
  return false
}

function checkBranchPushed(repo: string): string | null {
  const repoPath = `/workspace/${repo}`
  if (!existsSync(repoPath)) return null

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf8' }).trim()
    if (branch === 'main' || branch === 'master') return null

    try {
      execSync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' })
      return branch
    } catch {
      return null
    }
  } catch {
    return null
  }
}
