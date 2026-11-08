#!/usr/bin/env bash
# PreToolUse guard for the `spec-creator` subagent (matcher: Write|Edit|MultiEdit).
# Allowed targets (relative to the repo root):
#   specs/<file>.md  and  <module>/specs/<file>.md, module ∈ server|client|reviewer-core|mcp
# Never: specs/plans/**, e2e/specs/**, README.md, _template.md, subdirectories.
# Rules:
#   Write — only a dated spec name YYYY-MM-DD-<slug>.md; an existing file may be
#           overwritten only while its Status line says "draft".
#   Edit  — any spec in an allowed folder while it is a draft; a non-draft spec
#           (approved / implemented / legacy) may only get its Status line
#           changed (old_string is a single "Status:" / "Статус:" line) — used
#           to mark it "superseded by …".
# Input: hook JSON on stdin. Exit 0 = allow; exit 2 = block (stderr → agent).
# bash 3.2 compatible (macOS). Needs jq or python3 to read the JSON.

input=$(cat)

json_get() { # $1 = jq filter
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for k in sys.argv[1].lstrip(".").split("."):
    d = d.get(k) if isinstance(d, dict) else None
print("" if d is None else d)' "$1" 2>/dev/null
  fi
}

tool_name=$(json_get '.tool_name')
file_path=$(json_get '.tool_input.file_path')
old_string=$(json_get '.tool_input.old_string')

block() {
  echo "spec-creator-guard: blocked $tool_name to '$file_path' — $1. spec-creator may only create specs/YYYY-MM-DD-<slug>.md or <module>/specs/YYYY-MM-DD-<slug>.md (module: server, client, reviewer-core, mcp), edit its own drafts, and change the Status line of a spec it supersedes." >&2
  exit 2
}

[ -n "$file_path" ] || block "could not read tool_input.file_path (jq/python3 missing?)"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Strip the project-root prefix (case-insensitive: macOS paths).
rel="$file_path"
for root in "${CLAUDE_PROJECT_DIR:-}" "$PWD"; do
  [ -n "$root" ] || continue
  root="${root%/}/"
  n=${#root}
  if [ "$(lower "${rel:0:$n}")" = "$(lower "$root")" ]; then
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

# Folder: specs/ or <module>/specs/, file directly inside (no subdirectories).
case "$lrel" in
  specs/*/*) block "subdirectories of specs/ (plans, assets, …) are off-limits" ;;
  specs/*) name="${lrel#specs/}" ;;
  server/specs/*/*|client/specs/*/*|reviewer-core/specs/*/*|mcp/specs/*/*)
    block "subdirectories of <module>/specs/ are off-limits" ;;
  server/specs/*|client/specs/*|reviewer-core/specs/*|mcp/specs/*)
    name="${lrel#*/specs/}" ;;
  e2e/specs/*) block "e2e/specs/ holds e2e flow JSON, not specs" ;;
  *) block "not a spec folder" ;;
esac

case "$name" in
  readme.md|_template.md) block "README.md and _template.md are maintained by humans" ;;
  *.md) ;;
  *) block "only .md spec files may be written" ;;
esac

# Status of the file on disk (empty when the file does not exist yet).
abs="$rel"
[ -n "${CLAUDE_PROJECT_DIR:-}" ] && abs="${CLAUDE_PROJECT_DIR%/}/$rel"
status=""
if [ -f "$abs" ]; then
  status=$(grep -m1 -iE '^(status|статус)[[:space:]]*:' "$abs" | tr '[:upper:]' '[:lower:]')
  [ -n "$status" ] || status="(none)"
fi
is_draft=0
case "$status" in *draft*) is_draft=1 ;; esac

case "$tool_name" in
  Write)
    printf '%s' "$name" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$' \
      || block "a new spec must be named YYYY-MM-DD-<kebab-slug>.md"
    if [ -n "$status" ] && [ "$is_draft" -ne 1 ]; then
      block "the file exists and is not a draft (Status: ${status#*:}); create a new spec that supersedes it"
    fi
    ;;
  Edit|MultiEdit)
    [ -n "$status" ] || block "the file does not exist; create it with Write"
    if [ "$is_draft" -ne 1 ]; then
      [ "$tool_name" = "Edit" ] || block "a non-draft spec may only get its Status line changed (single Edit)"
      lines=$(printf '%s\n' "$old_string" | grep -c '')
      if [ "$lines" -ne 1 ] || ! printf '%s' "$old_string" | grep -iEq '^(status|статус)[[:space:]]*:'; then
        block "the spec is not a draft (Status: ${status#*:}); only its Status line may change (to mark it superseded)"
      fi
    fi
    ;;
  *) block "unexpected tool" ;;
esac

exit 0
