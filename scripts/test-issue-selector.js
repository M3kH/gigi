#!/usr/bin/env node

/**
 * Test script for Issue Selector
 *
 * Usage: node scripts/test-issue-selector.js [owner] [repo] [threshold]
 */

import { getCandidateSummary, getCandidateIssues } from '../src/lib/issueSelector.js';

const owner = process.argv[2] || 'idea';
const repo = process.argv[3] || null;  // null = all repos
const threshold = parseInt(process.argv[4] || '50', 10);

console.log(`\n🔍 Finding candidate issues for autonomous work...`);
console.log(`Owner: ${owner}`);
console.log(`Repo: ${repo || 'all repos'}`);
console.log(`Threshold: ${threshold}\n`);

try {
  const summary = await getCandidateSummary(owner, repo, threshold);
  console.log(summary);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}