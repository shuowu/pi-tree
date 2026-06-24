# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- YouTube source type with transcript extraction and embedded video player
- Electron desktop app (cross-platform: Linux, macOS ARM64, Windows)
- News source type with RSS feed aggregation, crawling, and AI-powered summaries
- Paper source type with arXiv integration
- Custom source types — universal fallback for any content
- Direct markdown file upload support
- Conversational session router on home page (natural language navigation)
- Model switcher with multi-provider support
- Linear-first branching with tree navigation
- MCP client bridge for external tool servers
- Custom user skills and session profiles
- Worktree-based development workflow skill
- GitHub Explorer example extension
- Comprehensive test suite (unit + E2E + Docker smoke tests)

### Changed

- Unified content under `sources/` directory (replaces separate `books/`, `library/` dirs)
- Simplified model config — `models.json` as single source of truth
- Extracted `@pi-tree/core` and `@pi-tree/ui` as separate packages
- Router sessions are now ephemeral (in-memory only)
- Bumped Node.js requirement from 22 to 24 in CI

### Fixed

- Session delete and dedicated sessions page
- Concurrent session safety with per-session mutex
- Chat streaming UX improvements
- Router prompt hardening — no dictionary lookups or filesystem access
- Scroll within chat container instead of page-level scrolling

## [0.1.0] — 2026-06-07

### Added

- Initial release
- Tree-structured AI reading conversations
- Book source support with EPUB/PDF parsing
- Multi-user support (slug-based identity)
- Multi-session per source
- Docker deployment with GHCR publishing
- SQLite database with Drizzle ORM
- VitePress documentation site
- CI pipeline (build, lint, typecheck, test, E2E)
- Local model support via Ollama
- Cloud provider support (DeepSeek, Gemini, Claude, OpenAI)

[Unreleased]: https://github.com/shuowu/pi-tree/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/shuowu/pi-tree/releases/tag/v0.1.0
