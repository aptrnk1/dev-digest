#!/usr/bin/env bash
# Token-lean package checks for agents and humans.
#
#   scripts/check.sh [--no-cache] [--verbose] <pkg> <step>... [vitest filters/args...]
#
#   pkg:   server | client | reviewer-core | mcp
#   steps: typecheck | arch | test | it | gate
#          test — unit tests (server: without *.it.test.ts); args after the
#                 step are passed to vitest (file filters, -t "name", ...)
#          it   — server integration tests, serial (default filter: .it.test)
#          gate — the package gate: typecheck [+ arch] + test
#   e.g.   scripts/check.sh server typecheck test test/blast-
#          scripts/check.sh client gate
#
# Output: one line per step on success (`PASS <pkg> <step> · counts`); on
# failure only the relevant lines (failing tests, assertion diffs, `error TS`)
# plus the path of the full log. Exit: 0 pass · 1 fail · 3 tests self-skipped
# (no Docker) — a skip is never a pass.
#
# Cache: a step that passed is remembered against a hash of the working tree
# (all tracked + untracked files except *.md, .claude/, specs/). Same content →
# the step is not re-run and prints `PASS … (cached …)`. The cache lives in the
# git common dir, so worktrees and the main checkout share it. Only passes are
# cached; failures and skips always re-run. --no-cache forces a fresh run
# (use it for flake checks).
# bash 3.2 compatible (macOS).

set -u

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

no_cache=0
verbose=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-cache) no_cache=1; shift ;;
    --verbose) verbose=1; shift ;;
    -h|--help) usage ;;
    *) break ;;
  esac
done
[ $# -ge 2 ] || usage

pkg=$1; shift
case "$pkg" in
  server|client|reviewer-core|mcp) ;;
  *) echo "check.sh: unknown package '$pkg'" >&2; usage ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "check.sh: not in a git repo" >&2; exit 2; }
[ -d "$root/$pkg/node_modules" ] || {
  echo "check.sh: $pkg/node_modules missing — in a worktree run ./scripts/worktree-bootstrap.sh . first" >&2
  exit 2
}

# Split args into steps and the vitest args that follow the first test/it step.
steps=""
extra=()
while [ $# -gt 0 ]; do
  case "$1" in
    typecheck|arch) steps="$steps $1"; shift ;;
    test|it) steps="$steps $1"; shift; extra=("$@"); break ;;
    gate)
      case "$pkg" in
        server|mcp) steps="$steps typecheck arch test" ;;
        *)          steps="$steps typecheck test" ;;
      esac
      shift ;;
    *) echo "check.sh: unknown step '$1'" >&2; usage ;;
  esac
done

# --- cache ------------------------------------------------------------------
cache_dir=""
tree_hash=""
if [ $no_cache -eq 0 ]; then
  common=$(cd "$root" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [ -n "$common" ] && mkdir -p "$common/devdigest-check" 2>/dev/null && [ -w "$common/devdigest-check" ]; then
    cache_dir="$common/devdigest-check"
    paths=$(mktemp "${TMPDIR:-/tmp}/check-paths.XXXXXX")
    tree_hash=$(cd "$root" && git ls-files -co --exclude-standard \
      | grep -v -E '(\.md$|^\.claude/|^specs/)' \
      | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done \
      | tee "$paths" \
      | git hash-object --stdin-paths \
      | paste -d' ' - "$paths" \
      | git hash-object --stdin)
    rm -f "$paths"
  fi
fi

cache_key() { # step → key
  printf '%s|%s|%s|%s' "$tree_hash" "$pkg" "$1" "${extra[*]:-}" | git hash-object --stdin
}

# --- run ----------------------------------------------------------------------
vitest_flags="--reporter=dot --silent"

cmd_for() { # step → shell command run inside $root/$pkg
  local args=""
  local a
  for a in ${extra[@]+"${extra[@]}"}; do args="$args '$a'"; done
  case "$pkg:$1" in
    server:typecheck|client:typecheck) echo "pnpm --silent typecheck" ;;
    reviewer-core:typecheck|mcp:typecheck) echo "npm run -s typecheck" ;;
    server:arch)  echo "pnpm --silent arch:check" ;;
    mcp:arch)     echo "npm run -s arch:check" ;;
    server:test)  echo "pnpm exec vitest run --exclude '**/*.it.test.ts' $vitest_flags$args" ;;
    server:it)    echo "pnpm exec vitest run --no-file-parallelism $vitest_flags${args:- .it.test}" ;;
    client:test)  echo "pnpm exec vitest run $vitest_flags$args" ;;
    reviewer-core:test|mcp:test) echo "npx --no-install vitest run --passWithNoTests $vitest_flags$args" ;;
    *) echo "" ;;
  esac
}

summary_for() { # step log → one-line counts
  case "$1" in
    test|it)
      grep -E '^ *(Test Files|Tests) ' "$2" | sed -E 's/^ *//; s/ +/ /g; s/ \([0-9]+\)$//' | paste -sd',' - | sed 's/,/, /' ;;
    arch)
      grep -m1 -E 'no dependency violations|violations? found' "$2" | sed -E 's/^[^a-zA-Z0-9]*//' ;;
    *) echo "" ;;
  esac
}

failure_excerpt() { # step log
  case "$1" in
    typecheck)
      local n
      n=$(grep -c 'error TS' "$2")
      grep 'error TS' "$2" | head -25
      [ "$n" -gt 25 ] && echo "… $n TS errors total" ;;
    arch)
      grep -v -E '^\s*$' "$2" | head -40 ;;
    test|it)
      grep -E 'FAIL|×|✗|AssertionError|Error:|Expected|Received|expected|❯ .*:[0-9]+:[0-9]+|^ *[-+] |Test Files|Tests ' "$2" \
        | grep -v -E 'node_modules|npm notice' | head -60 ;;
  esac
}

status=0
for step in $steps; do
  cmd=$(cmd_for "$step")
  if [ -z "$cmd" ]; then
    echo "SKIP $pkg $step — not available for $pkg"
    continue
  fi
  key=""
  if [ -n "$cache_dir" ]; then
    key=$(cache_key "$step")
    if [ -f "$cache_dir/$key" ]; then
      echo "PASS $pkg $step (cached $(sed -n 1p "$cache_dir/$key"))$(sed -n '2{/./s/^/ · /p;}' "$cache_dir/$key")"
      continue
    fi
  fi
  log=$(mktemp "${TMPDIR:-/tmp}/check-$pkg-$step.XXXXXX")
  start=$(date +%s)
  (cd "$root/$pkg" && eval "$cmd") >"$log" 2>&1
  code=$?
  secs=$(( $(date +%s) - start ))
  sum=$(summary_for "$step" "$log")
  if [ $code -eq 0 ] && { [ "$step" = test ] || [ "$step" = it ]; } \
     && ! grep -q -E '^ *Tests .*passed' "$log" && grep -q -E '^ *Tests .*skipped' "$log"; then
    echo "SKIP $pkg $step (${secs}s) · $sum — tests self-skipped (Docker unavailable?); not a pass · log: $log"
    [ $status -eq 0 ] && status=3
    continue
  fi
  if [ $code -eq 0 ]; then
    echo "PASS $pkg $step (${secs}s)${sum:+ · $sum}"
    [ -n "$key" ] && printf '%s\n%s\n' "$(date '+%Y-%m-%d %H:%M')" "$sum" >"$cache_dir/$key"
    [ $verbose -eq 1 ] && cat "$log"
    rm -f "$log"
  else
    echo "FAIL $pkg $step (exit $code, ${secs}s) · full log: $log"
    if [ $verbose -eq 1 ]; then cat "$log"; else failure_excerpt "$step" "$log"; fi
    status=1
  fi
done
exit $status
