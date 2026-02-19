/**
 * Completion Detector — Detects unfinished work in agent responses
 *
 * Shared module used by the router (all channels) to detect when
 * the agent's response suggests work was started but not completed.
 * Originally extracted from the Telegram handler's ad-hoc detection.
 *
 * This runs AFTER the enforcer (which tracks DB state like task_context).
 * The detector is a heuristic fallback for cases the enforcer misses,
 * e.g. when the agent doesn't use /issue tracking but still leaves work incomplete.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface DetectionResult {
  /** Whether unfinished work was detected */
  hasUnfinishedWork: boolean
  /** Which signals were detected (for logging/debugging) */
  signals: string[]
  /** Suggested follow-up prompt to send to the agent */
  followUpPrompt: string | null
}

// ── Patterns ───────────────────────────────────────────────────────

/**
 * Phrases that suggest the agent intends to do more work but stopped.
 * These indicate the agent described what it WILL do rather than doing it.
 */
const INTENT_PATTERNS = [
  /\bLet me\b/i,
  /\bI will\b/i,
  /\bI should\b/i,
  /\bI'll\b/i,
  /\bI need to\b/i,
  /\bnow (?:I'll|let me|I need to|I should)\b/i,
]

/**
 * Signals that a PR was mentioned but no URL was provided,
 * suggesting the agent talked about creating a PR without actually doing it.
 */
const PR_WITHOUT_LINK_PATTERN = /\b(?:create|open|make|submit)\s+(?:a\s+)?(?:PR|pull request)\b/i

/**
 * URL patterns that indicate a PR was actually created (link present).
 */
const PR_LINK_PATTERN = /https?:\/\/[^\s]+\/pulls?\/\d+/

/**
 * Signals that code changes were made (commit, push, branch).
 * If these are present without a PR link, work may be incomplete.
 */
const CODE_CHANGE_SIGNALS = [
  /\bgit commit\b/i,
  /\bgit push\b/i,
  /\bcommitted\b/i,
  /\bpushed to\b/i,
  /\bcreated branch\b/i,
  /\bfeat\//i,
  /\bfix\//i,
]

/**
 * Signals that suggest the agent is wrapping up / done.
 * If these are present, we should NOT flag as incomplete even if
 * other signals match (agent might be summarizing).
 */
const COMPLETION_SIGNALS = [
  /\bPR\s*#?\d+/i,                // "PR #28" — referring to existing PR
  /\bmerged\b/i,
  /\bcompleted?\b/i,
  /\ball\s+done\b/i,
  /\bhere'?s?\s+the\s+(?:PR|pull request)\b/i,
]

// ── Main Detection Logic ───────────────────────────────────────────

/**
 * Analyze an agent response for signs of unfinished work.
 *
 * The detection is conservative — it looks for a combination of signals
 * rather than any single pattern to reduce false positives.
 *
 * @param responseText - The agent's full response text
 * @param hadToolCalls - Whether the agent made any tool calls during this turn
 * @returns Detection result with signals and optional follow-up prompt
 */
export function detectUnfinishedWork(
  responseText: string,
  hadToolCalls: boolean = false
): DetectionResult {
  const signals: string[] = []
  const text = responseText || ''

  // If response is very short, unlikely to contain unfinished work signals
  if (text.length < 50) {
    return { hasUnfinishedWork: false, signals: [], followUpPrompt: null }
  }

  // Check for completion signals first — if the agent explicitly says it's done, trust it
  const hasCompletionSignal = COMPLETION_SIGNALS.some(p => p.test(text))
  const hasPrLink = PR_LINK_PATTERN.test(text)

  if (hasCompletionSignal && hasPrLink) {
    return { hasUnfinishedWork: false, signals: [], followUpPrompt: null }
  }

  // Check for intent patterns ("Let me", "I will", etc.)
  for (const pattern of INTENT_PATTERNS) {
    if (pattern.test(text)) {
      signals.push(`intent: ${pattern.source}`)
    }
  }

  // Check for PR mentioned without a link
  if (PR_WITHOUT_LINK_PATTERN.test(text) && !hasPrLink) {
    signals.push('pr_mentioned_no_link')
  }

  // Check for code change signals without PR link
  if (!hasPrLink) {
    for (const pattern of CODE_CHANGE_SIGNALS) {
      if (pattern.test(text)) {
        signals.push(`code_change: ${pattern.source}`)
      }
    }
  }

  // Decision: unfinished if we have intent signals, or code changes without PR
  const hasIntentSignals = signals.some(s => s.startsWith('intent:'))
  const hasCodeWithoutPr = signals.some(s => s.startsWith('code_change:')) && !hasPrLink
  const hasPrWithoutLink = signals.includes('pr_mentioned_no_link')

  const hasUnfinishedWork = (hasIntentSignals && hadToolCalls) || hasCodeWithoutPr || hasPrWithoutLink

  let followUpPrompt: string | null = null
  if (hasUnfinishedWork) {
    if (hasCodeWithoutPr || hasPrWithoutLink) {
      followUpPrompt = 'You appear to have made code changes but did not create a PR or provide a link. Please complete the task: commit remaining changes, push to a feature branch, create a PR via the gitea tool, and share the PR link.'
    } else {
      followUpPrompt = 'You described what you plan to do but may not have finished. Please continue and complete the task. If you already finished, provide a summary with any relevant links (PR URL, etc.).'
    }
  }

  return { hasUnfinishedWork, signals, followUpPrompt }
}
