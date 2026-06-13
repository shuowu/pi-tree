#!/bin/bash
# worktree-ports.sh — Find the next available dev port pair for a new worktree.
#
# Usage:
#   ./scripts/worktree-ports.sh next     # Print next available ports
#   ./scripts/worktree-ports.sh list     # List all worktrees and their ports
#
# Port scheme:
#   Main dev:    SERVER=3947, CLIENT=5947 (offset 0)
#   Worktree N:  SERVER=3947+N, CLIENT=5947+N
#   Docker:      SERVER=3847 (separate range, no conflict)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_SERVER_PORT=3947
BASE_CLIENT_PORT=5947

# Collect all PORT values from worktree .envrc files
get_used_offsets() {
  local offsets=()
  # Main worktree is always offset 0
  offsets+=(0)

  while IFS= read -r wt_path; do
    [[ -z "$wt_path" ]] && continue
    local envrc="$wt_path/.envrc"
    if [[ -f "$envrc" ]]; then
      local port
      port=$(grep -E '^export PORT=' "$envrc" 2>/dev/null | head -1 | sed 's/export PORT=//')
      if [[ -n "$port" ]]; then
        local offset=$((port - BASE_SERVER_PORT))
        if [[ $offset -gt 0 ]]; then
          offsets+=("$offset")
        fi
      fi
    fi
  done < <(git -C "$REPO_ROOT" worktree list --porcelain | grep '^worktree ' | sed 's/^worktree //')

  printf '%s\n' "${offsets[@]}" | sort -n | uniq
}

cmd="${1:-next}"

case "$cmd" in
  next)
    used=$(get_used_offsets)
    # Find the first gap, or use max+1
    next_offset=1
    while echo "$used" | grep -qx "$next_offset"; do
      next_offset=$((next_offset + 1))
    done
    echo "OFFSET=$next_offset SERVER_PORT=$((BASE_SERVER_PORT + next_offset)) CLIENT_PORT=$((BASE_CLIENT_PORT + next_offset))"
    ;;

  list)
    echo "Worktree Port Assignments:"
    echo "─────────────────────────────────────────────────"
    while IFS= read -r wt_path; do
      [[ -z "$wt_path" ]] && continue
      local_branch=$(git -C "$wt_path" branch --show-current 2>/dev/null || echo "(detached)")
      envrc="$wt_path/.envrc"
      if [[ -f "$envrc" ]]; then
        server_port=$(grep -E '^export PORT=' "$envrc" 2>/dev/null | head -1 | sed 's/export PORT=//' || true)
        client_port=$(grep -E '^export VITE_PORT=' "$envrc" 2>/dev/null | head -1 | sed 's/export VITE_PORT=//' || true)
        data_path=$(grep -E '^export DATA_PATH=' "$envrc" 2>/dev/null | head -1 | sed 's/export DATA_PATH=//' | tr -d '"' || true)
      else
        server_port=""
        client_port=""
      fi
      printf "  %-45s  branch=%-30s  server=%-5s  client=%-5s\n" \
        "$wt_path" "$local_branch" "${server_port:-?}" "${client_port:-?}"
    done < <(git -C "$REPO_ROOT" worktree list --porcelain | grep '^worktree ' | sed 's/^worktree //')
    ;;

  *)
    echo "Usage: $0 {next|list}" >&2
    exit 1
    ;;
esac
