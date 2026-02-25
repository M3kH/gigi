# Release Strategy

This document describes how Gigi is versioned and released.

> **Note**: Automated release workflows are not yet in place. This document captures the conventions and planned process for when formal releases begin.

## Versioning

Gigi follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (semver):

- **MAJOR** (`X.0.0`) — Breaking changes to APIs, configuration, or database schema
- **MINOR** (`0.X.0`) — New features, backward-compatible additions
- **PATCH** (`0.0.X`) — Bug fixes, documentation updates, minor improvements

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) for changelog generation:

```
feat: add Telegram notification support
fix: resolve WebSocket reconnection loop
docs: update self-hosting guide
refactor!: restructure MCP tool registration (breaking)
```

## Day-to-Day Workflow

1. **Development** happens on Gitea (branches → PRs → merge to `main`)
2. **Gitea Actions CI** runs tests on PRs
3. **Deployments** are manual via Docker Swarm (`docker stack deploy`)

## Release Process (Planned)

When formal releases are introduced, the process will be:

### 1. Prepare the Release

```bash
# Bump version in package.json
npm version minor  # or patch, major

# Update CHANGELOG.md with changes since last release
# Commit the version bump
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

### 2. Build & Deploy

```bash
# Build the AIO Docker image
docker build -f Dockerfile.aio -t gigi:vX.Y.Z .

# Deploy to Docker Swarm
docker stack deploy -c docker-compose.yml gigi
```

### 3. Create a Release (Optional)

Create a Gitea release from the tag with changelog notes.

## Changelog

The [CHANGELOG.md](../CHANGELOG.md) follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and should be updated with each significant change.

## Hotfix Process

For urgent fixes:

1. Create a branch from the release tag: `git checkout -b hotfix/description vX.Y.Z`
2. Apply the fix and commit
3. Create a PR, merge, tag, and deploy

## Docker Images

Currently built and deployed locally. When a public registry is introduced, images will be published with version tags:

```
registry/gigi:latest
registry/gigi:vX.Y.Z
```
