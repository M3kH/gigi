# Release Strategy

This document describes how Gigi is versioned, released, and published.

## Versioning

Gigi follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (semver):

- **MAJOR** (`X.0.0`) — Breaking changes to APIs, configuration, or database schema
- **MINOR** (`0.X.0`) — New features, backward-compatible additions
- **PATCH** (`0.0.X`) — Bug fixes, documentation updates, minor improvements

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) for automated changelog generation:

```
feat: add Telegram notification support
fix: resolve WebSocket reconnection loop
docs: update self-hosting guide
refactor!: restructure MCP tool registration (breaking)
```

## Day-to-Day Workflow

1. **Development** happens on Gitea (branches → PRs → merge to `main`)
2. **Dual-push** syncs `main` to GitHub automatically
3. **GitHub Actions CI** runs tests on external contributor PRs
4. **Gitea Actions CI** runs tests on internal PRs

## Release Workflow

Releases are triggered manually and automated via GitHub Actions:

### 1. Trigger a Release

```bash
# From GitHub, trigger the release workflow
gh workflow run release.yml -f release_type=minor
```

The `release_type` parameter accepts: `patch`, `minor`, or `major`.

### 2. Release PR Created

The workflow automatically:
- Bumps the version in `package.json`
- Generates a changelog from conventional commits since the last release
- Updates `CHANGELOG.md`
- Creates a `release/vX.Y.Z` branch
- Opens a Release PR on GitHub for review

### 3. Review & Merge

- Review the version bump and changelog
- Ensure CI passes
- Merge the Release PR

### 4. Publish (Automatic)

On merge, the publish workflow automatically:
- Creates a git tag (`vX.Y.Z`)
- Builds a multi-architecture Docker image (linux/amd64, linux/arm64)
- Pushes the image to `ghcr.io`
- Creates a GitHub Release with changelog notes

## Docker Images

Published images are available at:

```
ghcr.io/anthropics/gigi:latest
ghcr.io/anthropics/gigi:vX.Y.Z
```

## Changelog

The [CHANGELOG.md](../CHANGELOG.md) follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and is automatically updated during releases.

## Hotfix Process

For urgent fixes:

1. Create a branch from the release tag: `git checkout -b hotfix/description vX.Y.Z`
2. Apply the fix and commit
3. Trigger the release workflow with `release_type=patch`
4. Follow the normal review/merge/publish flow

## Pre-release Versions

For testing before a stable release:

```bash
gh workflow run release.yml -f release_type=minor -f prerelease=true
```

This creates versions like `0.2.0-rc.1` and marks the GitHub Release as a pre-release.
