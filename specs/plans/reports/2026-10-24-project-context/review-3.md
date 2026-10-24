# Review round 3 — Project Context

Fix base: 31c6bc9 · HEAD: 9ec320a
Sources: architecture-reviewer delta (APPROVE, 0) · plan-verifier delta (BLOCKED_UNVERIFIABLE — env only; full `server it` 469/469, gates green) · /code-review high on round-2 paths (10, unverified)

## Previous rows
review-1: F1–F11 fixed · F12 deferred · F13/F14 skipped · E1/E2 env.
review-2: N1, N2, N4–N8 fixed · N3, N11 deferred · N9, N10 skipped.

## New findings
| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| R1 | code-review #1 | major | `server/test/helpers/runs.ts:39` — with `expected`, returns when ANY terminal run has a trace (extra run), not the target run → test flake (regression from N4) | T14 | fix | fixed |
| R2 | code-review #2 | major | `client/src/lib/hooks/context.ts:126,109` — toggle onSettled / useRefreshContext invalidate attachments mid-queue → pending panel optimistic list clobbered (same area as F4→N2; not converging) | T6 | fix (user: simplify via R9) | fixed |
| R3 | code-review #3 | major | `context.ts:117` — toggle doesn't update `saves.confirmed` → later failed save rolls back to pre-toggle state | T6 | fix (user: simplify via R9) | fixed |
| R4 | code-review #4 | major | `context.ts:77` — onMutate registers in `saves` after `await cancelQueries` → earlier save drains + refetch clobbers new optimistic state | T6 | fix (user: simplify via R9) | fixed |
| R5 | code-review #5 | minor | `context.ts:60` — module-global `saves`/`queues`, a never-settling mutation pins pending>0 | T6 | fix (user: simplify via R9) | fixed |
| R6 | code-review #6 | minor | `server/src/modules/context/fs-scanner.ts:39` — root readdir error rethrown raw → 500 with absolute local clone path in message (regression from N7) | T7 | fix | fixed |
| R7 | code-review #7 | minor | `server/test/context-fs-scanner.test.ts:97` — chmod-000 tests fail when suite runs as root (CI container) | T7 | fix (same round) | fixed |
| R8 | code-review #8 | minor | `server/src/modules/reviews/run-executor.ts:241` — info level + `undefined` for non-Error rejections | T14 | fix (same round) | fixed |
| R9 | code-review #9 | info | `context.ts:91` — hand-rolled pending counter duplicates TanStack `mutationKey` + `isMutating` | T6 | input to R2–R5 decision | fixed |
| R10 | code-review #10 | nit | `context.ts:109` — useRefreshContext invalidates attachments of all repos; closure not memoized | T6 | skip | skipped |

## Round 3 fixes (fix base 9ec320a; user chose "Round 3 + simplify")
- R2–R5/R9: hand-rolled `saves` registry removed; shared mutationKey + `qc.isMutating` (`savesInFlight`); invalidate only when last save settles; sync snapshot in onMutate + immediate rollback on last failure + invalidate (AC38/AC27 hold even when refetch fails); toggle now optimistic too; useRefreshContext repo-scoped, skips owners with saves in flight, memoized. Red evidence for R2 and both PUT+GET-fail tests.
- R1 helper: every terminal `done` run must have a trace. R8 `runLog.error`, String(err) for non-Error.
- R6 service maps scan failure → `repo_not_cloned` (409), no path leak. R7 chmod tests `it.skipIf(root)`.
- Remaining known: module-level `enqueue` queue shared across tests (test hygiene; R2 test now settles its promise).
- Gates (uncached): server 405, client 215; it 20/20 twice unsandboxed.
