# Plan: <Feature>

Spec: `specs/<name>.md` · Modules: server, client, … · Status: Draft | Approved

## Goal
<one sentence: what the user can do after this ships>

## Architecture
<2–4 sentences: how the change flows through the modules (route → service →
repository; hook → api.ts; reviewer-core entry point), and what stays as is>

## Cross-task decisions
- **Contracts** (both `vendor/shared` copies): <schema name> — <exact fields/types>
- **Data**: <table/column changes in `server/src/db/schema/…`; migration via `pnpm db:generate`>
- **Interfaces**:
  - `GET /…` → `<ResponseSchema>`
  - `service.method(args): ReturnType`
  - `useThing(id): UseQueryResult<Thing>`
- **Constraints**: <exact values from the spec — limits, formats, null handling>

## Risks
- <risk> — <mitigation / which task handles it>

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] <title>
Owns: `server/src/vendor/shared/<x>.ts`, `client/src/vendor/shared/<x>.ts`, `server/src/db/schema/<x>.ts`, `server/src/db/migrations/<generated>`
Depends on: —
Skills: zod, drizzle-orm-patterns
Steps:
1. <concrete step>
Acceptance:
- <observable criterion, ref AC# from spec>
Verify: `cd server && pnpm typecheck && pnpm db:generate` · `cd client && pnpm typecheck`
Escalate if: <condition that means the plan is wrong>

## Wave 1 — parallel (disjoint Owns)

### T2 [P] [BE] <title>
Owns: `server/src/modules/<name>/…`
Depends on: T1
Skills: onion-architecture, fastify-best-practices, zod, drizzle-orm-patterns
Interfaces: <exact signatures this task provides/consumes>
Steps:
1. Test: <file>.test.ts — <case>
2. <concrete step>
Acceptance:
- <criterion, AC#>
Verify: `cd server && pnpm typecheck && pnpm exec vitest run src/modules/<name> --exclude '**/*.it.test.ts' && pnpm arch:check`
Escalate if: needs a file outside Owns

### T3 [P] [FE] <title>
Owns: `client/src/…`, `client/messages/en/<x>.json`
Depends on: T1
Skills: next-best-practices, react-best-practices, react-testing-library
Interfaces: <hook/component props>
Steps:
1. …
Acceptance:
- …
Verify: `cd client && pnpm typecheck && pnpm exec vitest run <paths>`
Escalate if: …

## Wave 2 — integration / e2e

### T4 [BE] <integration test>
Owns: `server/test/<x>.it.test.ts`
Depends on: T2
Verify: `cd server && pnpm exec vitest run <x>.it.test.ts`

---

## Execution (for the orchestrator)
1. Run each wave's tasks with the `implementer` agent, one task per agent.
   Delegation message: `plan: specs/plans/<feature>.md` · `task: T<n>` (+
   interfaces reported by earlier tasks). Parallel `[P]` tasks run with
   `isolation: "worktree"` passed in the Agent call; wave 0 runs in the main
   checkout.
2. Worktrees branch from the default branch, not from the current HEAD —
   commit the plan and wave 0 (and merge the previous wave) before starting
   a parallel wave, or the workers won't see them.
3. Merge worktree results one at a time; a merge conflict means two tasks were
   not independent — fix the plan, not the code. Update `## Progress` from
   the workers' reports (workers never edit the plan).
4. Any `NEEDS_CONTEXT` / `BLOCKED` → resolve (update the plan or the task)
   before the next wave. Never re-dispatch an unchanged task.
5. Final verify:
   - `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`
   - `cd server && pnpm exec vitest run .it.test` (Docker)
   - `cd client && pnpm typecheck && pnpm test`
   - `cd reviewer-core && npm run typecheck && npm test` (if touched)
   - `cd e2e && npm run e2e:hermetic` (if flows changed)
6. `/pr-self-review`, then record "Insight candidates" from the reports with
   `engineering-insights`.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | todo | |
