# Insights — client
<!-- Append-only, written via the engineering-insights skill
     (.claude/skills/engineering-insights/SKILL.md). Newest on top of each section.
     Entry: - YYYY-MM-DD · <ALWAYS/NEVER/do X> — <why> (<path:line | command>) -->

## What Works

## What Doesn't Work

## Codebase Patterns
- 2026-10-15 · ALWAYS iterate severities from the zod contract (`CRITICAL | WARNING | SUGGESTION`), NEVER from `SEV`/`Severity` in vendor/ui — the UI tokens (and `SEVERITY_ORDER`, `SEV_COLOR`) also carry `INFO`, which the API never returns, so a loop over `SEV` renders a phantom 4th level (client/src/vendor/shared/contracts/findings.ts:11 vs client/src/vendor/ui/primitives/tokens.ts:3)
- 2026-10-15 · Use `Chip` for toggle filters — it now sets `aria-pressed` (+ optional `disabled`), so test active state with `getByRole("button", { name })` + `toHaveAttribute("aria-pressed", "true")` instead of inspecting styles (client/src/vendor/ui/primitives/Chip.tsx)
- 2026-10-14 · ALWAYS format USD/token counts via `@/lib/format-cost` (`formatCost`, `formatTokenCount`) or `@/components/run-cost-badge` — one rule for all screens, unknown cost is "—", never "$0.00" (client/src/lib/format-cost.ts)

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes
- 2026-10-15 · Added per-run severity counters/filter to FindingsPanel (SeverityCounters chips, `severityCounts` helper)

## Open Questions
