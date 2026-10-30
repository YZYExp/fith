#!/usr/bin/env bash
# Usage: smoke-package.sh <tarball> <version>
#
# Install the packed package into an empty project the way a user would (with
# the optional peer `playwright`, and opentype.js only for fith/outline) and check that every
# entry loads and the command runs. Catches a missing file in the tarball, a
# broken `exports` map or a command without its shebang before anything ships.
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: $0 <tarball> <version>" >&2; exit 2; }
TARBALL="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" VERSION="$2"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund "$TARBALL" playwright >/dev/null

node --input-type=module -e '
  import { emitSvg, buildReport } from "fith";
  import { renderToSvg } from "fith/node";
  import { captureElement } from "fith/browser";
  for (const f of [emitSvg, buildReport, renderToSvg, captureElement]) if (typeof f !== "function") throw new Error("missing export");
'
# fith/outline is the one entry that needs the optional peer opentype.js
npm install --no-audit --no-fund opentype.js >/dev/null
node --input-type=module -e '
  import { createOutliner } from "fith/outline";
  if (typeof createOutliner !== "function") throw new Error("missing export");
'
[ "$(node -p 'require("./node_modules/fith/package.json").version')" = "$VERSION" ] || { echo "❌ installed version is not $VERSION" >&2; exit 1; }
if out=$(npx --no-install fith 2>&1); then echo "❌ fith without arguments should exit 1" >&2; exit 1; fi
printf '%s\n' "$out" | grep -q '^usage: fith ' || { echo "❌ fith did not print its usage:" >&2; printf '%s\n' "$out" >&2; exit 1; }
echo "✅ fith@$VERSION installs, every entry loads and the command runs"
