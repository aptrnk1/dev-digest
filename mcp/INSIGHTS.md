# Insights — mcp
<!-- Append-only, written via the engineering-insights skill
     (.claude/skills/engineering-insights/SKILL.md). Newest on top of each section.
     Entry: - YYYY-MM-DD · <ALWAYS/NEVER/do X> — <why> (<path:line | command>) -->

## What Works

## What Doesn't Work
- 2026-10-22 · NEVER annotate `TOOL_DEFS` as `Record<…, { inputSchema: ZodRawShape }>` — it erases each tool's arg types, so adapters need casts and a renamed key compiles and passes `undefined`; use `satisfies Record<ToolName, ToolDef>` and widen only in register.ts (`src/adapters/mcp/definitions.ts`)

## Codebase Patterns

## Tool & Library Notes
- 2026-10-22 · To prove `core-contracts-type-only` actually fires, check that edges into `../server/src/vendor/shared/index.ts` show `aliased-tsconfig-paths,type-only` — without `tsPreCompilationDeps: true` + `tsConfig` the alias isn't resolved and the rule silently passes (`npx depcruise src --config .dependency-cruiser.cjs --output-type json`)
- 2026-10-22 · MCP SDK `registerTool` validates args against `inputSchema` BEFORE the handler — a wrong type returns `isError` "Invalid arguments for tool <name>" and the handler never runs; the `ZodError` branch in `toErrorResult` is only a safety net for direct calls (`test/protocol.list.test.ts`)
- 2026-10-22 · registerTool via a loose registrar cast — the SDK's generic over `ZodRawShape` raises TS2589 for non-literal shapes (`src/adapters/mcp/register.ts`)

## Recurring Errors & Fixes

## Session Notes
- 2026-10-22 · Built mcp/ (5 tools, onion rings, arch:check) from specs/plans/mcp-server.md; final review fixed a plain Error in run-review (→ RunNotStarted), erased arg types (→ satisfies) and the conventions char budget

## Open Questions
