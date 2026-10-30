#!/usr/bin/env bash
# Usage: scripts/npm-bootstrap.sh [owner/repo]
#
# Run once, by a maintainer, on their own machine, before the first release.
# CI publishes only through Trusted Publishing, and npm lets a trusted publisher
# be added only to a package that already exists, so for `fith` this:
#
#   1. publishes an empty 0.0.0 placeholder (dist-tag `placeholder`) so the name exists;
#   2. adds the trusted publisher: <owner/repo>, release.yml, environment production;
#   3. sets publishing access to "require 2FA and disallow tokens".
#
# <owner/repo> is the repository that runs the release (default: this checkout's
# `origin`). If the repository moves, run it again with the new one. Needs
# npm >= 11.15 (for `npm trust`), `npm login` first, and 2FA on the account: npm
# asks for a one-time password at each step. Safe to re-run: a name that already
# exists is not re-published, and a trusted publisher that is already there is
# reported, not duplicated. See .design/release.md.
set -euo pipefail

NAME=fith
REPO="${1:-$(git remote get-url origin | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')}"

node -e 'const [a,b]=process.argv[1].split(".").map(Number); if (a<11||(a===11&&b<15)) { console.error("npm >= 11.15 needed for npm trust: npm install -g npm@^11.15.0"); process.exit(1) }' "$(npm --version)"
npm whoami >/dev/null || { echo "run npm login first" >&2; exit 1; }

if npm view "$NAME" name >/dev/null 2>&1; then
  echo "⏭️  $NAME already exists"
else
  dir="$(mktemp -d)"
  cat > "$dir/package.json" <<JSON
{
  "name": "$NAME",
  "version": "0.0.0",
  "description": "Placeholder. Real releases of fith are published by CI.",
  "homepage": "https://github.com/$REPO",
  "repository": { "type": "git", "url": "git+https://github.com/$REPO.git" },
  "license": "MPL-2.0"
}
JSON
  printf '# %s\n\nPlaceholder; real releases are published from https://github.com/%s.\n' "$NAME" "$REPO" > "$dir/README.md"
  echo "📦 publishing the $NAME placeholder"
  (cd "$dir" && npm publish --access public --tag placeholder)
  rm -rf "$dir"
fi

if npm trust list "$NAME" 2>/dev/null | grep -q "release.yml"; then
  echo "⏭️  $NAME already has a trusted publisher for release.yml"
else
  echo "🔐 trusting $REPO release.yml (environment production) to publish $NAME"
  npm trust github "$NAME" --repository "$REPO" --file release.yml --environment production --allow-publish --yes
fi
npm trust list "$NAME"

echo "🔒 $NAME: require 2FA, disallow tokens"
npm access set mfa=publish "$NAME"

echo "✅ $NAME exists, trusts $REPO release.yml and refuses tokens; push a v* tag to release"
