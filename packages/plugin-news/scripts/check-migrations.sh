#!/usr/bin/env bash
# Verify that db.ts schema changes have a corresponding migration file committed.
# Same pattern as the server's check — generate and diff.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIZZLE_DIR="$PLUGIN_DIR/drizzle"

echo "Checking if db.ts schema changes have corresponding migrations..."

cd "$PLUGIN_DIR"
npx drizzle-kit generate 2>&1 | tail -5

if ! git diff --quiet -- "$DRIZZLE_DIR"; then
  echo ""
  echo "❌ Schema drift detected in news plugin!"
  echo ""
  echo "db.ts has changes that are not reflected in the migration files."
  echo "Run: npm run db:generate -w pi-tree-news"
  echo ""
  git diff --stat -- "$DRIZZLE_DIR"
  exit 1
fi

UNTRACKED=$(git ls-files --others --exclude-standard -- "$DRIZZLE_DIR")
if [ -n "$UNTRACKED" ]; then
  echo ""
  echo "❌ New migration files detected but not committed!"
  echo "$UNTRACKED"
  echo ""
  echo "Run: git add packages/plugin-news/drizzle/"
  exit 1
fi

echo "✅ News plugin migrations are up to date"
