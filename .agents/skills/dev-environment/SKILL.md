---
name: dev-environment
description: >
  Spin up the server and client development services concurrently in a split-pane tmux session.
  Invoke when the user asks to "spin up services", "start development environment",
  "start dev mode", or similar.
---

# Dev Environment Skill

Spin up the backend and frontend development services concurrently in a split-pane `tmux` session.

## Pre-flight Checks

1. **Verify tmux is installed**:
   ```bash
   which tmux
   ```
   If not installed, prompt the user to install `tmux` on their host.

2. **Verify target directory**:
   The script dynamically resolves the workspace root relative to the script location.

## Execution

1. Run the tmux setup script:
   ```bash
   ./scripts/start-dev-tmux.sh
   ```

2. **Verify session status**:
   Ensure the tmux session has started successfully:
   ```bash
   tmux list-panes -t pi-tree
   ```

3. **Provide attachment instructions to the user**:
   Inform the user how to attach, detach, and stop the session:
   - **Attach**: `tmux attach-session -t pi-tree`
   - **Detach**: Press `Ctrl + B`, then release and press `D`.
   - **Stop**: `tmux kill-session -t pi-tree`
