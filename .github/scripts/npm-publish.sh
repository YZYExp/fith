#!/usr/bin/env bash
# Usage: npm-publish.sh <tarball> <dist-tag>
#
# Publish the packed package (with provenance, public, under <dist-tag>).
# Idempotent: a version already on the registry is a skip, so a re-run after a
# partial failure does not fail on it.
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: $0 <tarball> <dist-tag>" >&2; exit 2; }
TARBALL="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" DIST_TAG="$2"

NAME="$(tar -xzOf "$TARBALL" package/package.json | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).name')"
VERSION="$(tar -xzOf "$TARBALL" package/package.json | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')"

if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
  echo "⏭️  $NAME@$VERSION is already on npm"
  exit 0
fi
echo "📦 publishing $NAME@$VERSION (dist-tag $DIST_TAG)"
npm publish "$TARBALL" --provenance --access public --tag "$DIST_TAG"
