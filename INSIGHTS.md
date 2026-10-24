# Insights — cross-package
<!-- Append-only, written via the engineering-insights skill
     (.claude/skills/engineering-insights/SKILL.md). Newest on top of each section.
     Entry: - YYYY-MM-DD · <ALWAYS/NEVER/do X> — <why> (<path:line | command>) -->

## What Works
- 2026-10-24 · When a spec fixes a list "exactly" (рівно), pin it with a unit test in the task that owns the constant — implementers otherwise add "helpful" extras unnoticed (AC56 manifest/lock lists drifted; server/test/onboarding-domain.test.ts)

## What Doesn't Work
- 2026-10-24 · NEVER treat plan-verifier DONE on UI-state or budget ACs as final — in Onboarding Tour it passed AC25/AC35/AC76/AC78, and /code-review high reading whole files later found each deviating from the AC text; run one whole-file review before the fix loop, not only delta reviews (specs/plans/reports/2026-10-24-onboarding-tour/review-3.md)

## Codebase Patterns

## Tool & Library Notes
- 2026-10-19 · Running ANY `pnpm <script>` in server/ or client/ first re-syncs node_modules to the committed pnpm-lock.yaml — locally bumped deps get downgraded (next 15.5.28→15.5.19, drizzle-orm 0.45→0.38, simple-git 4→3); a still-running `next dev` (old version in memory) then regenerates `.next/types` that fail `pnpm typecheck` (`Cannot find name 'LayoutProps'`) — restart dev after such a run, and expect arch:check baseline paths to shift with the drizzle version (server/.dependency-cruiser-known-violations.json)
- 2026-10-18 · NEVER match a Claude Code PreToolUse Bash hook on a plain substring of `tool_input.command` — `echo`, `grep`, heredocs and JSON strings that merely mention `gh pr create` get blocked too (and the whole command with them). Match only a real invocation at a shell-segment start (`^`, `;`, `&&`, `|`, `(`, `$(`, newline, optional `VAR=x` prefixes) (.claude/skills/pr-self-review/scripts/gate.mjs)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
