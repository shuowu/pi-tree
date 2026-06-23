#!/usr/bin/env bash
# Verify that schema.ts changes have a corresponding migration file committed.
#
# How it works:
#   1. Runs `drizzle-kit generate` (which diffs schema.ts against the latest snapshot)
#   2. Checks if anything new was generated (via git diff on the drizzle/ folder)
#   3. If there's a diff → developer forgot to generate → exit 1
#
# Usage:
#   npm run db:check          (from packages/server)
#   npm run db:check -w @pi-tree/server  (from repo root)
#
# Add to CI:
#   - name: Check migrations are up to date
#     run: npm run db:check -w @pi-tree/server

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIZZLE_DIR="$SERVER_DIR/drizzle"

echo "Checking if schema.ts changes have corresponding migrations..."

# Run generate (produces new files if schema changed)
cd "$SERVER_DIR"
npx drizzle-kit generate 2>&1 | tail -5

# Check for uncommitted changes in the drizzle folder
if ! git diff --quiet -- "$DRIZZLE_DIR"; then
  echo ""
  echo "❌ Schema drift detected!"
  echo ""
  echo "schema.ts has changes that are not reflected in the migration files."
  echo "Run this to fix:"
  echo ""
  echo "  npm run db:generate -w @pi-tree/server"
  echo "  git add packages/server/drizzle/"
  echo ""
  echo "Changes detected:"
  git diff --stat -- "$DRIZZLE_DIR"
  exit 1
fi

# Also check for untracked files (new migration files not yet committed)
UNTRACKED=$(git ls-files --others --exclude-standard -- "$DRIZZLE_DIR")
if [ -n "$UNTRACKED" ]; then
  echo ""
  echo "❌ New migration files detected but not committed!"
  echo ""
  echo "$UNTRACKED"
  echo ""
  echo "Run: git add packages/server/drizzle/"
  exit 1
fi

echo "✅ Migrations are up to date"
