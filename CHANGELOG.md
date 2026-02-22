# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial public release preparation
- AGPL-3.0 license with commercial dual-licensing option
- Contributing guidelines with CLA
- Security policy
- Code of Conduct

## [0.1.0] - 2026-02-22

### Added
- **AI Agent** powered by Claude Agent SDK with MCP tool integration
- **Real-time Web UI** built with Svelte 5
  - Chat overlay with markdown rendering and streaming
  - Kanban board synced with Gitea issues
  - Embedded Gitea iframe with proxy authentication
  - Shared browser tab (Chrome DevTools Protocol)
  - Dashboard with system overview
- **Session Persistence** via Claude SDK session resumption
- **Gitea Integration**
  - Full API client (repos, issues, PRs, labels, comments)
  - Webhook routing: issues, PRs, comments, pushes
  - Automatic conversation creation from webhook events
  - @mention detection and response
- **Telegram Bot** via grammY with conversation management
- **Task Completion Enforcement** ensures agent completes full PR workflow
- **Self-Modification** capability via PR workflow on own codebase
- **MCP Tools**
  - `gitea` - Gitea API operations
  - `ask_user` - Interactive questions via web UI
  - `telegram_send` - Telegram messaging
  - Chrome DevTools - Browser navigation, screenshots, DOM interaction
- **Repository Backup** system with configurable mirroring
- **Project Board** management with label-based Kanban workflow
- **Docker Swarm** deployment with Gitea Actions CI/CD
- **Setup Wizard** for initial configuration via web UI

[Unreleased]: https://github.com/anthropics/gigi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/anthropics/gigi/releases/tag/v0.1.0
