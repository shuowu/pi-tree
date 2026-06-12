# GitHub Explorer — Example Extension

This example shows how to create a custom pi-tree extension that clones GitHub repositories and lets the AI explore them conversationally.

It demonstrates the full pattern: **extension** (tools) + **skill** (AI instructions) + **profile** (wiring).

## What's Included

```
extensions/github/index.ts          # Tools: clone_repo, list_repos
skills/github-reading/SKILL.md     # AI instructions for codebase exploration
profiles/github-reading.yml         # Session profile wiring it together
```

## How It Works

1. **`clone_repo`** — Clones a GitHub repo to `$DATA_PATH/repos/<owner>/<repo>/` using `git`
2. **`list_repos`** — Lists previously cloned repos
3. **Pi's built-in tools** (`read`, `grep`, `find`, `ls`) — Explore the cloned codebase

The extension is intentionally minimal — it only handles cloning. All file exploration is done by Pi SDK's built-in tools, which already know how to read files, search code, and list directories.

## Setup

Copy the three directories into your pi-tree data path:

```bash
# Default data path (adjust if you set DATA_PATH differently)
DATA_PATH="${DATA_PATH:-$HOME/.local/share/pi-tree}"

cp -r extensions/github  "$DATA_PATH/extensions/"
cp -r skills/github-reading  "$DATA_PATH/skills/"
cp -r profiles/github-reading.yml  "$DATA_PATH/profiles/"
```

For Docker, mount them or copy into your data volume:

```bash
# If using a bind mount for data:
cp -r extensions/github  ./data/extensions/
cp -r skills/github-reading  ./data/skills/
cp -r profiles/github-reading.yml  ./data/profiles/
```

Then restart the server (extensions are discovered at startup).

## Prerequisites

- **`git`** must be available in `PATH` (installed on virtually all dev machines and most Docker images)

## Usage

1. Open any source in pi-tree
2. Create a new session → select **"GitHub Explorer"** mode
3. Ask the AI to explore a repo:
   - *"Clone and explore facebook/react"*
   - *"What's the architecture of expressjs/express?"*
   - *"How does the routing work in remix-run/remix?"*

## Customising

This example is a starting point — fork it to build your own flows:

- **Add more tools**: GitHub REST API calls (`fetch`), issue listing, PR diffs, etc.
- **Private repos**: Set `GITHUB_TOKEN` env var and add an `Authorization` header to the clone URL
- **Different source types**: Change `source_type` in the profile (or remove it to show for all sources)
- **Smarter skill**: Add project-type detection (monorepo, microservice, library) to the skill instructions
