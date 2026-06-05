#!/bin/bash

SESSION_NAME="pi-books"

# Check if session already exists
tmux has-session -t "$SESSION_NAME" 2>/dev/null

if [ $? -eq 0 ]; then
  echo "Tmux session '$SESSION_NAME' already exists. Attaching..."
  tmux attach-session -t "$SESSION_NAME"
  exit 0
fi

# Dynamically resolve repository root directory relative to script path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Creating new tmux session: $SESSION_NAME in $REPO_ROOT"

# Create a new session, detached, named pi-books, in the root directory
tmux new-session -d -s "$SESSION_NAME" -n "dev" -c "$REPO_ROOT"

# Split pane horizontally
tmux split-window -h -c "$REPO_ROOT"

# Run server in the left pane (pane 0)
tmux send-keys -t "$SESSION_NAME:0.0" "npm run dev:server" C-m

# Run client in the right pane (pane 1)
tmux send-keys -t "$SESSION_NAME:0.1" "npm run dev:client" C-m

# Select the left pane by default
tmux select-pane -t "$SESSION_NAME:0.0"

echo "Started server and client in tmux session '$SESSION_NAME'."
echo "To attach to the session, run:"
echo "  tmux attach-session -t $SESSION_NAME"
