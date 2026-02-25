# Contributing to Gigi

Thank you for your interest in contributing to Gigi! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Issue Reporting](#issue-reporting)
- [Architecture Overview](#architecture-overview)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@gigi.dev](mailto:conduct@gigi.dev).

## Contributor License Agreement (CLA)

**Important:** Before we can accept your contribution, you must agree to the Contributor License Agreement.

Gigi uses a dual-licensing model (AGPL-3.0 + Commercial). To maintain the ability to offer commercial licenses, we need all contributors to grant us the necessary rights. By submitting a pull request, you agree to the following:

1. You grant the project maintainers a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, sublicense, and distribute your contributions under any license.
2. You confirm that you have the right to grant this license (i.e., the contribution is your original work, or you have the necessary permissions).
3. You understand that your contributions may be distributed under both the AGPL-3.0 license and a separate commercial license.

This is standard practice for dual-licensed open-source projects (used by GitLab, MongoDB, Grafana, and many others).

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **PostgreSQL** >= 14
- **Docker** (for full stack development)
- **Git**

### Development Setup

Gigi uses an **All-In-One (AIO)** container that bundles Gitea, Chrome, and noVNC. For local development, the AIO container runs in infra-only mode while you run the Gigi backend locally with hot reload.

1. **Clone the repository**

   ```bash
   git clone https://github.com/anthropics/gigi.git
   cd gigi
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the full dev environment**

   ```bash
   ./dev.sh          # Starts AIO infra (Gitea + Chrome + Postgres) + dev servers
   ./dev.sh --fresh  # Wipe state and start fresh
   ```

   This starts the AIO container in infra-only mode (Gitea + Chrome), PostgreSQL, and the Gigi dev servers with hot module replacement.

   - **Backend + Frontend (HMR)**: `http://localhost:5173`
   - **Gitea API**: `http://localhost:3300`
   - **noVNC (browser viewer)**: `http://localhost:6080`

4. **Run tests**

   ```bash
   npm test                  # Unit tests
   npm run test:integration  # Integration tests (needs PostgreSQL)
   npm run typecheck         # TypeScript type checking
   ```

### Docker Compose (Production-like)

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL
docker compose up -d
```

This starts the full AIO container (Gigi + Gitea + Chrome) with PostgreSQL.

## Making Changes

### Branch Naming

Use descriptive branch names with a category prefix:

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions/changes
- `infra/description` - Infrastructure/CI changes

### Commit Messages

Write clear, concise commit messages:

- Use the imperative mood ("add feature" not "added feature")
- Keep the first line under 72 characters
- Reference issue numbers where applicable (`Closes #123`)

### Code Style

- **TypeScript** with strict mode enabled
- **Svelte 5** with runes (`$state`, `$derived`, `$effect`) for the frontend
- Use existing patterns in the codebase as reference
- Run `npm run typecheck` before submitting

## Pull Request Guidelines

1. **One PR per feature/fix** - Keep PRs focused and reviewable
2. **Include tests** - For bug fixes, add a test that would have caught the bug. For features, add appropriate coverage
3. **Update documentation** - If your change affects user-facing behavior, update the relevant docs
4. **Link to issues** - Reference the issue your PR addresses with `Closes #N` in the PR description
5. **Keep it small** - Smaller PRs are reviewed faster and merged sooner
6. **Describe your changes** - Write a clear PR description explaining what and why

### PR Template

```markdown
## Summary
- Brief description of changes

## Test Plan
- [ ] How to verify the changes work

Closes #<issue-number>
```

## Issue Reporting

### Bug Reports

Include:
- Clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, Node.js version, browser)
- Relevant logs or screenshots

### Feature Requests

Include:
- Description of the desired feature
- Use case / motivation
- Any implementation ideas (optional)

## Architecture Overview

```
lib/
├── core/           # Agent loop, message router, store, events, enforcer
├── api/            # HTTP routes, webhooks, Telegram bot, Gitea proxy
├── api-gitea/      # Typed Gitea API client wrapper
├── domain/         # Business logic (issues, projects, setup wizard)
├── tools/          # MCP tools (gitea, telegram, ask-user, browser)
└── backup/         # Repository backup/mirror system

web/app/
├── components/     # Svelte 5 UI components
├── lib/stores/     # Reactive stores (chat, panels, navigation, kanban)
├── lib/services/   # WebSocket client, chat API
└── lib/utils/      # Formatting, markdown, link interception

src/
├── index.ts        # Server bootstrap
└── server.ts       # WebSocket server management
```

### Key Concepts

- **Agent**: Claude SDK wrapper with MCP tools, session persistence, and task enforcement
- **Router**: Routes messages between web UI, Telegram, and webhooks to the agent
- **Store**: PostgreSQL-backed config, conversations, and message storage
- **Events**: EventBus propagates agent events to WebSocket clients
- **MCP Tools**: Modular tool system (Gitea, Telegram, browser, ask-user)

## Questions?

If you have questions about contributing, feel free to open a discussion issue or reach out via the project's communication channels.

---

Thank you for helping make Gigi better!
