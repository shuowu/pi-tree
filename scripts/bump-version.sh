#!/usr/bin/env bash
# Usage: ./scripts/bump-version.sh <version>
# Example: ./scripts/bump-version.sh 0.3.0
#
# Updates all package.json files to the given version, updates the README
# badge, and creates a version commit + git tag.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.3.0"
  exit 1
fi

VERSION="$1"

# Strip leading 'v' if provided (e.g., v0.3.0 → 0.3.0)
VERSION="${VERSION#v}"

# Validate semver-ish format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: '$VERSION' doesn't look like a valid version (expected: X.Y.Z)"
  exit 1
fi

echo "Bumping all packages to v${VERSION}..."

# 1. Update root package.json
npm version "$VERSION" --no-git-tag-version

# 2. Update all workspace packages
npm version "$VERSION" --no-git-tag-version --workspaces

# 3. Update README static badge
if grep -q 'img.shields.io/badge/release-v' README.md; then
  sed -i "s|release-v[0-9]*\.[0-9]*\.[0-9]*|release-v${VERSION}|g" README.md
  echo "Updated README badge to v${VERSION}"
fi

# 4. Show what changed
echo ""
echo "Updated versions:"
grep -rn "\"version\": \"${VERSION}\"" package.json packages/*/package.json
echo ""

# 5. Commit and tag
git add package.json packages/*/package.json README.md
git commit -m "chore: bump version to v${VERSION}"
git tag -a "v${VERSION}" -m "v${VERSION}"

echo ""
echo "✅ Done! Created commit and tag v${VERSION}"
echo "   Push with: git push && git push --tags"
