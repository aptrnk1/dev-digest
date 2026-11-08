# Review round 2 — Project Context

Fix base: bd491e7 · HEAD: 31c6bc9
Sources: architecture-reviewer delta (APPROVE, 0) · plan-verifier delta (BLOCKED_UNVERIFIABLE — env only; full `server it` 65/65, gates green) · /code-review high on round-1 paths (10, unverified)

## Previous rows (review-1.md)
F1–F11 fixed (verifier: DONE) · F12 deferred · F13, F14 skipped · E1, E2 env.

## New findings
| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| N2 | code-review #2 | major | `client/src/lib/hooks/context.ts:82` — queued PUTs but optimistic update / onSettled invalidation outside the queue: earlier save's refetch clobbers later optimistic state; rollback snapshot can be stale (AC38) | T6 | fix | fixed |
| N6 | code-review #6 | major | `server/src/modules/context/fs-scanner.ts:10` — `within()` treats `..changelog.md` as outside (regression from F1) | T7 | fix | fixed |
| N1 | code-review #1 | minor | `server/src/modules/reviews/run-executor.ts:240` — catch drops the error message | T14 | fix (owner edits file) | fixed |
| N4 | code-review #4 | minor | `server/test/helpers/runs.ts:35` — waits for traces of all terminal runs, ignoring `expected` → can spin to timeout | T14 | fix | fixed |
| N5 | code-review #5 | minor | `server/test/helpers/runs.ts:33` — polls whole run_traces table | T14 | fix (same file) | fixed |
| N7 | code-review #7 | minor | `fs-scanner.ts:37` — root readdir failure swallowed → empty list instead of error | T7 | fix (same file as N6) | fixed |
| N8 | code-review #8 | minor | `ContextView.tsx:79` — component-level invalidateQueries with hard-coded key (client/CLAUDE.md: query hooks in lib/hooks); attachments not refreshed | T6 (+extra-owns ContextView) | fix | fixed |
| N3 | code-review #3 | info | `run-executor.ts:306` — `completeAgentRun` before `saveRunTrace` (pre-existing reviews-module ordering, not introduced by this feature) | — | defer — out of plan scope; candidate follow-up | deferred |
| N9 | code-review #9 | nit | inline empty-context fallback duplicates `RunContextService.empty()`; catch could live in the service | T14/T8 | skip (N1 types the fallback) | skipped |
| N10 | code-review #10 | nit | `service.ts:76` duplicate findRepo (= F13) | T7 | skip | skipped |
| N11 | T6 report | minor | `client/src/lib/hooks/context.ts` — `useToggleDocAttachment` onSettled may refetch while a panel save for the same owner is queued (needs page menu + tab used simultaneously) | T6 | defer | deferred |

## Round 2 fixes (fix base 31c6bc9)
- N2 per-key {pending, confirmed}; invalidate/rollback only when last queued save settles (red: A clobbered B). N8 `useRefreshContext(repoId)` in lib/hooks.
- N6 `within()` = abs | '..' | '..'+sep. N7 root readdir failure rethrows (red evidence both).
- N1 log `Project context: skipped (error: <msg>)`, fallback typed RunProjectContext. N4/N5 helper honours `expected`, filters by terminal ids.
- Gates: server 404, client 212; it 20/20 on two uncached unsandboxed runs.
