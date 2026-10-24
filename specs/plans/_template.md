# Plan: <Feature>

Spec: `specs/<name>.md` | inline R1–Rn · Modules: server, client, … · Execution mode: multi-agent | single-agent · Status: Draft | Approved

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

## Requirements review
- **Clarified**: <question> → <answer> (AC#/R#)
- **Recommendations**: REC1 <improvement> — accepted | rejected
- **Spec updates needed**: <what the spec owner should change, or "—"> (the planner never edits the spec)

## Risks
- <risk> — <mitigation / which task handles it>
- Manual check: AC# — <who checks, how> (for `[manual]` ACs; plan-verifier reports them as UNVERIFIABLE)

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] <title>
Owns: `server/src/vendor/shared/<x>.ts`, `client/src/vendor/shared/<x>.ts`, `server/src/db/schema/<x>.ts`, `server/src/db/migrations/<generated>`
Depends on: —
Skills: zod, drizzle-orm-patterns
Route: agent | agent:haiku | inline   (see Execution §2; default agent)
Steps:
1. <concrete step>
Acceptance:
- <observable criterion, ref AC# from spec>
Verify: `cd server && pnpm db:generate` · `scripts/check.sh server typecheck` · `scripts/check.sh client typecheck`
Escalate if: <condition that means the plan is wrong>

## Wave 1 — parallel (disjoint Owns)

### T2 [P] [BE] <title>
Owns: `server/src/modules/<name>/…`
Depends on: T1
Skills: onion-architecture, fastify-best-practices   (complete list — the implementer loads only these)
Interfaces: <exact signatures this task provides/consumes>
Steps:
1. Test: <file>.test.ts — <case> (AC#)
2. <concrete step>
Acceptance:
- AC# [unit] <criterion>
Verify: `scripts/check.sh server typecheck arch test test/<name>`
Escalate if: needs a file outside Owns

### T3 [P] [FE] <title>
Owns: `client/src/…`, `client/messages/en/<x>.json`
Depends on: T1
Skills: react-best-practices, client-testing
Interfaces: <hook/component props>
Steps:
1. …
Acceptance:
- AC# [unit] …
Verify: `scripts/check.sh client typecheck test <paths>`
Escalate if: …

## Wave 2 — integration / e2e

### T4 [BE] <integration test>
Owns: `server/test/<x>.it.test.ts`
Depends on: T2
Acceptance:
- AC# [it] …
Verify: `scripts/check.sh server it <x>.it.test.ts`

---

## Execution
Run with `/run-plan plan: specs/plans/<feature>.md` — the procedure
(dispatch, merge + gate + commit per wave, review, fix loop, finish) lives in
`.claude/skills/run-plan/references/execute.md` and `review-fix.md`.
Plan-specific notes for the orchestrator (host limits, skip-verify, ordering)
go here: —

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | todo | |
