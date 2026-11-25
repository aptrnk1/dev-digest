#!/usr/bin/env bash
# PreToolUse guard for the `doc-writer` subagent (matcher: Write|Edit|MultiEdit).
# Allows writes only to Markdown files inside the project, and never to:
#   **/CLAUDE.md, **/INSIGHTS.md, specs/plans/**, docs/agent-prompts/**,
#   docs/features/** (sdd layout), e2e/specs/** (flow JSON only),
#   .claude/** (except .claude/agents/README.md).
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
  echo "doc-writer-guard: blocked write to '$file_path' — $1. doc-writer may only write Markdown docs (README.md, <module>/docs/**, specs/*.md, docs/**, .claude/agents/README.md); put anything else into the report as a suggestion." >&2
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
  *.md) ;;
  *) block "only .md files may be written" ;;
esac

case "$lrel" in
  claude.md|*/claude.md)       block "CLAUDE.md files are maintained by humans (suggest changes in the report)" ;;
  insights.md|*/insights.md)   block "INSIGHTS.md is append-only via the engineering-insights skill (report Insight candidates instead)" ;;
  specs/plans/*)               block "plans in specs/plans/ belong to implementation-planner/orchestrator" ;;
  docs/agent-prompts/*)        block "built-in agent prompts are edited by humans only (see docs/agent-prompts/README.md)" ;;
  docs/features/*)             block "docs/features/ is the sdd layout, not used in this project" ;;
  e2e/specs/*)                 block "e2e/specs/ holds only flow JSON" ;;
  .claude/agents/readme.md)    ;;
  .claude/*)                   block "agent/skill definitions under .claude/ are not documentation" ;;
esac

exit 0
