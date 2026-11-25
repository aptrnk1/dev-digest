#!/usr/bin/env bash
# PreToolUse guard for the `test-writer` subagent (matcher: Write|Edit).
# Allows writes only to test files, test helpers/fixtures and e2e flows.
# Reads the hook JSON from stdin, takes tool_input.file_path (absolute or
# relative), normalises it to a repo-relative path and exits:
#   0 — allowed;  2 — blocked (reason on stderr, shown to the agent).
# bash 3.2 compatible (macOS); jq optional, python3 fallback.

input=$(cat)

json_get() { # $1 = jq path, $2 = python key path (dot separated)
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    for k in sys.argv[1].split("."):
        d = d.get(k) if isinstance(d, dict) else None
    print(d if isinstance(d, str) else "")
except Exception:
    print("")
' "$2" 2>/dev/null
  else
    # last resort: naive regex on the raw JSON
    key=${2##*.}
    printf '%s' "$input" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
  fi
}

block() {
  echo "test-writer-guard: blocked write to '$1' — $2" >&2
  echo "test-writer may only create/edit test files (*.test.ts, *.test.tsx, *.it.test.ts), server/test/**, reviewer-core/test/**, mcp/test/**, client/src/**/__fixtures__/** and e2e/specs/**. Report production-code problems under 'Suspected production bugs' instead." >&2
  exit 2
}

file_path=$(json_get '.tool_input.file_path' 'tool_input.file_path')
hook_cwd=$(json_get '.cwd' 'cwd')

[ -n "$file_path" ] || block "<unknown>" "could not read tool_input.file_path from the hook input"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# strip_prefix PATH PREFIX — case-insensitive (macOS FS), prints the rest or nothing
strip_prefix() {
  p=$1; pre=${2%/}
  [ -n "$pre" ] || return 1
  lp=$(lower "$p"); lpre=$(lower "$pre")
  case "$lp" in
    "$lpre"/*) printf '%s' "${p:$((${#pre} + 1))}"; return 0 ;;
  esac
  return 1
}

rel=$file_path
case "$rel" in
  /*)
    stripped=""
    for root in "$CLAUDE_PROJECT_DIR" "$hook_cwd" "$PWD"; do
      if r=$(strip_prefix "$rel" "$root"); then stripped=$r; break; fi
    done
    [ -n "$stripped" ] || block "$file_path" "path is outside the project directory"
    rel=$stripped
    ;;
esac

# normalise: drop leading ./ and a worktree prefix (.claude/worktrees/<name>/)
while :; do
  case "$rel" in
    ./*) rel=${rel#./} ;;
    *) break ;;
  esac
done
case "$rel" in
  .claude/worktrees/*/*) rel=${rel#.claude/worktrees/*/} ;;
esac

case "/$rel/" in
  */../*) block "$file_path" "parent-directory segments ('..') are not allowed" ;;
esac

case "$rel" in
  *.test.ts|*.test.tsx) exit 0 ;;                       # incl. *.it.test.ts
  server/test/*|reviewer-core/test/*|mcp/test/*) exit 0 ;;   # helpers, fixtures
  client/src/__fixtures__/*|client/src/*/__fixtures__/*) exit 0 ;;
  e2e/specs/*) exit 0 ;;                                 # flow JSON
esac

block "$file_path" "not a test file, test helper or fixture"
