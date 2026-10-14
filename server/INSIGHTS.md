# Insights — server
<!-- Append-only, written via the engineering-insights skill
     (.claude/skills/engineering-insights/SKILL.md). Newest on top of each section.
     Entry: - YYYY-MM-DD · <ALWAYS/NEVER/do X> — <why> (<path:line | command>) -->

## What Works

## What Doesn't Work

## Codebase Patterns
- 2026-10-14 · ALWAYS default new `RunStats`/`RunTrace` fields on read (`?? null`) in `getRunTrace` — `run_traces.trace` is a jsonb snapshot, old rows lack new fields and break the zod contract (server/src/modules/reviews/repository/run.repo.ts getRunTrace)
- 2026-10-14 · Use `agent_runs.review_batch_id` to group "one Run Review click" (one id per `runReview` call); rows before 2026-10-14 have null → treat as a batch of one (server/src/modules/pulls/status.ts latestReviewCostByPr)
- 2026-10-14 · DO persist run cost from `outcome.costUsd` at completion, don't recompute tokens×price on read — it keeps OpenRouter's real `usage.cost` and the price at run time; failed/cancelled → null (server/src/modules/reviews/run-executor.ts)

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes
- 2026-10-14 · Run Cost Badge: cost_usd + review_batch_id on agent_runs, cost in RunSummary/RunStats/PrMeta (specs/run-cost-badge.md)

## Open Questions
