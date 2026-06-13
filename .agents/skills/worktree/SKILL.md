---
name: worktree
description: >
  Create a git worktree for a feature branch with isolated dev ports and data directory.
  Invoke when the user asks to "create a worktree", "start a worktree", "new worktree",
  "work on a branch", or similar. Also handles listing and removing worktrees.
---

# Worktree Skill

Create and manage git worktrees with isolated dev environments (unique ports, separate data directories) so multiple branches can run dev servers simultaneously without conflicts.

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

Worktrees are placed as siblings of the main repo:
```
~/repos/pi-tree                       ← main
~/repos/pi-tree--<branch-suffix>      ← worktree
```

Where `<branch-suffix>` is the branch name with `/` replaced by `-` (e.g., `feat/new-feature` → `pi-tree--feat-new-feature`).

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

```bash
git worktree add ../pi-tree--<branch-suffix> -b <branch-name> <base-ref>
```

### 5. Generate `.envrc` for the worktree

Create a `.envrc` file in the new worktree directory:

```bash
cat > ../pi-tree--<branch-suffix>/.envrc << 'EOF'
# Pi-Tree worktree dev environment
# Auto-generated — ports offset to avoid conflicts with main dev and Docker.

# Load shared secrets from .env (API keys, models, paths)
dotenv

# Worktree-specific overrides
export PORT=<server-port>
export VITE_API_PORT=<server-port>
export VITE_PORT=<client-port>
export DATA_PATH="${HOME}/.local/share/pi-tree-wt-<branch-suffix>"
EOF
```

Then allow it:
```bash
cd ../pi-tree--<branch-suffix> && direnv allow
```

### 6. Install dependencies

```bash
cd ../pi-tree--<branch-suffix> && npm install
```

### 7. Report to user

Tell the user:
- Worktree path
- Branch name
- Server port and client port
- Data path
- How to start dev: `cd <path> && npm run dev`
- How to remove: `git worktree remove <path>`

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
   git worktree remove <path>
   ```
2. Optionally delete the branch:
   ```bash
   git branch -d <branch-name>
   ```
3. The data directory (`~/.local/share/pi-tree-wt-<branch>`) is left intact unless the user explicitly asks to delete it.
