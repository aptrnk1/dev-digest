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
Route: agent | agent:haiku | inline   (see Execution §2; default agent)
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
Goal: every check below still runs; tokens are saved by not repeating work.

**Dispatch**
1. One `implementer` per task. Delegation message, in this order (the shared
   part first and byte-identical across a wave, so parallel workers hit the
   prompt cache; the task-specific part last):
   ```
   plan: specs/plans/<feature>.md
   <wave notes: interfaces from earlier tasks, branch to ff-merge, known host limits>
   report: specs/plans/reports/<feature>/T<n>.md
   commit: yes            # worktree runs only
   skip-verify: <cmd> — <reason>   # only if a Verify command can't run here
   task: T<n>
   ```
   Pass only interfaces later tasks consume — not whole earlier reports.
2. Per task pick the cheapest route that keeps its Verify:
   | Task shape | Route |
   |---|---|
   | ≤ ~10 lines in one `Owns`, no design (flow JSON, copy, a constant) | orchestrator does it inline + runs Verify |
   | mechanical: wording, renames, fixture tweaks, follow-up fixes with an exact list | `implementer` with `model: "haiku"` |
   | real logic, security, cross-layer | `implementer` (default `sonnet`) |
3. `isolation: "worktree"` only for `[P]` tasks that are big enough to gain
   from parallelism; a small or lone task runs in the main checkout.
   Worktrees branch from the default branch — commit the plan and merge the
   previous wave first, and name the branch in the wave notes
   (`git merge --ff-only <branch>`). Right after the Agent calls return, run
   `./scripts/worktree-bootstrap.sh --all` (symlinks `node_modules`).
4. Never dispatch a task whose result is known in advance: a Verify command
   documented as host-broken in a module `INSIGHTS.md` goes into
   `skip-verify`.

**Merge**
5. Merge worktree results one at a time; a conflict means the tasks were not
   independent — fix the plan, not the code. After each merge run the
   affected package gates once (filtered: `2>&1 | grep -E 'Tests |FAIL|error TS'`)
   and append the result to `specs/plans/reports/<feature>/verify-<sha>.md`
   (command · exit · counts). Reviewers reuse this log instead of re-running.
6. Update the Progress table from the short reports (workers never edit the
   plan). `NEEDS_CONTEXT` / `BLOCKED` → resolve before the next wave; never
   re-dispatch an unchanged task.
7. Follow-up fixes go to the **same** implementer via `SendMessage` (its
   context is warm and cached), with an exact list of findings. A new agent
   only if the original is gone.

**Review**
8. Between waves — only when a later wave consumes this wave's interfaces —
   run a single `architecture-reviewer` with `model: "sonnet"` on the wave's
   range. Otherwise skip the mid-wave review.
9. Final round, in parallel: `architecture-reviewer` (default `opus`) and
   `plan-verifier` with `evidence: …/verify-<sha>.md`. A second round after
   fixes is always delta: reviewer gets `previous: <finding ids>` +
   `scope: diff <fix-base>..HEAD`; verifier gets
   `previous: <report path>` + `since: <sha>`.

**Final verify** (record in `verify-<sha>.md`)
   - `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`
   - `cd server && pnpm exec vitest run .it.test --no-file-parallelism` (Docker; parallel container starts fail on this host)
   - `cd client && pnpm typecheck && pnpm test`
   - `cd reviewer-core && npm run typecheck && npm test` (if touched)
   - `cd e2e && npm run e2e:hermetic` (if flows changed and the host can run it — see `e2e/INSIGHTS.md`)
10. `/pr-self-review`, then record "Insight candidates" from the report files
    with `engineering-insights`.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | todo | |
