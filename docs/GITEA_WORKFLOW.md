# Gitea Project Board & Label Workflow

This document explains how Gigi should work with Gitea project boards and labels to ensure proper issue tracking.

## Label System

The `gigi` org uses a standardized label system across all repositories:

### Priority Labels
- `priority/critical` - Blocks core functionality
- `priority/high` - Important but not blocking
- `priority/medium` - Normal priority
- `priority/low` - Nice to have

### Status Labels
- `status/blocked` - Cannot proceed
- `status/needs-info` - Awaiting information
- `status/ready` - Ready to work on
- `status/in-progress` - Currently being worked on
- `status/review` - Awaiting review
- `status/done` - Completed

### Type Labels
- `type/bug` - Something broken
- `type/feature` - New functionality
- `type/enhancement` - Improvement to existing feature
- `type/refactor` - Code improvement without behavior change
- `type/docs` - Documentation only
- `type/infra` - Infrastructure/deployment
- `type/security` - Security-related

### Scope Labels
- `scope/backend` - Backend/API work
- `scope/frontend` - UI/UX work
- `scope/ci-cd` - CI/CD pipeline
- `scope/deps` - Dependencies update

### Size Labels (effort estimation)
- `size/xs` - < 1 hour
- `size/s` - 1-4 hours
- `size/m` - 1 day
- `size/l` - 2-3 days
- `size/xl` - > 3 days

## Project Board Structure

The **gigi Command Center** project board (`gigi/-/projects/2`) tracks work across all repositories.

### Board Columns

1. **Backlog** - New issues, not yet ready
2. **Ready** - Ready to work on (maps to `status/ready`)
3. **In Progress** - Currently being worked on (maps to `status/in-progress`)
4. **Review** - Awaiting review (maps to `status/review`)
5. **Blocked** - Cannot proceed (maps to `status/blocked`)
6. **Done** - Completed (maps to `status/done`)

### Important Gitea Limitations

Unlike GitHub Projects v2, Gitea project boards:
- **Do NOT auto-populate** based on labels
- **Require manual addition** of issues to the project
- **Do NOT auto-sync** column position with labels

## Gigi's Workflow

When working with issues, Gigi should:

### 1. When Creating Issues

```javascript
// Create the issue
const issue = await createIssue(repo, title, body, labels)

// Add to project board (project_id = 2 for "gigi Command Center")
await addIssueToProject(repo, issue.number, 2)
```

**Required labels when creating:**
- At least one `type/*` label
- At least one `status/*` label (usually `status/ready`)
- Optional: `priority/*`, `scope/*`, `size/*`

### 2. When Moving Issues Between States

When an issue status changes, **update both the label AND the project column**:

```javascript
// Update the status label
await updateIssueLabels(repo, issueNumber, {
  add: ['status/in-progress'],
  remove: ['status/ready']
})

// Move to the corresponding column on the project board
// Note: This requires the card ID, not the issue number
await moveProjectCard(cardId, columnId)
```

### 3. When Loading Issue Context (`/issue` command)

```javascript
// Fetch issue
const issue = await loadIssue(repo, number)

// Check if it's on the project board
const onBoard = await isIssueOnProject(repo, number, 2)

// If not, add it
if (!onBoard) {
  await addIssueToProject(repo, number, 2)
}

// Provide context to the agent
formatIssueContext(issue)
```

### 4. When Closing Issues

```javascript
// Update status label
await updateIssueLabels(repo, number, {
  add: ['status/done'],
  remove: ['status/in-progress', 'status/review']
})

// Close the issue
await closeIssue(repo, number)

// Move to Done column (if card exists)
const card = await getProjectCard(repo, number, 2)
if (card) {
  await moveProjectCard(card.id, doneColumnId)
}
```

## API Reference

### Add Issue to Project

```bash
curl -X POST \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  "http://your-host-ip:3000/api/v1/projects/2/issues" \
  -d '{"issue_id": 123}'
```

### Get Project Columns

```bash
curl -H "Authorization: token $GITEA_TOKEN" \
  "http://your-host-ip:3000/api/v1/projects/2/columns"
```

### Move Card to Column

```bash
curl -X POST \
  -H "Authorization: token $GITEA_TOKEN" \
  "http://your-host-ip:3000/api/v1/projects/2/columns/{column_id}/cards/{card_id}/move" \
  -d '{"position": 0}'
```

### Update Issue Labels

```bash
curl -X PUT \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  "http://your-host-ip:3000/api/v1/repos/gigi/{repo}/issues/{number}/labels" \
  -d '{"labels": [1, 2, 3]}'  # Label IDs
```

## Best Practices

1. **Always add new issues to the project board immediately**
2. **Keep labels and columns in sync** - if you move a card, update the label
3. **Use size labels** to help with sprint planning
4. **Add comments** when changing status to explain why
5. **Link PRs** to issues using "Closes #123" in PR description
6. **Review labels weekly** to ensure consistency

## Automation Opportunities

Future improvements could include:
- Webhook listener to auto-sync column moves → label updates
- Auto-add new issues to the project board
- Auto-transition to "In Progress" when PR is created
- Auto-transition to "Review" when PR is ready
- Auto-transition to "Done" when PR is merged
