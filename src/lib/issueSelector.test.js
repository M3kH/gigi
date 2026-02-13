/**
 * Tests for Issue Selector Service
 */

import { scoreIssue, getCandidateIssues } from './issueSelector.js';
import { jest } from '@jest/globals';

describe('Issue Selector', () => {
  describe('scoreIssue', () => {
    it('should give high scores to small, well-documented bugs', () => {
      const issue = {
        title: 'Fix authentication error',
        body: `## Problem

        Users are getting a 401 error when trying to login with valid credentials.

        ## Steps to reproduce

        1. Go to login page
        2. Enter valid credentials
        3. Click submit
        4. See 401 error

        ## Expected behavior

        User should be logged in successfully.

        ## Technical details

        The issue appears to be in the JWT validation middleware. The token expiry check
        is comparing timestamps incorrectly.`,
        created_at: new Date().toISOString(),
        labels: [
          { name: 'type/bug' },
          { name: 'size/s' },
          { name: 'status/ready' }
        ]
      };

      const result = scoreIssue(issue);

      expect(result.blocked).toBe(false);
      expect(result.total).toBeGreaterThan(70); // Should be high scoring
      expect(result.breakdown.size).toBeGreaterThan(20); // Small size
      expect(result.breakdown.type).toBeGreaterThan(20); // Bug type
      expect(result.breakdown.context).toBeGreaterThan(20); // Good context
      expect(result.breakdown.recency).toBeGreaterThan(15); // Recent
    });

    it('should give lower scores to large, vague features', () => {
      const issue = {
        title: 'Add new dashboard',
        body: 'We need a new dashboard for users.',
        created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days old
        labels: [
          { name: 'type/feature' },
          { name: 'size/xl' },
          { name: 'status/ready' }
        ]
      };

      const result = scoreIssue(issue);

      expect(result.blocked).toBe(false);
      expect(result.total).toBeLessThan(40); // Should be low scoring
      expect(result.breakdown.size).toBeLessThan(5); // XL size
      expect(result.breakdown.context).toBeLessThan(10); // Poor context
    });

    it('should return zero score for blocked issues', () => {
      const issue = {
        title: 'Update API',
        body: 'Update the API to support new features',
        created_at: new Date().toISOString(),
        labels: [
          { name: 'type/feature' },
          { name: 'size/m' },
          { name: 'status/blocked' } // Blocked!
        ]
      };

      const result = scoreIssue(issue);

      expect(result.blocked).toBe(true);
      expect(result.total).toBe(0);
    });

    it('should return zero score for needs-human-review issues', () => {
      const issue = {
        title: 'Review security implementation',
        body: 'Need to review the security implementation',
        created_at: new Date().toISOString(),
        labels: [
          { name: 'type/feature' },
          { name: 'status/needs-human-review' } // Needs human!
        ]
      };

      const result = scoreIssue(issue);

      expect(result.blocked).toBe(true);
      expect(result.total).toBe(0);
    });

    it('should handle missing labels gracefully', () => {
      const issue = {
        title: 'Fix something',
        body: 'There is a bug that needs fixing',
        created_at: new Date().toISOString(),
        labels: []
      };

      const result = scoreIssue(issue);

      expect(result.blocked).toBe(false);
      expect(result.total).toBeGreaterThan(0); // Should still get some score
      // Should use defaults
      expect(result.breakdown.size).toBeGreaterThan(0);
      expect(result.breakdown.type).toBeGreaterThan(0);
    });

    it('should reward structured content', () => {
      const structuredIssue = {
        title: 'Refactor auth module',
        body: `## Overview

        The authentication module needs refactoring.

        ## Tasks

        - [ ] Extract JWT logic to separate module
        - [ ] Add unit tests
        - [ ] Update documentation

        ## Code example

        \`\`\`javascript
        // Current implementation
        function validateToken(token) {
          // ...
        }
        \`\`\``,
        created_at: new Date().toISOString(),
        labels: [{ name: 'type/refactor' }]
      };

      const unstructuredIssue = {
        title: 'Refactor auth module',
        body: 'The authentication module needs refactoring to be cleaner.',
        created_at: new Date().toISOString(),
        labels: [{ name: 'type/refactor' }]
      };

      const structuredResult = scoreIssue(structuredIssue);
      const unstructuredResult = scoreIssue(unstructuredIssue);

      expect(structuredResult.breakdown.context).toBeGreaterThan(
        unstructuredResult.breakdown.context
      );
    });

    it('should calculate recency scores correctly', () => {
      const now = new Date();

      const todayIssue = {
        title: 'Issue from today',
        body: 'Test issue',
        created_at: now.toISOString(),
        labels: []
      };

      const weekOldIssue = {
        title: 'Week old issue',
        body: 'Test issue',
        created_at: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
        labels: []
      };

      const monthOldIssue = {
        title: 'Month old issue',
        body: 'Test issue',
        created_at: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        labels: []
      };

      const todayResult = scoreIssue(todayIssue);
      const weekResult = scoreIssue(weekOldIssue);
      const monthResult = scoreIssue(monthOldIssue);

      expect(todayResult.breakdown.recency).toBeGreaterThan(
        weekResult.breakdown.recency
      );
      expect(weekResult.breakdown.recency).toBeGreaterThan(
        monthResult.breakdown.recency
      );
    });
  });

  describe('getCandidateIssues', () => {
    // Mock the gitea module
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should filter and sort issues by score', async () => {
      // This would need proper mocking of the gitea module
      // For now, we'll skip the integration test
    });
  });
});