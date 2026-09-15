#!/usr/bin/env bash
# Turn the conventional commits between the previous tag and this one into
# grouped Markdown release notes.
set -euo pipefail

TAG="${1:?tag required}"
PREV=$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || true)

if [ -n "$PREV" ]; then
  RANGE="${PREV}..${TAG}"
  echo "Changes since **${PREV}**."
else
  RANGE="$TAG"
  echo "First tagged release. Everything below is the history leading up to **${TAG}**."
fi
echo ""

emit() { # <heading> <type-regex>
  local heading="$1" types="$2" body
  body=$(git log --no-merges --format='%s|%h' "$RANGE" \
         | grep -E "^(${types})(\([a-z0-9._/-]+\))?!?: " || true)
  [ -z "$body" ] && return 0
  echo "### ${heading}"
  echo ""
  while IFS='|' read -r subject sha; do
    # strip the type prefix; keep any scope as a bold lead-in
    text=$(echo "$subject" | sed -E 's/^[a-z]+(\([a-z0-9._\/-]+\))?!?: //')
    scope=$(echo "$subject" | sed -nE 's/^[a-z]+\(([a-z0-9._\/-]+)\)!?: .*/\1/p')
    if [ -n "$scope" ]; then
      echo "- **${scope}**: ${text} (\`${sha}\`)"
    else
      echo "- ${text} (\`${sha}\`)"
    fi
  done <<< "$body"
  echo ""
}

breaking=$(git log --no-merges --format='%s|%h' "$RANGE" | grep -E '^[a-z]+(\([a-z0-9._/-]+\))?!: ' || true)
if [ -n "$breaking" ]; then
  echo "### Breaking changes"
  echo ""
  while IFS='|' read -r subject sha; do
    echo "- ${subject} (\`${sha}\`)"
  done <<< "$breaking"
  echo ""
fi

emit "Features"       "feat"
emit "Fixes"          "fix"
emit "Performance"    "perf"
emit "Documentation"  "docs"
emit "Build and CI"   "build|ci"
emit "Internal"       "refactor|test|chore|style|revert"

echo "---"
echo ""
echo "_Notes generated from Conventional Commits by \`scripts/build-release-notes.sh\`._"
