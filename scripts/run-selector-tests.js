#!/usr/bin/env node

/**
 * Simple test runner for Issue Selector unit tests
 */

import { scoreIssue } from '../src/lib/issueSelector.js';

console.log('🧪 Running Issue Selector Tests...\n');

// Test 1: High-scoring issue
console.log('Test 1: Small, well-documented bug (should score high)');
const goodIssue = {
  title: 'Fix auth error',
  body: `## Problem

Users are getting 401 errors.

## Steps to reproduce

1. Login with valid credentials
2. See error

## Expected

Should login successfully.

## Technical details

JWT validation is comparing timestamps incorrectly.`,
  created_at: new Date().toISOString(),
  labels: [
    { name: 'type/bug' },
    { name: 'size/s' },
    { name: 'status/ready' }
  ]
};

const goodResult = scoreIssue(goodIssue);
console.log('Score:', goodResult.total);
console.log('Breakdown:', goodResult.breakdown);
console.log('✅ Pass:', goodResult.total > 70 ? 'Yes' : 'No');
console.log();

// Test 2: Low-scoring issue
console.log('Test 2: Large, vague feature (should score low)');
const vagueIssue = {
  title: 'Add dashboard',
  body: 'Need a dashboard.',
  created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  labels: [
    { name: 'type/feature' },
    { name: 'size/xl' },
    { name: 'status/ready' }
  ]
};

const vagueResult = scoreIssue(vagueIssue);
console.log('Score:', vagueResult.total);
console.log('Breakdown:', vagueResult.breakdown);
console.log('✅ Pass:', vagueResult.total < 40 ? 'Yes' : 'No');
console.log();

// Test 3: Blocked issue
console.log('Test 3: Blocked issue (should score 0)');
const blockedIssue = {
  title: 'Update API',
  body: 'Update the API',
  created_at: new Date().toISOString(),
  labels: [
    { name: 'type/feature' },
    { name: 'status/blocked' }
  ]
};

const blockedResult = scoreIssue(blockedIssue);
console.log('Score:', blockedResult.total);
console.log('Blocked:', blockedResult.blocked);
console.log('✅ Pass:', blockedResult.total === 0 && blockedResult.blocked ? 'Yes' : 'No');
console.log();

// Test 4: No labels (should use defaults)
console.log('Test 4: No labels (should still score)');
const noLabelIssue = {
  title: 'Fix something',
  body: 'There is a bug that needs fixing in the authentication module.',
  created_at: new Date().toISOString(),
  labels: []
};

const noLabelResult = scoreIssue(noLabelIssue);
console.log('Score:', noLabelResult.total);
console.log('Breakdown:', noLabelResult.breakdown);
console.log('✅ Pass:', noLabelResult.total > 0 ? 'Yes' : 'No');
console.log();

console.log('✨ All tests completed!');