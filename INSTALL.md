# Gitea Organization Setup Guide

This guide covers setting up a Gitea organization for multi-repo project management with Kanban boards and standardized labels.

## Prerequisites

- Gitea instance running (tested on v1.21+)
- Admin/owner access to the organization
- API token with appropriate permissions

## Manual Setup Steps

### 1. Create Organization

1. Navigate to Gitea UI → `+` → `New Organization`
2. Set organization name (e.g., `idea`)
3. Configure visibility (public/private)

### 2. Create Org-Level Labels

**Option A: Manual (Web UI)**
1. Navigate to `http://<gitea-url>/<org>/-/labels`
2. Create each label with name, color, and description

**Option B: Scripted (Requires Owner Token)**

Create an API token with **org owner** permissions:
1. User Settings → Applications → Generate New Token
2. Select scope: `write:org`
3. Save token securely

Then run the label creation script:

```bash
export GITEA_URL="http://192.168.1.80:3000"
export GITEA_TOKEN="your-owner-token-here"

# Use the provided script
./scripts/setup-org-labels.sh idea
```

See `scripts/setup-org-labels.sh` for the complete label set.

### 3. Setup Project Board

**Manual Setup (Required - No API Available)**

1. Navigate to `http://<gitea-url>/<org>/-/projects`
2. Create new project: "Command Center"
3. Add columns matching the status labels:
   - **Backlog** → Link to `status/ready`
   - **In Progress** → Link to `status/in-progress`
   - **Review** → Link to `status/review`
   - **Blocked** → Link to `status/blocked`
   - **Done** → Link to `status/done`

> **Note:** Gitea's API does not expose project board endpoints. Board setup must be done via web UI.

### 4. Migrate Repositories

**Option A: Manual**
1. Go to repo Settings → Transfer Ownership
2. Select target organization
3. Confirm transfer

**Option B: Scripted**

```bash
./scripts/migrate-repos.sh <current-owner> <new-org> <repo-list-file>
```

Example:
```bash
echo -e "gigi\ndeploy-site\ndeploy-docker-compose" > repos.txt
./scripts/migrate-repos.sh ideabile idea repos.txt
```

## Automated Setup (What Can Be Scripted)

### ✅ Can Be Automated (with Owner Token)

- Creating org-level labels
- Migrating repositories
- Syncing labels across repos
- Creating issues
- Creating PRs

### ❌ Cannot Be Automated (Manual Only)

- Creating the organization itself
- Configuring project board columns
- Linking board columns to labels

## Label Schema

See complete label set in `scripts/setup-org-labels.sh`:

- **Priority:** critical, high, medium, low
- **Status:** blocked, needs-info, ready, in-progress, review, done
- **Type:** bug, feature, enhancement, refactor, docs, infra, security
- **Scope:** backend, frontend, ci-cd, deps
- **Size:** xs, s, m, l, xl (effort estimation)

## Verification

After setup, verify:

```bash
# Check org labels
curl -H "Authorization: token $GITEA_TOKEN" \
  "$GITEA_URL/api/v1/orgs/idea/labels"

# Check repos
curl -H "Authorization: token $GITEA_TOKEN" \
  "$GITEA_URL/api/v1/orgs/idea/repos"
```

## Troubleshooting

**"403 Forbidden" when creating org labels:**
- Ensure API token has `write:org` scope
- Verify you are an org owner, not just member

**Repos not showing in board:**
- Check repo visibility matches project visibility
- Manually add repos to project via web UI

**Labels not syncing to new repos:**
- Org-level labels only apply to new repos
- For existing repos, run `sync-labels.sh`

## References

- [Gitea API Docs](https://docs.gitea.io/en-us/api-usage/)
- [Gitea Projects](https://docs.gitea.io/en-us/project/)
