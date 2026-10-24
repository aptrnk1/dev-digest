# Insights — server
<!-- Append-only, written via the engineering-insights skill
     (.claude/skills/engineering-insights/SKILL.md). Newest on top of each section.
     Entry: - YYYY-MM-DD · <ALWAYS/NEVER/do X> — <why> (<path:line | command>) -->

## What Works

## What Doesn't Work
- 2026-10-24 · NEVER log a best-effort enrichment failure in run-executor with `runLog.error` — error lines go out as SSE `error` events and the client shows an "agent failure" toast for a run that succeeded; use `runLog.info` (server/src/modules/reviews/run-executor.ts Project context catch · client/src/lib/hooks/reviews.ts)
- 2026-10-24 · NEVER test path containment with `relative(root, p).startsWith('..')` — a legit root file `..notes.md` counts as outside; check `rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)` (server/src/modules/context/fs-scanner.ts within())

## Codebase Patterns
- 2026-10-24 · ALWAYS wait for the `run_traces` row, not only a terminal `agent_runs.status`, before a test reads a trace — the executor marks the run done before saveRunTrace, so trace reads right after flake (~1 in 3) (server/test/helpers/runs.ts waitForPrRuns)
- 2026-10-23 · DON'T expect `getBlastRadius` callers to be capped per symbol — `MAX_CALLERS_PER_SYMBOL` (20) is one global `slice` after the rank sort, so on a big PR a low-ranked symbol can show fewer (or zero) callers than it has; fix it in repo-intel, not in a consumer mapper (server/src/modules/repo-intel/service.ts:386)
- 2026-10-23 · ALWAYS type a pure mapper's input from another module's read model as `Pick<…>` of the fields it reads (e.g. `BlastIndexView = Pick<IndexState, …>`) — fallback/error paths can then build a typed literal instead of `{…} as IndexState`, which hides missing required fields (server/src/modules/blast/helpers.ts)
- 2026-10-23 · Expect 422 (`validation_error`), not 400, for bad route params such as a non-uuid `:id` — the app-wide zod validation handler maps every schema failure to 422; write plans/tests against 422 (server/src/app.ts:115)
- 2026-10-22 · ALWAYS seed `pr_files.patch` in GitHub's hunks-only format (no `---`/`+++` headers) and derive additions/deletions from it — the client parser treats every `+`/`-` line as a change, so headers render as fake lines and enter smart-diff's first-5-lines content scan; seeded finding lines depend on the `@@` arithmetic (`src/db/seed.ts` `SEED_PR_FILES` + `patchStats`)
- 2026-10-14 · ALWAYS default new `RunStats`/`RunTrace` fields on read (`?? null`) in `getRunTrace` — `run_traces.trace` is a jsonb snapshot, old rows lack new fields and break the zod contract (server/src/modules/reviews/repository/run.repo.ts getRunTrace)
- 2026-10-14 · Use `agent_runs.review_batch_id` to group "one Run Review click" (one id per `runReview` call); rows before 2026-10-14 have null → treat as a batch of one (server/src/modules/pulls/status.ts latestReviewCostByPr)
- 2026-10-14 · DO persist run cost from `outcome.costUsd` at completion, don't recompute tokens×price on read — it keeps OpenRouter's real `usage.cost` and the price at run time; failed/cancelled → null (server/src/modules/reviews/run-executor.ts)

## Tool & Library Notes
- 2026-10-22 · NEVER read a `.it.test` run that reports all tests skipped as green — inside the Claude Code sandbox testcontainers can't reach Docker and the suites skip; check the skipped count, rerun with the sandbox disabled (`pnpm exec vitest run .it.test --no-file-parallelism`)
- 2026-10-19 · `pnpm db:generate` blocks on an interactive "created or renamed?" prompt for every new column when the same table also drops one — non-TTY runs hang; drive it through a pty and answer Enter (= create), or split the drop into its own migration (server/src/db/migrations/0013_slim_gideon.sql)
- 2026-10-18 · NEVER add `'types'` to dependency-cruiser `conditionNames` together with a `\.d\.ts$` exclude — npm deps (drizzle-orm) resolve to `.d.ts`, get excluded, and `forbidden` rules on them silently never fire; probe a rule with a deliberate violation before trusting it (server/.dependency-cruiser.cjs)

## Recurring Errors & Fixes
- 2026-10-24 · `scripts/check.sh server arch` run inside `.claude/worktrees/agent-*` reports the 5 legacy `drizzle-only-in-repositories` errors again (symlinked node_modules → paths don't match the baseline); re-run arch in the main checkout before treating it as a failure (scripts/check.sh server arch)
- 2026-10-23 · supersedes 2026-10-18 arch:check entry — `pnpm arch:check` now exits 0 with "no dependency violations found" and "36 known violations ignored"; gate on "no new violations", never on a baseline count (cd server && pnpm arch:check)
- 2026-10-18 · `pnpm arch:check` reports 5 `drizzle-only-in-repositories` errors in legacy routes (workspace/settings/pulls/polling) that are NOT new — the baseline pins `drizzle-orm@0.38.4` paths and the S7 bump moved it to 0.45.4; re-run `pnpm arch:baseline` after a dep bump (only for this path drift) instead of chasing them (server/.dependency-cruiser-known-violations.json)

## Session Notes
- 2026-10-23 · L04 Blast Radius: modules/blast (one repoIntel.getBlastRadius + getIndexState → BlastRadiusResponse, degraded reasons derived from flag/index state), seed index rows for #482, Overview BlastRadiusCard, MCP get_blast_radius over the route (specs/plans/blast-radius.md)
- 2026-10-19 · L02 Conventions: modules/conventions (code-only sampling → one ConventionExtraction call → verifyEvidence gate), convention_scans, skills accept `source: extracted` + evidence_files (specs/conventions.md)
- 2026-10-18 · L02 Skills: modules/skills (CRUD + versions + zip/md import preview), agent_skills.enabled, enabled skills → prompt + skills_detail/block_tokens in trace (specs/skills.md)
- 2026-10-14 · Run Cost Badge: cost_usd + review_batch_id on agent_runs, cost in RunSummary/RunStats/PrMeta (specs/run-cost-badge.md)

## Open Questions
