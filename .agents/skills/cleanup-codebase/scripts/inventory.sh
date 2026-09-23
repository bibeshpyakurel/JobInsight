#!/usr/bin/env bash
# Read-only cleanup signals. Never deletes, stages, formats, or installs.
# Usage: inventory.sh [repository-root]
# Exits 0 when the report is printed. Exits 1 when the path is not a directory.

if [[ $# -gt 1 ]]; then
  echo "usage: inventory.sh [repository-root]" >&2
  exit 1
fi

root="${1:-.}"
if [[ ! -d "$root" ]]; then
  echo "inventory: not a directory: $root" >&2
  exit 1
fi

cd "$root" || exit 1
root=$(pwd)

# Patterns are assembled so this file does not match its own report.
# debug_leftovers is the proven set. console_log_calls are operator output and stay judgment.
debug_pattern="$(printf '%s%s%s' 'console\.debug\(|console\.log\([^[:cntrl:]]*[Dd]ebug|' 'debu' 'gger|dbg!|pdb\.set_trace|breakpoint\(|binding\.pry|byebug')"
console_pattern='console\.log\('
comment_pattern='^[[:space:]]*(//|#)[[:space:]]*(function[[:space:]]+[A-Za-z_]|def[[:space:]]+[A-Za-z_]|class[[:space:]]+[A-Za-z_]|fn[[:space:]]+[A-Za-z_]|func[[:space:]]+[A-Za-z_])'
todo_pattern='TODO|FIXME|HACK|XXX'

echo "# cleanup inventory"
echo "root: $root"
echo "mode: read-only"

section() {
  echo
  echo "## $1"
}

skip_tree() {
  printf '%s\n' \
    -name node_modules -o -name .git -o -name dist -o -name build \
    -o -name vendor -o -name target -o -name .venv -o -name venv \
    -o -name __pycache__ -o -name .next -o -name coverage -o -name out \
    -o -name .turbo -o -name Pods -o -name .gradle -o -name third_party
}

# Prints NUL-separated source files. Skips this script when the skill
# is installed inside the repository being scanned.
source_files0() {
  find . \
    \( $(skip_tree) \) -prune -o -type f \
    \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \
       -o -name '*.mjs' -o -name '*.cjs' -o -name '*.py' -o -name '*.go' \
       -o -name '*.rs' -o -name '*.java' -o -name '*.kt' -o -name '*.kts' \
       -o -name '*.rb' -o -name '*.php' -o -name '*.cs' -o -name '*.swift' \
       -o -name '*.ex' -o -name '*.exs' -o -name '*.vue' -o -name '*.svelte' \
       -o -name '*.sh' -o -name '*.bash' \) \
    ! -name '*.min.js' \
    ! -path '*/cleanup-codebase/scripts/inventory.sh' \
    -print0
}

count_matching_lines() {
  local pattern="$1"
  local count=0
  local file line_count
  while IFS= read -r -d '' file; do
    line_count=$(grep -I -E -c "$pattern" "$file" 2>/dev/null || true)
    count=$((count + ${line_count:-0}))
  done < <(source_files0)
  echo "$count"
}

sample_matches() {
  local pattern="$1"
  local shown=0
  local file line
  while IFS= read -r -d '' file; do
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      echo "${file}:${line}"
      shown=$((shown + 1))
      [[ $shown -ge 40 ]] && return 0
    done < <(grep -I -n -E "$pattern" "$file" 2>/dev/null || true)
  done < <(source_files0)
}

section "git"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty=$(git status --porcelain | wc -l | tr -d ' ')
  echo "dirty_paths: $dirty"
else
  echo "git: none"
fi

manifest_files0() {
  find . \
    \( $(skip_tree) \) -prune -o -type f \
    \( -name package.json -o -name pnpm-workspace.yaml -o -name go.mod -o -name go.work \
       -o -name Cargo.toml -o -name pyproject.toml -o -name setup.cfg -o -name requirements.txt \
       -o -name Pipfile -o -name Gemfile -o -name composer.json -o -name pom.xml \
       -o -name build.gradle -o -name build.gradle.kts -o -name mix.exs \
       -o -name Package.swift -o -name pubspec.yaml -o -name CMakeLists.txt \
       -o -name '*.csproj' -o -name '*.sln' \) \
    -print0
}

has_manifest() {
  local name="$1"
  find . \( $(skip_tree) \) -prune -o -type f -name "$name" -print -quit | grep -q .
}

section "manifests"
found=0
while IFS= read -r -d '' manifest; do
  echo "- ${manifest#./}"
  found=$((found + 1))
  [[ $found -ge 40 ]] && break
done < <(manifest_files0)
[[ $found -eq 0 ]] && echo "- none"
[[ $found -ge 40 ]] && echo "Stopped at 40 manifests."

section "ecosystems"
eco=0
has_manifest package.json && { echo "- javascript"; eco=1; }
{ has_manifest pyproject.toml || has_manifest requirements.txt || has_manifest setup.cfg || has_manifest Pipfile; } && { echo "- python"; eco=1; }
has_manifest go.mod && { echo "- go"; eco=1; }
has_manifest Cargo.toml && { echo "- rust"; eco=1; }
{ has_manifest pom.xml || has_manifest build.gradle || has_manifest build.gradle.kts; } && { echo "- jvm"; eco=1; }
has_manifest Gemfile && { echo "- ruby"; eco=1; }
has_manifest composer.json && { echo "- php"; eco=1; }
has_manifest mix.exs && { echo "- elixir"; eco=1; }
has_manifest Package.swift && { echo "- swift"; eco=1; }
if find . \( $(skip_tree) \) -prune -o -type f \( -name '*.csproj' -o -name '*.sln' \) -print -quit | grep -q .; then
  echo "- dotnet"
  eco=1
fi
[[ $eco -eq 0 ]] && echo "- none"

section "project commands"
command_notes=0
if [[ -f package.json ]] && command -v python3 >/dev/null 2>&1; then
  command_notes=1
  python3 - << 'PY'
import json
try:
    data = json.load(open("package.json"))
except Exception as exc:
    print(f"- package.json unreadable: {exc}")
    raise SystemExit(0)
scripts = data.get("scripts") or {}
if not scripts:
    print("- package.json scripts: none")
else:
    for name, command in scripts.items():
        print(f"- npm run {name}: {command}")
PY
elif [[ -f package.json ]]; then
  echo "- package.json present"
  command_notes=1
fi
[[ -f Makefile ]] && { echo "- Makefile present"; command_notes=1; }
[[ -f justfile || -f Justfile ]] && { echo "- justfile present"; command_notes=1; }
[[ -f pyproject.toml ]] && { echo "- pyproject.toml present (read its tool tables)"; command_notes=1; }
[[ -f Cargo.toml ]] && { echo "- Cargo.toml present"; command_notes=1; }
[[ -f go.mod ]] && { echo "- go.mod present"; command_notes=1; }
[[ $command_notes -eq 0 ]] && echo "- none"

section "signals"
todo_count=$(count_matching_lines "$todo_pattern")
debug_count=$(count_matching_lines "$debug_pattern")
console_count=$(count_matching_lines "$console_pattern")
comment_count=$(count_matching_lines "$comment_pattern")
echo "todo_fixme_hack_xxx: $todo_count"
echo "debug_leftovers: $debug_count"
echo "console_log_calls: $console_count"
echo "commented_code_candidates: $comment_count"

section "debug leftovers"
if [[ "$debug_count" -eq 0 ]]; then
  echo "- none"
else
  sample_matches "$debug_pattern"
fi

section "console.log calls"
if [[ "$console_count" -eq 0 ]]; then
  echo "- none"
else
  sample_matches "$console_pattern"
fi

section "commented-out code candidates"
if [[ "$comment_count" -eq 0 ]]; then
  echo "- none"
else
  sample_matches "$comment_pattern"
fi

section "backup files"
backup_shown=0
while IFS= read -r -d '' file; do
  echo "- ${file#./}"
  backup_shown=$((backup_shown + 1))
  [[ $backup_shown -ge 40 ]] && break
done < <(find . \
  \( -name node_modules -o -name .git -o -name dist -o -name build -o -name vendor -o -name target -o -name .venv -o -name venv \) \
  -prune -o -type f \
  \( -name '*.bak' -o -name '*.old' -o -name '*.orig' -o -name '*~' -o -name '*.tmp' \) \
  -print0)
[[ $backup_shown -eq 0 ]] && echo "- none"

section "source files over 500 lines"
large_shown=0
while IFS= read -r -d '' file; do
  lines=$(wc -l < "$file" | tr -d ' ')
  if [[ "$lines" -gt 500 ]]; then
    echo "- $lines ${file#./}"
    large_shown=$((large_shown + 1))
    [[ $large_shown -ge 20 ]] && break
  fi
done < <(source_files0)
[[ $large_shown -eq 0 ]] && echo "- none"
if [[ $large_shown -gt 0 ]]; then
  echo "Up to 20 files, in walk order. Judgment candidates, not deletions."
fi

section "next"
echo "Read references/aspects.md to classify."
echo "Read the matching ecosystem section in references/detectors.md."
echo "Read references/false-alive.md before marking anything proven."
