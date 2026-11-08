# Review round 4 (after fix round 3) — Project Context

Fix base: 9ec320a · HEAD: a55b8e5
Sources: plan-verifier delta (BLOCKED_UNVERIFIABLE — env only, no regression) · /code-review high on round-3 paths (10, unverified). Fix rounds used: 3 of 3.

## Previous rows
review-1 F1–F11 fixed · review-2 N1, N2, N4–N8 fixed · review-3 R1–R9 fixed. Deferred: F12, N3, N11. Env: E1 (e2e on CI), E2 (NFR1/3/4 manual).

## New findings
| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| Q1 | code-review #1 | major (regression from R8) | `server/src/modules/reviews/run-executor.ts:242` — `runLog.error` emits SSE `error` → client `reviews.ts:199` shows "agent failure" toast with raw message for a best-effort skip | T14 | fix inline (orchestrator) | fixed |
| Q2 | code-review #2 + verifier caveat | minor | `client/src/lib/hooks/context.ts:85` — two queued saves both fail + refetch fails → rollback to earlier save's optimistic list | T6 | accepted-by-user | accepted-by-user |
| Q3 | code-review #3 | minor | `server/src/modules/context/service.ts:61` — bare catch maps every scan failure to `repo_not_cloned`, nothing logged | T7 | accepted-by-user | accepted-by-user |
| Q4 | code-review #4 | minor | `context.ts:97` — same-tick toggles both snapshot P → first optimistic entry briefly dropped (server order still serialized) | T6 | accepted-by-user | accepted-by-user |
| Q5 | code-review #5 | minor | `context.ts:119` — focus/mount/retry refetch can still clobber optimistic list mid-save | T6 | accepted-by-user | accepted-by-user |
| Q6 | code-review #6 | minor | `server/test/helpers/runs.ts:40` — no longer waits for failed/cancelled runs' traces; docstring stale | T14 | accepted-by-user | accepted-by-user |
| Q7 | code-review #7 | info | `context.ts:77` — relies on TanStack counting the settling mutation in `isMutating` | T6 | note | accepted-by-user |
| Q8 | code-review #8 | minor | `context.ts:123` — useRefreshContext(undefined) vs `null` key; other repos' attachment statuses not refreshed | T6 | accepted-by-user | accepted-by-user |
| Q9 | code-review #9 | nit | `context.ts:125` — O(queries × mutations) predicate | T6 | skip | skipped |
| Q10 | code-review #10 | nit | `context.ts:154` — optimistic toggle entry hard-codes `status: "ok"`; duplicated scaffold | T6 | skip | skipped |

## Decision
User (2026-10-24): "Fix Q1 inline, accept rest". Q1 reverted to `runLog.info` (server gate 405 + it 11/11 green). Q2–Q8 accepted-by-user → PR summary.
