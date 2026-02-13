# Issue Selector Service

The Issue Selector service helps identify GitHub/Gitea issues that are suitable for autonomous work by AI agents.

## Overview

The service scores issues based on multiple factors to determine their suitability for autonomous processing:

1. **Size** (30 points max) - Smaller issues are preferred
2. **Type** (25 points max) - Bugs and refactoring tasks score higher
3. **Context** (25 points max) - Well-documented issues with clear requirements
4. **Recency** (20 points max) - Newer issues are prioritized

Total possible score: 100 points

## Usage

### Programmatic API

```javascript
import { getCandidateIssues, scoreIssue } from './lib/issueSelector.js';

// Get all candidate issues from an organization
const candidates = await getCandidateIssues('idea', null, 50);

// Get candidates from a specific repo
const repoCandidates = await getCandidateIssues('idea', 'gigi', 50);

// Score a single issue
const score = scoreIssue(issue);
```

### Test Scripts

```bash
# Test the scoring algorithm
node scripts/run-selector-tests.js

# Find candidate issues (defaults to 'idea' org, all repos, 50+ score)
node scripts/test-issue-selector.js

# Find candidates in specific repo
node scripts/test-issue-selector.js idea gigi

# Use custom threshold
node scripts/test-issue-selector.js idea null 60
```

## Scoring Details

### Size Scoring (max 30 points)
- `size/xs`: 30 points (100%)
- `size/s`: 24 points (80%)
- `size/m`: 15 points (50%)
- `size/l`: 6 points (20%)
- `size/xl`: 3 points (10%)
- No label: 9 points (30% - default medium)

### Type Scoring (max 25 points)
- `type/bug`: 22.5 points (90%) - Clear success criteria
- `type/test`: 22.5 points (90%) - Straightforward implementation
- `type/refactor`: 20 points (80%) - Well-suited for AI
- `type/docs`: 17.5 points (70%) - Documentation updates
- `type/feature`: 15 points (60%) - Requires more interpretation
- No label: 12.5 points (50% - default)

### Context Quality (max 25 points)
Scores based on:
- Word count (10-100+ words)
- Structured content (headers, lists, code blocks)
- Checklists and numbered steps
- Technical details

### Recency (max 20 points)
- < 24 hours: 20 points (100%)
- < 3 days: 18 points (90%)
- < 1 week: 14 points (70%)
- < 2 weeks: 10 points (50%)
- < 1 month: 6 points (30%)
- Older: 2 points (10%)

## Blocked Issues

Issues with these labels are automatically excluded (score = 0):
- `status/blocked`
- `status/needs-human-review`
- `blocked`
- `needs-discussion`
- `waiting-on-author`
- `do-not-merge`

## Integration

The Issue Selector can be integrated into automated workflows:

1. **Periodic scanning** - Run on a schedule to find new work
2. **Webhook triggers** - Run when new issues are created
3. **Manual selection** - Use for on-demand work assignment

## Future Enhancements

- Success rate tracking - Learn which issues are completed successfully
- Personalized scoring - Adjust weights based on agent capabilities
- Domain-specific scoring - Custom rules for different project types
- Historical analysis - Factor in similar completed issues