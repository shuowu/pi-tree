---
name: worktree
description: >
  Create a git worktree for a feature branch with isolated dev ports and data directory.
  Invoke ONLY when the user explicitly asks for a git worktree — e.g., "create a worktree",
  "start a worktree", "new worktree", "git worktree". Do NOT invoke for general branch work;
  use invoke_subagent with Workspace: "branch" for that instead.
  Also handles listing and removing worktrees.
---

# Worktree Skill

Create and manage git worktrees with isolated dev environments (unique ports, separate data directories) so multiple branches can run dev servers simultaneously without conflicts.

Worktrees are placed **inside** the repo at `.worktrees/` (gitignored) so that Antigravity subagents inherit the workspace's file permissions automatically — no re-prompting for access.

## Port Allocation Scheme

Each worktree gets a unique port offset to avoid conflicts:

| Worktree | Server Port | Client Port | Data Path |
|----------|-------------|-------------|-----------|
| Main (`.envrc`) | 3947 | 5947 | `~/.local/share/pi-tree-dev` |
| Worktree 1 | 3948 | 5948 | `~/.local/share/pi-tree-wt-<branch>` |
| Worktree 2 | 3949 | 5949 | `~/.local/share/pi-tree-wt-<branch>` |
| Docker | 3847 | — | `/data` (container) |

The offset is determined by scanning existing worktrees and picking the next available slot.

## Creating a Worktree

### 1. Determine branch name and base

Ask the user for:
- **Branch name** (e.g., `feat/new-feature` or `fix/bug-123`)
- **Base ref** (default: `master`)

### 2. Compute worktree path

Worktrees are placed inside the repo's `.worktrees/` directory (which is gitignored):
```
~/repos/pi-tree/                              ← main repo
~/repos/pi-tree/.worktrees/<branch-suffix>/   ← worktree
```

Where `<branch-suffix>` is the branch name with `/` replaced by `-` (e.g., `feat/new-feature` → `feat-new-feature`).

### 3. Find next available port offset

Run the helper script to find the next free port pair:
```bash
./scripts/worktree-ports.sh next
```

This outputs a line like `OFFSET=1 SERVER_PORT=3948 CLIENT_PORT=5948`.

If the script doesn't exist yet, compute manually:
1. List existing worktrees: `git worktree list --porcelain`
2. Check each worktree's `.envrc` for PORT values
3. Pick the next offset (main = 0, first worktree = 1, etc.)
4. Server port = `3947 + offset`, Client port = `5947 + offset`

### 4. Create the worktree

Ensure the `.worktrees/` directory exists, then create the worktree:

```bash
mkdir -p .worktrees
git worktree add .worktrees/<branch-suffix> -b <branch-name> <base-ref>
```

### 5. Generate `.envrc` for the worktree

Create a `.envrc` file in the new worktree directory. The `dotenv` directive needs
to reference the main repo's `.env` since the worktree is a subdirectory:

```bash
cat > .worktrees/<branch-suffix>/.envrc << 'EOF'
# Pi-Tree worktree dev environment
# Auto-generated — ports offset to avoid conflicts with main dev and Docker.

# Load shared secrets from main repo's .env (API keys, models, paths)
dotenv ../../.env

# Worktree-specific overrides
export PORT=<server-port>
export VITE_API_PORT=<server-port>
export VITE_PORT=<client-port>
export DATA_PATH="${HOME}/.local/share/pi-tree-wt-<branch-suffix>"
EOF
```

Then allow it:
```bash
cd .worktrees/<branch-suffix> && direnv allow
```

### 6. Install dependencies

```bash
cd .worktrees/<branch-suffix> && npm install
```

### 7. Report to user

Tell the user:
- Worktree path (relative to repo root: `.worktrees/<branch-suffix>`)
- Branch name
- Server port and client port
- Data path
- How to start dev: `cd .worktrees/<branch-suffix> && npm run dev`
- How to remove: `git worktree remove .worktrees/<branch-suffix>`

## Listing Worktrees

When the user asks to "list worktrees" or "show worktrees":

```bash
git worktree list
```

For each worktree, also show the assigned ports by reading its `.envrc`:
```bash
grep -E '^export (PORT|VITE_PORT)=' <worktree-path>/.envrc 2>/dev/null
```

## Removing a Worktree

When the user asks to "remove a worktree" or "clean up worktree":

1. Remove the worktree:
   ```bash
   git worktree remove .worktrees/<branch-suffix>
   ```
2. Optionally delete the branch:
   ```bash
   git branch -d <branch-name>
   ```
3. The data directory (`~/.local/share/pi-tree-wt-<branch>`) is left intact unless the user explicitly asks to delete it.

## Migrating Existing Sibling Worktrees

If there are legacy worktrees placed as siblings (e.g., `~/repos/pi-tree--feat-*`), migrate them:

```bash
# 1. Note the branch and current state
git worktree list

# 2. Remove the old worktree (keeps the branch)
git worktree remove ../pi-tree--<branch-suffix>

# 3. Re-create inside .worktrees/
mkdir -p .worktrees
git worktree add .worktrees/<branch-suffix> <branch-name>

# 4. Generate new .envrc (see step 5 above) and npm install
```
