# Insights — client
<!-- Append-only, written via the engineering-insights skill
     (.claude/skills/engineering-insights/SKILL.md). Newest on top of each section.
     Entry: - YYYY-MM-DD · <ALWAYS/NEVER/do X> — <why> (<path:line | command>) -->

## What Works

## What Doesn't Work

## Codebase Patterns
- 2026-10-14 · ALWAYS format USD/token counts via `@/lib/format-cost` (`formatCost`, `formatTokenCount`) or `@/components/run-cost-badge` — one rule for all screens, unknown cost is "—", never "$0.00" (client/src/lib/format-cost.ts)

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
