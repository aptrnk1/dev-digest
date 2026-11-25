#!/usr/bin/env bash
#
# Make a fresh git worktree runnable without reinstalling: symlink each
# package's node_modules from the main checkout.
#
#   ./scripts/worktree-bootstrap.sh <worktree-path>   # one worktree
#   ./scripts/worktree-bootstrap.sh --all             # every worktree under .claude/worktrees/
#
# Idempotent: an existing node_modules (real dir or link) is left alone.
# The links are untracked (node_modules/ is gitignored) and never committed.
# Run it before dispatching a parallel wave, so workers don't each spend turns
# rediscovering missing deps (reviewer-core tests import server mocks, so
# every package needs them).

set -euo pipefail

MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
PACKAGES=(server client reviewer-core e2e)

bootstrap() {
  local wt="$1"
  [ "$wt" = "$MAIN" ] && return 0
  for pkg in "${PACKAGES[@]}"; do
    local src="$MAIN/$pkg/node_modules" dst="$wt/$pkg/node_modules"
    [ -d "$wt/$pkg" ] || continue
    if [ -e "$dst" ] || [ -L "$dst" ]; then continue; fi
    if [ -d "$src" ]; then
      ln -s "$src" "$dst"
      echo "linked $pkg/node_modules → $wt"
    else
      echo "! $pkg/node_modules missing in main checkout — install it there first" >&2
    fi
  done
}

case "${1:-}" in
  --all)
    for wt in "$MAIN"/.claude/worktrees/*/; do [ -d "$wt" ] && bootstrap "${wt%/}"; done ;;
  ""|-h|--help)
    sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)
    bootstrap "$(cd "$1" && pwd)" ;;
esac
