/**
 * Issue Selector Service
 *
 * Identifies and scores issues suitable for autonomous work by analyzing:
 * - Issue size/complexity
 * - Type (bugs, features, etc.)
 * - Context quality (description completeness)
 * - Recency (freshness)
 *
 * Filters out blocked or human-review-required issues.
 */

import { getIssues } from './gitea.js';

// Scoring weights
const WEIGHTS = {
  size: 30,      // Max 30 points based on size
  type: 25,      // Max 25 points based on type
  context: 25,   // Max 25 points based on context quality
  recency: 20    // Max 20 points based on freshness
};

// Size scoring (smaller = better for autonomous work)
const SIZE_SCORES = {
  'size/xs': 1.0,   // 30 points
  'size/s': 0.8,    // 24 points
  'size/m': 0.5,    // 15 points
  'size/l': 0.2,    // 6 points
  'size/xl': 0.1    // 3 points
};

// Type scoring (some types are better suited for automation)
const TYPE_SCORES = {
  'type/bug': 0.9,       // 22.5 points - bugs often have clear success criteria
  'type/refactor': 0.8,  // 20 points - refactoring is well-suited for AI
  'type/docs': 0.7,      // 17.5 points - documentation updates
  'type/feature': 0.6,   // 15 points - features need more interpretation
  'type/test': 0.9       // 22.5 points - test writing is straightforward
};

// Blocked labels that exclude an issue from selection
const BLOCKED_LABELS = [
  'status/blocked',
  'status/needs-human-review',
  'blocked',
  'needs-discussion',
  'waiting-on-author',
  'do-not-merge'
];

/**
 * Calculate the context quality score based on issue description
 * @param {Object} issue - The issue object
 * @returns {number} Score between 0 and 1
 */
function calculateContextScore(issue) {
  const body = issue.body || '';
  const wordCount = body.split(/\s+/).filter(word => word.length > 0).length;

  let score = 0;

  // Base score from word count (more context = better)
  if (wordCount >= 100) score += 0.4;
  else if (wordCount >= 50) score += 0.3;
  else if (wordCount >= 20) score += 0.2;
  else if (wordCount >= 10) score += 0.1;

  // Bonus for structured content
  if (body.includes('## ')) score += 0.2;  // Has headers
  if (body.includes('- [ ]') || body.includes('- [x]')) score += 0.2;  // Has checklist
  if (body.includes('```')) score += 0.1;  // Has code blocks
  if (body.match(/\d+\./)) score += 0.1;   // Has numbered lists

  return Math.min(score, 1.0);
}

/**
 * Calculate recency score based on issue age
 * @param {string} createdAt - ISO date string
 * @returns {number} Score between 0 and 1
 */
function calculateRecencyScore(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const ageInDays = (now - created) / (1000 * 60 * 60 * 24);

  if (ageInDays <= 1) return 1.0;      // Last 24 hours: full points
  if (ageInDays <= 3) return 0.9;      // Last 3 days
  if (ageInDays <= 7) return 0.7;      // Last week
  if (ageInDays <= 14) return 0.5;     // Last 2 weeks
  if (ageInDays <= 30) return 0.3;     // Last month
  return 0.1;                           // Older issues still get some points
}

/**
 * Score a single issue for autonomous work suitability
 * @param {Object} issue - The issue object from Gitea
 * @returns {Object} Scoring breakdown and total score
 */
export function scoreIssue(issue) {
  const labels = issue.labels || [];
  const labelNames = labels.map(l => l.name);

  // Check if blocked
  const isBlocked = labelNames.some(label =>
    BLOCKED_LABELS.includes(label.toLowerCase())
  );

  if (isBlocked) {
    return { total: 0, blocked: true };
  }

  // Calculate individual scores
  const sizeLabel = labelNames.find(l => l.startsWith('size/'));
  const sizeScore = (sizeLabel && SIZE_SCORES[sizeLabel]) ?
    SIZE_SCORES[sizeLabel] * WEIGHTS.size :
    0.3 * WEIGHTS.size; // Default to medium if no size label

  const typeLabel = labelNames.find(l => l.startsWith('type/'));
  const typeScore = (typeLabel && TYPE_SCORES[typeLabel]) ?
    TYPE_SCORES[typeLabel] * WEIGHTS.type :
    0.5 * WEIGHTS.type; // Default to medium if no type label

  const contextScore = calculateContextScore(issue) * WEIGHTS.context;
  const recencyScore = calculateRecencyScore(issue.created_at) * WEIGHTS.recency;

  const total = sizeScore + typeScore + contextScore + recencyScore;

  return {
    total: Math.round(total),
    breakdown: {
      size: Math.round(sizeScore),
      type: Math.round(typeScore),
      context: Math.round(contextScore),
      recency: Math.round(recencyScore)
    },
    blocked: false
  };
}

/**
 * Get candidate issues suitable for autonomous work
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name (optional, queries all repos if not provided)
 * @param {number} threshold - Minimum score to include (default: 50)
 * @returns {Promise<Array>} Sorted array of candidate issues with scores
 */
export async function getCandidateIssues(owner, repo = null, threshold = 50) {
  try {
    // Query for open issues with status/ready label
    const issues = await getIssues(owner, repo, {
      state: 'open',
      labels: 'status/ready'
    });

    // Score and filter issues
    const candidates = [];

    for (const issue of issues) {
      const scoreResult = scoreIssue(issue);

      if (!scoreResult.blocked && scoreResult.total >= threshold) {
        candidates.push({
          ...issue,
          score: scoreResult.total,
          scoreBreakdown: scoreResult.breakdown,
          repo: issue.repository ? issue.repository.name : repo
        });
      }
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  } catch (error) {
    console.error('Error fetching candidate issues:', error);
    throw error;
  }
}

/**
 * Get a formatted summary of candidate issues
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name (optional)
 * @param {number} threshold - Minimum score to include
 * @returns {Promise<string>} Formatted summary
 */
export async function getCandidateSummary(owner, repo = null, threshold = 50) {
  const candidates = await getCandidateIssues(owner, repo, threshold);

  if (candidates.length === 0) {
    return 'No suitable candidate issues found.';
  }

  let summary = `Found ${candidates.length} candidate issue${candidates.length > 1 ? 's' : ''}:\n\n`;

  for (const issue of candidates.slice(0, 10)) { // Top 10
    summary += `• ${issue.repo}#${issue.number}: ${issue.title}\n`;
    summary += `  Score: ${issue.score} (size: ${issue.scoreBreakdown.size}, ` +
               `type: ${issue.scoreBreakdown.type}, context: ${issue.scoreBreakdown.context}, ` +
               `recency: ${issue.scoreBreakdown.recency})\n`;
    summary += `  ${issue.html_url}\n\n`;
  }

  return summary;
}