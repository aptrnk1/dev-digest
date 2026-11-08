# Review round 1 — Project Context

Base: e82e4fe · HEAD: bd491e7
Sources: architecture-reviewer (APPROVE, 0 findings) · plan-verifier (INCOMPLETE) · /code-review high (10 findings, unverified)

| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| F1 | code-review #4 + spec AC9/EC12 | critical (DEVIATION) | `server/src/modules/context/service.ts:80` — `/context/file` with symlink escaping the clone returns 404 `doc_not_found`; AC9 requires 422 `validation_error` | T7 (+extra-owns `ports.ts`) | fix | fixed |
| F2 | code-review #10 + spec AC13 | major (DEVIATION) | `client/src/app/repos/[repoId]/context/_components/ContextView/ContextView.tsx:84` — root docs get blank group header; AC13 requires `/` (`page.rootFolder` unused) | T9 | fix | fixed |
| F3 | code-review #1 | major | `server/src/modules/context/repository.ts:48` — `replace()` delete+insert without lock; overlapping PUTs for same (owner, repo) violate unique index → 500 | T7 | fix | fixed |
| F4 | code-review #2 | major | `client/src/lib/hooks/context.ts:78` — `useToggleDocAttachment` GET→PUT not serialized per owner; concurrent toggles lose updates | T6 | fix | fixed |
| F5 | code-review #3 | major | `server/src/modules/reviews/run-executor.ts:228` — `resolveForRun` failure fails the whole agent run; other prompt enrichments are best-effort | T14 | fix | fixed |
| F6 | code-review #7 | major | `server/src/modules/context/paths.ts:28` — `.` / empty segments accepted → non-canonical duplicates pass, doc later `(missing)` at run | T7 | fix | fixed |
| F7 | verifier AC68/AC69 | major (PARTIAL) | `server/test/context-run.it.test.ts:113-115` — trace read before persisted (2/6 runs fail); same race flakes `reviews.it.test.ts:281`; helper `server/test/helpers/runs.ts` waits only for `agent_runs.status` | T14 (+extra-owns `server/test/helpers/runs.ts`) | fix | fixed |
| F8 | verifier AC46 | major (PARTIAL) | `client/src/app/skills/[id]/_components/SkillEditor/` — no test for tab order Config→Context→Preview and `?tab=context` | T13 | add test | fixed |
| F9 | verifier AC43 | major (PARTIAL) | `SkillEditor/_components/ContextTab/ContextTab.test.tsx:71` — pair-change asserted only against mocked panel | T13 | add test | fixed |
| F10 | code-review #5 | minor | `server/src/modules/context/fs-scanner.ts:34` — unreadable/vanished subdir rejects whole scan → 500 | T7 | fix (owner edits module this round) | fixed |
| F11 | code-review #8 | minor | `ContextView.tsx:77` — Refresh doesn't refresh open preview / usage (AC29 needs list only) | T9 | fix (same file as F2) | fixed |
| F12 | code-review #6 | minor | `server/src/modules/context/service.ts:65` — list() reads + tokenizes up to 500 docs per request | T7 | defer — covered by NFR1 manual p95 check | deferred |
| F13 | code-review #9 | nit | `service.ts:139` — duplicate findRepo/listOwn queries | T7 | skip | skipped |
| F14 | code-review #10 (2nd part) | nit | duplicated helpers `baseName/folderOf`; unused `panel.*` keys in context.json | T6/T9/T10 | skip | skipped |
| E1 | verifier | env | AC18, AC31, AC44 [e2e] — `e2e/specs/10-project-context.flow.json` | T16 | CI (macOS 12 host) | env |
| E2 | verifier | env | NFR1, NFR3, NFR4 — manual checks | — | developer before merge | env |

## Round 1 fixes (commit: see git log "review fixes round 1"; fix base bd491e7)
- F1 `DocRead.kind='outside'` → 422 on /context/file, `missing` in attachments. F3 `pg_advisory_xact_lock` in replace() (no dedicated race test). F6 `non_canonical`. F10 skip unreadable dir. Red evidence for T7 tests verified by orchestrator (8 fail with source fixes stashed).
- F4 per-owner promise queue in hooks/context.ts (red: lost doc1).
- F5 `.catch` → `Project context: skipped (error)`; F7 waitForPrRuns waits for run_traces rows; it 20/20 on two uncached unsandboxed runs.
- F8/F9 new SkillEditor.test.tsx + ContextTab.pair.test.tsx (copied from T13 worktree by orchestrator; worktree isolation blocked main-checkout writes). F9 does not guard the `key=` prop itself.
- F2/F11 root header `/`, Refresh invalidates ['context', repoId].
