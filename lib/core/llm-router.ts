/**
 * LLM Router — Intelligent message classification and model selection
 *
 * Classifies incoming messages by complexity to route them to the
 * appropriate model:
 * - Simple (greetings, thanks, status checks) → Haiku (fast, cheap)
 * - Tool-assisted but simple (read issue, list PRs) → Haiku with limited tools
 * - Complex (code changes, multi-step workflows) → Opus (full agent)
 *
 * Expected impact: 50-80% cost reduction for typical usage patterns.
 *
 * Part of issue #21: Token optimization strategies.
 */

export type MessageComplexity = 'simple' | 'tool-simple' | 'complex'

export interface RoutingDecision {
  complexity: MessageComplexity
  model: string
  reason: string
  /** Whether to include MCP tools in the agent session */
  includeTools: boolean
  /** Maximum turns for this request */
  maxTurns: number
  /** Whether to use a minimal system prompt */
  useMinimalPrompt: boolean
}

// ── Pattern Matching ─────────────────────────────────────────────────

/**
 * Patterns for simple messages that don't need Opus or tools.
 * These can be answered with a lightweight model directly.
 */
const SIMPLE_PATTERNS: RegExp[] = [
  // Greetings
  /^(hi|hello|hey|ciao|good\s*(morning|afternoon|evening)|what'?s?\s*up|yo)\b/i,
  // Thanks/acknowledgments
  /^(thanks?|thank\s*you|ty|grazie|ok\b|okay|got\s*it|cool|great|nice|awesome|perfect|sounds\s*good)/i,
  // Simple questions about Gigi itself
  /^(who\s+are\s+you|what\s+(can\s+you|do\s+you)\s+do)/i,
  // Short affirmatives/negatives
  /^(yes|no|yep|nope|sure|nah|yeah)\s*[.!?]?$/i,
  // "How are you" type
  /^how\s+(are|r)\s+(you|u)/i,
]

/**
 * Patterns that indicate tool-assisted but simple requests.
 * Can use Haiku with limited tools and fewer turns.
 */
const TOOL_SIMPLE_PATTERNS: RegExp[] = [
  // Status checks
  /\b(status|state)\s+(of|for)\s+(issue|pr|pull\s*request|ticket|repo)/i,
  /\bwhat('?s|\s+is)\s+the\s+(status|state)\b/i,
  // List/show requests
  /\b(list|show|get)\s+(all\s+)?(open\s+)?(issues?|prs?|pull\s*requests?|repos?|labels?)/i,
  // Simple lookups
  /\b(read|show|open|view|look\s+at)\s+(issue|pr|pull\s*request)\s*#?\d+/i,
  // What's in a file/repo
  /\bwhat('?s|\s+is)\s+(in|inside)\b/i,
]

/**
 * Patterns that ALWAYS need full Opus agent.
 * If any of these match, skip simple/tool-simple classification.
 */
const COMPLEX_PATTERNS: RegExp[] = [
  // Code/implementation requests
  /\b(implement|create|build|write|add|fix|refactor|update|modify|change|edit|remove|delete)\b/i,
  // PR/branch operations
  /\b(create\s+(a\s+)?pr|make\s+(a\s+)?pull\s*request|push|commit|branch|merge|deploy)\b/i,
  // Issue commands
  /\/issue\s+/i,
  // Multi-step indicators
  /\b(and\s+then|after\s+that|also|additionally|step\s+\d|first.*then)\b/i,
  // Analysis requests
  /\b(analyze|review|investigate|debug|troubleshoot|diagnose|optimize|improve|performance)\b/i,
  // File operations
  /\b(read|write|edit|create)\s+(the\s+)?file/i,
  // Run commands
  /\b(run|execute)\s+(the\s+)?(test|build|command|script|npm|docker)/i,
]

// ── Minimal System Prompt ────────────────────────────────────────────

/**
 * Minimal system prompt for simple conversations.
 * ~50 tokens vs ~1300 tokens for the full prompt.
 * Reduces cache read tokens dramatically for simple responses.
 */
export const MINIMAL_SYSTEM_PROMPT = `You are Gigi 🤵🏻‍♂️, a persistent AI coordinator.
You help the operator build, deploy, and maintain projects.

Be concise, upbeat, and proactive.
On your first reply in a new conversation, begin with [title: brief 3-5 word description] on its own line.`

// ── Classification ───────────────────────────────────────────────────

/**
 * Classify a message and return routing decision.
 *
 * Classification logic:
 * 1. If any COMPLEX_PATTERN matches → complex (Opus + all tools + full prompt)
 * 2. If any TOOL_SIMPLE_PATTERN matches → tool-simple (Haiku + limited tools)
 * 3. If any SIMPLE_PATTERN matches AND message is short → simple (Haiku, no tools)
 * 4. Default → complex (safe fallback)
 */
export const classifyMessage = (
  text: string,
  hasSessionId: boolean = false
): RoutingDecision => {
  const trimmed = text.trim()
  const wordCount = trimmed.split(/\s+/).length

  // System/enforcer messages always go to Opus
  if (trimmed.startsWith('[ENFORCER]') || trimmed.startsWith('[SYSTEM]')) {
    return {
      complexity: 'complex',
      model: 'claude-opus-4-6',
      reason: 'system/enforcer message',
      includeTools: true,
      maxTurns: 50,
      useMinimalPrompt: false,
    }
  }

  // Check complex patterns first (takes priority)
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        complexity: 'complex',
        model: 'claude-opus-4-6',
        reason: `matches complex pattern: ${pattern.source.slice(0, 40)}`,
        includeTools: true,
        maxTurns: 50,
        useMinimalPrompt: false,
      }
    }
  }

  // Check tool-simple patterns
  for (const pattern of TOOL_SIMPLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        complexity: 'tool-simple',
        model: 'claude-haiku-4-5',
        reason: `matches tool-simple pattern: ${pattern.source.slice(0, 40)}`,
        includeTools: true,
        maxTurns: 5,
        useMinimalPrompt: true,
      }
    }
  }

  // Check simple patterns (only for short messages)
  if (wordCount <= 15) {
    for (const pattern of SIMPLE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          complexity: 'simple',
          model: 'claude-haiku-4-5',
          reason: `matches simple pattern: ${pattern.source.slice(0, 40)}`,
          includeTools: false,
          maxTurns: 1,
          useMinimalPrompt: true,
        }
      }
    }
  }

  // Short, non-complex messages without tools context — use Haiku
  if (wordCount <= 5 && !hasSessionId) {
    return {
      complexity: 'simple',
      model: 'claude-haiku-4-5',
      reason: 'very short message, no active session',
      includeTools: false,
      maxTurns: 1,
      useMinimalPrompt: true,
    }
  }

  // Default: full Opus for safety
  return {
    complexity: 'complex',
    model: 'claude-opus-4-6',
    reason: 'default (no simple pattern matched)',
    includeTools: true,
    maxTurns: 50,
    useMinimalPrompt: false,
  }
}
