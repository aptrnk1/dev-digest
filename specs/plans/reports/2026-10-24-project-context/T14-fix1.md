## T14 fix1 — Status: DONE
Fixes:
- F5 FIXED server/src/modules/reviews/run-executor.ts:229-243 — resolveForRun wrapped in `.catch`: logs one `Project context: skipped (error)` line, continues with no specs (`specs_read: []`). New test in server/test/context-run.it.test.ts ("a throwing resolver does not fail the run"), via `runContext` override.
- F7 FIXED server/test/helpers/runs.ts:30-36 — waitForPrRuns also waits until every terminal run has a `run_traces` row (no sleeps).
Verify: typecheck, arch, test test/context- (85) pass; it context-run + reviews: 3 runs, 11/11 pass, none skipped (third served from check cache).
Concerns: none. Edited in the main checkout, not committed.
