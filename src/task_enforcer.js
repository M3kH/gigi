/**
 * Task Completion Enforcer
 *
 * Design: Instead of relying on system prompts to complete tasks,
 * this module enforces completion through code:
 *
 * 1. Tracks active task context in database
 * 2. Detects file changes during agent execution
 * 3. Auto-triggers PR creation when code changes detected
 * 4. Auto-triggers Telegram notification when PR created
 * 5. Prevents agent from "forgetting" to complete the loop
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const { Pool } = pg

let pool

export const initEnforcer = async (dbPool) => {
  pool = dbPool
  await migrate()
}

const migrate = async () => {
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

/**
 * Start tracking a task (called when /issue is loaded)
 */
export const startTask = async (conversationId, repo, issueNumber) => {
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

/**
 * Check workspace for changes and enforce completion
 * Called after agent response completes
 */
export const enforceCompletion = async (conversationId) => {
  const { rows } = await pool.query(`
    SELECT * FROM task_context
    WHERE conversation_id = $1
      AND completed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `, [conversationId])

  if (rows.length === 0) return null // No active task

  const task = rows[0]
  const { repo, issue_number, workspace_snapshot, has_code_changes, pr_created, notified } = task

  // 1. Detect code changes
  if (!has_code_changes) {
    const currentSnapshot = captureWorkspaceSnapshot(repo)
    const hasChanges = detectChanges(workspace_snapshot, currentSnapshot)

    if (hasChanges) {
      await pool.query(`
        UPDATE task_context
        SET has_code_changes = true
        WHERE id = $1
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
        UPDATE task_context
        SET pr_created = true, branch = $2
        WHERE id = $1
      `, [task.id, branchPushed])

      console.log(`[task-enforcer] Branch pushed: ${branchPushed} for ${repo}#${issue_number}`)
      return { action: 'branch_pushed', task, repo, issueNumber: issue_number, branch: branchPushed }
    }
  }

  // 3. Ensure Telegram notification sent
  if (pr_created && !notified) {
    console.log(`[task-enforcer] PR created but notification missing for ${repo}#${issue_number}`)
    return { action: 'needs_notification', task, repo, issueNumber: issue_number, branch: task.branch }
  }

  return null
}

/**
 * Mark notification sent
 */
export const markNotified = async (conversationId, repo, issueNumber) => {
  await pool.query(`
    UPDATE task_context
    SET notified = true, completed_at = now()
    WHERE conversation_id = $1
      AND repo = $2
      AND issue_number = $3
      AND completed_at IS NULL
  `, [conversationId, repo, issueNumber])

  console.log(`[task-enforcer] Task completed: ${repo}#${issue_number}`)
}

/**
 * Capture workspace state for change detection
 */
function captureWorkspaceSnapshot(repo) {
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
      dirtyFiles: gitStatus.split('\n').filter(l => l.trim()).length
    }
  } catch (err) {
    return { exists: true, error: err.message }
  }
}

/**
 * Detect changes between snapshots
 */
function detectChanges(before, after) {
  if (!before || !after) return false
  if (!before.exists || !after.exists) return false

  // Hash changed = commit made
  if (before.hash !== after.hash) return true

  // New dirty files
  if ((after.dirtyFiles || 0) > (before.dirtyFiles || 0)) return true

  return false
}

/**
 * Check if a feature branch was pushed
 */
function checkBranchPushed(repo) {
  const repoPath = `/workspace/${repo}`
  if (!existsSync(repoPath)) return null

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf8' }).trim()

    // Skip if on main/master
    if (branch === 'main' || branch === 'master') return null

    // Check if branch has remote tracking
    try {
      execSync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' })
      return branch // Branch is pushed
    } catch {
      return null // No upstream = not pushed
    }
  } catch (err) {
    return null
  }
}

/**
 * Get current task context
 */
export const getCurrentTask = async (conversationId) => {
  const { rows } = await pool.query(`
    SELECT * FROM task_context
    WHERE conversation_id = $1
      AND completed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `, [conversationId])

  return rows[0] || null
}
