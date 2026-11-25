#!/usr/bin/env bash
# PreToolUse guard for the `implementation-planner` subagent
# (matcher: Write|Edit|MultiEdit).
# Allows writes only to a plan file: specs/plans/<name>.md (top level, not
# _template.md, not reports/**). Specs, docs and code are always blocked —
# the planner reviews requirements, it never authors them.
# Input: hook JSON on stdin; reads tool_input.file_path (absolute or relative).
# Exit 0 = allow; exit 2 = block (reason on stderr is shown to the agent).
# POSIX-ish, bash 3.2 compatible (macOS). Uses jq when present, sed otherwise.

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  file_path=$(printf '%s' "$input" | tr -d '\n' \
    | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi

block() {
  echo "implementation-planner-guard: blocked write to '$file_path' — $1. implementation-planner may only write specs/plans/<feature>.md; spec changes go into the plan's 'Spec updates needed' list for the spec owner." >&2
  exit 2
}

[ -n "$file_path" ] || block "could not read tool_input.file_path"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Strip a project-root prefix (CLAUDE_PROJECT_DIR, then cwd). macOS paths are
# case-insensitive, so compare prefixes case-insensitively.
rel="$file_path"
for root in "${CLAUDE_PROJECT_DIR:-}" "$PWD"; do
  [ -n "$root" ] || continue
  root="${root%/}/"
  n=${#root}
  head_part="${rel:0:$n}"
  if [ "$(lower "$head_part")" = "$(lower "$root")" ]; then
    rel="${rel:$n}"
    break
  fi
done
while [ "${rel#./}" != "$rel" ]; do rel="${rel#./}"; done

case "$rel" in
  /*) block "path is outside the project" ;;
  ../*|*/../*|*/..|..) block "path traversal ('..') is not allowed" ;;
esac

lrel=$(lower "$rel")

case "$lrel" in
  specs/plans/_template.md) block "the plan template is maintained by humans" ;;
  specs/plans/*/*)          block "subdirectories of specs/plans/ (reports) belong to implementers/orchestrator" ;;
  specs/plans/*.md)         exit 0 ;;
  specs/*|*/specs/*)        block "specs are not written or edited by the planner" ;;
  *)                        block "only plan files are writable" ;;
esac
