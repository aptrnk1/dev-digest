# Phase 7 — finish

1. **Final verify** (skip a step whose package is untouched; reuse cached
   passes — `check.sh` prints `(cached …)`):
   - `scripts/check.sh server gate` · `scripts/check.sh server it`
     (`SKIP … self-skipped` is not a pass — list it as env)
   - `scripts/check.sh client gate`
   - `scripts/check.sh reviewer-core gate` · `scripts/check.sh mcp gate`
   - `cd e2e && npm run e2e:hermetic` — only if flows changed and
     `e2e/INSIGHTS.md` says this host can run it
   Append to `verify-<sha>.md`.
2. **Insights.** Collect "Insight candidates" from `reports/<feature>/T*.md`
   and the reviewers' reports; record the non-duplicate ones with the
   `engineering-insights` skill (one entry per lesson, in the module's
   `INSIGHTS.md`).
3. **Docs.** Dispatch `doc-writer` with `plan: specs/plans/<feature>.md`
   (mode b — documents only what is in the code). Skip if the plan's tasks
   already updated the module README and nothing user-facing changed.
4. **Commit** `<feature>: verify, insights, docs`; set `Phase: done` in
   flow.md.
5. **Summary to the user** (≤20 lines): branch + commits, tasks done,
   review rounds and what was fixed, rows `deferred` / `accepted-by-user`,
   env-only items (Docker, manual checks from the plan's Risks with who/how),
   spec updates the planner flagged.
6. **Next steps — ask, do not do:**
   - the user runs `/pr-self-review` (it cannot be invoked by the model and
     its gate blocks `gh pr create` until it passes);
   - then offer to push the branch and open the PR (`gh pr create`), and to
     set the spec's `Status: implemented` after merge.
