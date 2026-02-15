# Plan: Local Repository Sync

## Goal

Mount local repos into gigi → they become Gitea repos automatically.
Agent works in Gitea, changes sync back to local directory in real-time.
User sees agent's work in their local editor as it happens.

## The Problem

Local repos already have an `origin` remote (GitHub, Gitea, etc.).
We can't just overwrite `origin` with the internal Gitea URL.
We need a separate sync mechanism that's explicit and discoverable.

## Design

### Git Remote Convention

Use a dedicated remote name: `gigi`

```
# In the local repo, after init:
git remote add gigi http://gitea:3000/idea/my-repo.git
```

- `origin` stays untouched (points to GitHub or wherever)
- `gigi` remote points to the internal Gitea instance
- Sync operates exclusively on the `gigi` remote

### Detection: How Gigi Knows a Repo is Synced

Option A: **Git config flag**
```
git config --local gigi.sync true
git config --local gigi.org idea
```
- Discoverable: `git config --get gigi.sync` → `true`
- Per-repo, lives in `.git/config`
- No extra files needed

Option B: **`.gigi.yml` in repo root**
```yaml
sync: true
org: idea
```
- Visible in the repo itself
- Could be committed or gitignored
- More discoverable for humans

**Recommendation:** Option A (git config). It's invisible, doesn't pollute the repo, and is the standard way to store per-repo metadata. The init script sets it up, and the sync process checks for it.

### Flow

#### 1. Initial Import (init container / dev.sh startup)

For each directory in `/repositories/`:

```sh
for repo in /repositories/*/; do
  name=$(basename "$repo")
  cd "$repo"

  # Skip if not a git repo
  [ -d .git ] || continue

  # Create repo in Gitea if not exists
  curl -X POST "$GITEA_URL/api/v1/orgs/$ORG/repos" \
    -H "Authorization: token $TOKEN" \
    -d "{\"name\": \"$name\", \"auto_init\": false}"

  # Add gigi remote if not present
  if ! git remote get-url gigi 2>/dev/null; then
    git remote add gigi "http://$ADMIN_USER:$ADMIN_PASS@gitea:3000/$ORG/$name.git"
  fi

  # Set sync flag
  git config --local gigi.sync true
  git config --local gigi.org "$ORG"

  # Initial push (all branches + tags)
  git push gigi --all
  git push gigi --tags
done
```

#### 2. Gitea → Local Sync (webhook)

On Gitea push event → gigi webhook handler:

```
POST /webhook/gitea
  event: push
  repo: idea/my-repo
```

Handler logic:
```ts
// In webhook handler, on push event:
const repoName = payload.repository.name
const repoPath = `/repositories/${repoName}`

// Check if local repo exists and has sync enabled
// git config --get gigi.sync → true
if (syncEnabled) {
  const branch = payload.ref.replace('refs/heads/', '')
  // Fetch from gigi remote and reset local branch
  git -C $repoPath fetch gigi
  git -C $repoPath checkout $branch
  git -C $repoPath reset --hard gigi/$branch
}
```

#### 3. Local → Gitea Sync (optional, future)

Not in v1. If user wants to push local changes to Gitea:
```sh
git push gigi main
```
Manual, explicit, no magic.

### Docker Compose Changes

```yaml
# Mount as read-write (not :ro)
volumes:
  - ${REPOSITORIES_PATH:-/dev/null}:/repositories:rw

# gigi service also needs the mount
gigi:
  volumes:
    - ${REPOSITORIES_PATH:-/dev/null}:/repositories:rw
```

### Env Vars

```sh
# dev.sh
export REPOSITORIES_PATH="$HOME/projects"  # or wherever
```

### Edge Cases

| Case | Behavior |
|------|----------|
| Local repo has uncommitted changes | Sync skips — `reset --hard` only moves branch pointer, doesn't touch untracked files. But staged/modified tracked files would be lost. **Solution:** check for dirty state, skip + warn. |
| Local branch doesn't exist in Gitea | Ignored — sync only operates on branches that Gitea pushes |
| Gitea repo deleted | Sync silently fails, no local changes |
| Multiple branches pushed | Sync only updates the pushed branch (from webhook payload) |
| Local repo has no `gigi` remote | Skip — not a synced repo |
| Force push to Gitea | `reset --hard` handles it correctly |

### Security

- The `gigi` remote URL contains credentials (for pushing during init)
- Credentials live in `.git/config` — never committed
- In production, use token-based auth instead of password

## Files to Change

| File | Change |
|------|--------|
| `scripts/local-init.sh` | Add repo import loop |
| `docker-compose.local.yml` | Mount `:rw`, add mount to gigi service |
| `dev.sh` | Add `REPOSITORIES_PATH` env var |
| `lib/api/web.ts` or `lib/webhooks.ts` | Add push → local sync handler |

## Not in v1

- Watching local filesystem for changes (inotify → push to Gitea)
- Conflict resolution
- Partial sync (specific branches only)
- UI showing sync status
