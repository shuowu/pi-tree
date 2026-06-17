# Contributing to Pi-Tree

Welcome, and thank you for considering a contribution to Pi-Tree! Whether you're fixing a typo, reporting a bug, or building a new feature, your help makes this project better for everyone.

Pi-Tree is an AI-assisted reading and research app built around tree-structured conversations. We believe reading should be interactive, exploratory, and personal — and we'd love your help making that vision a reality.

## Table of Contents

- [Getting Started](#getting-started)
- [Finding Things to Work On](#finding-things-to-work-on)
- [Making Changes](#making-changes)
- [Code Style & Conventions](#code-style--conventions)
- [Adding Skills & Extensions](#adding-skills--extensions)
- [Running Tests](#running-tests)
- [PR Checklist](#pr-checklist)
- [Community & Communication](#community--communication)

## Getting Started

### Prerequisites

- **Node.js ≥ 22**
- **direnv** — used for environment isolation between dev and Docker ([installation guide](https://direnv.net/docs/installation.html))

### Setting Up Your Dev Environment

1. **Fork and clone** the repository:

   ```bash
   git clone https://github.com/<your-username>/pi-tree.git
   cd pi-tree
   ```

2. **Allow direnv** to load the project environment:

   ```bash
   direnv allow
   ```

3. **Create a `.env` file** with your API keys (see `.env.example` if available). At minimum you'll need a model provider key (e.g. `PI_API_KEY`).

4. **Install dependencies**:

   ```bash
   npm install
   ```

5. **Start the dev servers**:

   ```bash
   npm run dev
   ```

   This starts the API server on `:3947` and the Vite client on `:5947`.

> [!TIP]
> You can also run them individually with `npm run dev:server` and `npm run dev:client`.

## Finding Things to Work On

Not sure where to start? Here are a few ideas:

- **[Good First Issues](https://github.com/shuowu/pi-tree/labels/good%20first%20issue)** — curated for newcomers; scoped and well-described.
- **[Help Wanted](https://github.com/shuowu/pi-tree/labels/help%20wanted)** — broader tasks where extra hands are welcome.
- **Bug reports** — reproducing and confirming bugs is always valuable, even without a fix.
- **Documentation** — spotted something unclear or outdated? PRs for docs are just as welcome as code changes.

If you'd like to work on something larger, please **open an issue first** to discuss the approach. This saves everyone time and helps avoid duplicate effort.

## Making Changes

### Branching

Create a descriptive branch from `main`:

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/short-bug-description
```

### Commits

Write clear, concise commit messages. We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(server): add RSS feed deduplication
fix(ui): correct breadcrumb overflow on narrow viewports
docs: update self-hosting guide with Docker examples
```

### Pull Requests

1. Keep PRs focused — one logical change per PR.
2. Fill out the PR description: **what** you changed, **why**, and any **trade-offs**.
3. Link the related issue (e.g., `Closes #42`).
4. Make sure CI passes (tests, lint, typecheck).
5. Be responsive to review feedback — we aim to review PRs promptly and keep discussions constructive.

## Code Style & Conventions

### TypeScript

- Strict mode is enabled. Avoid `any` unless absolutely necessary.
- Prefer explicit return types on exported functions.
- Use the project's existing patterns as a guide — consistency matters more than personal preference.

### Linting & Formatting

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript compiler checks
```

Please fix all lint and type errors before submitting a PR.

### Package Boundaries

This is a monorepo with strict separation of concerns. **Understanding these boundaries is critical**:

| Package | Role | May Import | Must NOT Do |
|---------|------|-----------|-------------|
| `@pi-tree/core` | Pure library | `@earendil-works/pi-coding-agent` | `process.env`, `import.meta.dirname`, file I/O |
| `@pi-tree/ui` | React components | `@pi-tree/core/types`, React, lucide, marked | App-specific API calls, env vars |
| `@pi-tree/server` | API server | `@pi-tree/core`, `node:fs` | Client components |
| `@pi-tree/client` | App shell | `@pi-tree/ui`, `@pi-tree/core/types` | Direct Pi SDK imports |

**Key rule**: `@pi-tree/core` is a pure library. All environment resolution (API keys, model names, paths) happens in the server and is injected via config objects.

If you're unsure whether an import crosses a boundary, check the table above or ask in your PR.

### CSS Conventions

- All UI component classes use the `pit-` prefix (e.g., `.pit-chat-view`, `.pit-breadcrumb-bar`).
- Design tokens use `--pit-*` custom properties (e.g., `--pit-accent`, `--pit-space-4`).
- Components import their own CSS — no separate stylesheet imports needed by consumers.

## Adding Skills & Extensions

Pi-Tree's AI capabilities are organized into **skills** (markdown instruction bundles) and **extensions** (TypeScript tool bundles). These live under `packages/server/src/agents/`.

- **Skills**: `packages/server/src/agents/skills/` — markdown files that define how the AI behaves for specific use cases.
- **Extensions**: `packages/server/src/agents/extensions/` — TypeScript modules that provide tools the AI can call at runtime.

For detailed architecture, see:

- [`website/docs/architecture.md`](website/docs/architecture.md) — how the server wraps Pi SDK, agent directory, session profiles
- [`website/docs/sessions.md`](website/docs/sessions.md) — multi-session model, context binding, session lifecycle

Users can also add custom skills and profiles without modifying the repo — see [`website/docs/self-hosting.md`](website/docs/self-hosting.md).

## Running Tests

```bash
# Unit tests (core + server)
npm test

# End-to-end tests (requires running server + browser)
npm run e2e

# Run a specific test file
npx vitest run packages/server/src/__tests__/api-smoke.test.ts
```

- Unit tests use **Vitest** and mock environment with `vi.stubEnv` — no real API keys needed.
- E2E tests use **Playwright** and need a running dev environment.

Please add or update tests for any new functionality. If you're fixing a bug, a regression test is highly appreciated.

## PR Checklist

Before submitting, please verify:

- [ ] Code compiles: `npm run typecheck`
- [ ] Linter passes: `npm run lint`
- [ ] Tests pass: `npm test`
- [ ] Package boundaries are respected (see [table above](#package-boundaries))
- [ ] New UI classes use the `pit-` prefix
- [ ] Commit messages are clear and descriptive
- [ ] PR description explains the **what** and **why**
- [ ] Related issue is linked

## Community & Communication

- **[GitHub Issues](https://github.com/shuowu/pi-tree/issues)** — bug reports, feature requests, and task tracking.
- **[GitHub Discussions](https://github.com/shuowu/pi-tree/discussions)** — questions, ideas, and general conversation.

We're a small project and genuinely appreciate every contribution. Don't hesitate to ask questions — there are no silly ones.

## License

By contributing to Pi-Tree, you agree that your contributions will be licensed under the [AGPL-3.0-only](LICENSE) license.

---

Thank you for helping make Pi-Tree better! 🌲
