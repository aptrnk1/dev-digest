# Plan: Smart Diff

Spec: `specs/smart-diff.md` · Modules: server, client, e2e (+ seed) · Status: Draft

## Goal
On **Files changed** a reviewer sees PR files grouped Core → Tests → Wiring → Docs → Boilerplate (deterministic, no LLM), with per-group "with findings" counters, a findings badge per file and the review's findings rendered inline under the code line.
Not doing: `.gitattributes`/`linguist-*` overrides, manual role change, `pseudocode_summary`, `proposed_splits`, LLM classification, any new table/cache, creating findings from the diff, publishing to GitHub.

## Architecture
New module `server/src/modules/smart-diff/` (routes → compose → service → ports → repository; `domain.ts` holds the pure classification/selection/grouping rules). The service reads stored `pr_files` through its own repository (same as `intent` reads `pr_files`), findings through a new `container.reviews` facade over `ReviewService.reviewsForPull`, and ranks through `container.repoIntel.getFileRank`; it writes nothing. The route calls `container.smartDiff` (lazy getter + `overrides.smartDiff`, like `container.intent`) so the route test runs without a DB. Client: `useSmartDiff` + `DiffTab` render groups of the existing `FileCard`; the overlay resolves `finding_ids` against the already-loaded `usePrReviews` data and anchors them to parsed patch lines client-side.

## Cross-task decisions
- **Contracts** (both `contracts/brief.ts` copies, byte-identical): `brief.ts` imports `Severity` from `./findings.js` (findings.ts imports only zod — no cycle). `SmartDiffRole` = `['core','tests','wiring','docs','boilerplate']` (enum order = display order); `SmartDiffFile` += `finding_ids: string[]`, `max_severity: Severity.nullable()`, `rank_percentile: z.number().nullable()`; `SmartDiffGroup` += `files_with_findings: int`. `SmartDiff`/`ProposedSplit`/`SmartDiffResponse` unchanged.
- **Data**: no schema change, no migration.
- **i18n** (`client/messages/en/prReview.json → smartDiff`, added in T1): `testsLabel` "Tests", `docsLabel` "Docs", `filesWithFindings` "{count} with findings", `findingsOutsideDiff` "Findings outside the visible diff", `findingsCount` "{count, plural, one {# finding} other {# findings}}", `filesChangedTitle` "Files changed · {count} files". Existing `coreLabel`/`wiringLabel`/`boilerplateLabel`/`filesCount` reused.
- **Interfaces (server)**:
  - `GET /pulls/:id/smart-diff` → `SmartDiffResponse`; zod `IdParams` + response; 404 unknown PR.
  - `container.smartDiff: SmartDiffFacade` (`smart-diff/types.ts`) = `{get(workspaceId: string, prId: string): Promise<SmartDiffResponse>}`; `ContainerOverrides.smartDiff?`.
  - `container.reviews: ReviewsFacade` (`reviews/types.ts`) = `{listForPull(workspaceId: string, prId: string): Promise<ReviewDto[]>}` built by `reviews/compose.ts createReviewsFacade(c)` from `new ReviewService(c).reviewsForPull`; `ContainerOverrides.reviews?`. Chosen over reading `findings` in smart-diff's repository because the spec mandates the reviews facade and it yields the same ids/shape the client already holds.
  - Ports (`smart-diff/ports.ts`): `ChangedFile {path, additions, deletions, patch: string|null}`; `PullFilesRead {prId, repoId, files: ChangedFile[]}`; `SmartDiffStore.loadPullFiles(workspaceId, prId): Promise<PullFilesRead|undefined>`; `FindingRef {id, file, start_line, end_line, severity: Severity, dismissed_at: string|null}`; `ReviewFindingsRead {id, agent_id: string|null, created_at: string, findings: FindingRef[]}`; `ReviewSource.listForPull(workspaceId, prId): Promise<ReviewFindingsRead[]>` (ReviewsFacade satisfies structurally); `FileRankSource.getFileRank(repoId, paths): Promise<{path, percentile}[]>` (RepoIntel satisfies).
  - Domain (`smart-diff/domain.ts`, pure): `normalizePath(p): string`; `classifyFile({path, patch}): SmartDiffRole`; `selectFindings(reviews: ReviewFindingsRead[], prPaths: ReadonlySet<string>): FindingRef[]`; `sortGroup<T extends {path, additions, deletions, rank_percentile: number|null}>(files: T[]): T[]`; `buildSmartDiff(files: ChangedFile[], findings: FindingRef[], ranks: ReadonlyMap<string, number>): SmartDiff`; `class SmartDiffDomainError {code: 'pr_not_found'}`.
  - `SmartDiffService.get(workspaceId, prId): Promise<SmartDiff>`.
- **Interfaces (client)**:
  - `useSmartDiff(prId): UseQueryResult<SmartDiffResponse>` (`lib/hooks/smart-diff.ts`, key `["smart-diff", prId]`, via `api.get`); `useRunReview`, `useDeleteRun`, `useDeleteReview`, `useFindingAction` and the page's `onRunDone` invalidate it together with `["reviews", prId]`.
  - `diff-viewer/findings.ts`: `anchorFindings(lines: Line[], findings: FindingRecord[]): {byNewLine: Map<number, FindingRecord[]>; fileLevel: FindingRecord[]}` (each list sorted CRITICAL → SUGGESTION).
  - `FileCard` += `findings?: FindingRecord[]`, `maxSeverity?: Severity | null`, `renderFinding?: (f: FindingRecord) => React.ReactNode`; `CodeLine` += `findings?`, `renderFinding?`. `diff-viewer/index.ts` exports `FileCard`. `DiffViewer` (flat fallback) unchanged.
  - `DiffTab` props += `repoFullName?: string | null`, `headSha?: string | null`; renders `FindingCard` via `renderFinding` (diff-viewer never imports page `_components`).
- **Constraints**:
  - Classification exactly per spec §3, first match wins; basename match case-insensitive; directory tokens (`vendor/`, `dist/`, `test/`, `e2e/`, `docs/`, `migrations/`, …) match any path segment; content rule scans the first 5 add/ctx lines (hunk headers and `-` lines skipped); barrel = basename `index.(ts|tsx|js|mjs)` with ≥1 non-empty added line and every non-empty added line matching `export … from` / `export * from` / comment (`//`, `/*`, `*`, `*/`); no patch → `core`.
  - Sort in group: `rank_percentile` desc (null last) → `additions+deletions` desc → path asc. `groups` = non-empty only, order core, tests, wiring, docs, boilerplate.
  - Findings: per `agent_id` only the newest review by `created_at` (reviews with `agent_id null` each count as their own agent); drop `dismissed_at != null`; drop findings whose normalized `file` is not a PR path. `finding_ids`/`finding_lines` (= `end_line`) in severity-then-line order, one entry per finding; `max_severity` null without findings; `files_with_findings` = files with ≥1 finding.
  - `split_suggestion`: `total_lines` = Σ(additions+deletions), `too_big` = `total_lines > 1000`, `proposed_splits: []`; `pseudocode_summary: null`.
  - `getFileRank` returning `[]` or rejecting → no ranks, no error (AC3).
  - Anchor: RIGHT side; `end_line` if it is a visible `newNo`, else the largest visible `newNo` in `[start_line, end_line]`, else file-level; no patch → all file-level. Findings render independently of the "Show comments" toggle.
  - Auto-open: `FileCard` opens when it has findings (also when findings arrive after mount, unless the user toggled it); Boilerplate group collapsed unless `files_with_findings > 0`.
  - Client: `import type` only from `@devdigest/shared`; role→label key map and severity order local under `satisfies Record<…>`; no `<word>` in messages.

## Risks
- Assumption: anchoring lives in the client (`anchorFindings`), not in server `domain.ts` as §7 lists — only the client has the parsed `newNo` lines the rule depends on; the server still emits `finding_lines`.
- Assumption: `.md/.mdx/.rst` anywhere → docs (seed `README.md` must be docs); `.txt` only under a `docs/` segment; any file under a `docs/` segment → docs.
- Assumption: segment matching means repo paths like `server/src/vendor/**` classify as boilerplate and `e2e/**` as tests — accepted per spec table.
- Assumption: smart-diff reads `pull_requests`/`pr_files` in its own repository (intent precedent); it imports no other module's repository/service — only `reviews/types.ts` for the facade type in `container.ts`.
- Assumption: seeded file `additions/deletions` are rewritten to match the seeded patches; PR-level totals stay. Existing local DBs keep patch-less rows until reseeded.
- Seeded `src/config.ts` line 12 must not look like a real Stripe key (push protection) — use `sk_live_EXAMPLE_NOT_A_REAL_KEY`-style text (T3).
- Seed patches change what `reviews.it`/`integration.it` diff-loader sees for #482 — T3 runs those suites.
- e2e text locators can't assert group order — order is covered by T2 domain, T4 DiffTab and T5 it tests. e2e cannot run on macOS 12 hosts (e2e/INSIGHTS 2026-10-18) → T6 `skip-verify` there.
- `pnpm arch:check` carries 5 known baseline errors (server/INSIGHTS 2026-10-18) — the gate is "no new violations".

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] SmartDiff contracts + i18n keys
Owns: `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`, `server/test/contracts.test.ts`, `client/messages/en/prReview.json`
Depends on: —
Skills: zod
Route: agent:haiku
Steps:
1. Test: `contracts.test.ts` — `SmartDiff` parses a full payload with all five roles, `finding_ids`, `max_severity` (`'CRITICAL'` and `null`), `rank_percentile` null, `files_with_findings`; rejects role `'tests '`/unknown and `max_severity: 'INFO'`.
2. Contracts per Cross-task decisions in the server copy, then copy the file byte-for-byte to the client.
3. Add the six `smartDiff` keys (exact strings above).
Acceptance: AC5 — `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` empty; contracts test green; both typechecks pass.
Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/contracts.test.ts && pnpm arch:check` · `cd client && pnpm typecheck`
Escalate if: importing `Severity` into `brief.ts` creates a cycle or a consumer of the old `SmartDiff*` shape fails to typecheck.

## Wave 1 — parallel (disjoint Owns)

| File / glob | Task |
|---|---|
| `server/src/modules/smart-diff/**`, `server/src/modules/reviews/{types,compose}.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/README.md`, `server/test/smart-diff-{domain,service,routes}.test.ts` | T2 |
| `server/src/db/seed.ts` | T3 |
| `client/src/components/diff-viewer/**`, `client/src/lib/hooks/{smart-diff,index,reviews}.ts`, `client/src/lib/hooks/smart-diff.test.tsx`, `…/pulls/[number]/_components/DiffTab/**`, `…/pulls/[number]/page.tsx` | T4 |

### T2 [P] [BE] `smart-diff` module, reviews facade, route
Owns: `server/src/modules/smart-diff/{routes,compose,service,ports,domain,repository,constants,types,http-errors}.ts`, `server/src/modules/reviews/types.ts` (new), `server/src/modules/reviews/compose.ts` (new), `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/README.md`, `server/test/smart-diff-domain.test.ts`, `server/test/smart-diff-service.test.ts`, `server/test/smart-diff-routes.test.ts`
Depends on: T1
Skills: onion-architecture, fastify-best-practices, drizzle-orm-patterns, zod
Route: agent
Interfaces: provides the route, `SmartDiffService`, `container.smartDiff`, `container.reviews`; consumes `container.repoIntel.getFileRank`, `ReviewService.reviewsForPull` (via facade only).
Steps:
1. Tests: `smart-diff-domain` — `classifyFile` one example per §3 row (each lock name family, each generated path token incl. `server/src/db/migrations/meta/_journal.json`, `@generated` header in patch, `docs/guide.txt`, `README.md`, `LICENSE`, `CHANGELOG.md`, `*.test.*`/`__tests__/`/`*.flow.json`, `package.json`/`tsconfig.base.json`/`.github/workflows/ci.yml`, barrel with only re-exports and comments) + `core` fallbacks (barrel without patch, barrel with a real statement, `src/config.ts`, `./src/a.ts` normalized); `sortGroup` (rank desc, unranked last, size, path); `selectFindings` (newest per agent, null-agent reviews kept, dismissed dropped, non-PR file dropped); `buildSmartDiff` (order, empty groups omitted, `finding_ids`/`finding_lines`/`max_severity`/`files_with_findings`, `too_big` at 1000 vs 1001) (AC1–AC4). `smart-diff-service` (fakes) — unknown PR → `SmartDiffDomainError('pr_not_found')` and no review/rank calls; `getFileRank` `[]` and rejecting → secondary sort, no throw (AC3). `smart-diff-routes` — `buildApp` with `overrides {auth: MockAuthProvider, smartDiff: stub}`: 200 body parses as `SmartDiffResponse`; stub throwing `pr_not_found` → 404; non-uuid id → 4xx validation (AC2).
2. `domain.ts` + `constants.ts` (lock names, path/config patterns, `ROLE_ORDER`, `SEVERITY_RANK`, `TOO_BIG_LINES = 1000`).
3. Ports, `repository.ts` (`SmartDiffRepository implements SmartDiffStore`, workspace-scoped PR + `pr_files` read, returns `PullFilesRead`), `service.ts`, `compose.ts` (`createSmartDiffFacade(c)` wiring `c.reviews`, `c.repoIntel`), `http-errors.ts` (`pr_not_found` → `NotFoundError`), `routes.ts` calling `app.container.smartDiff.get`.
4. `reviews/types.ts` (`ReviewsFacade`, re-exports type `ReviewDto`) + `reviews/compose.ts`; `container.reviews` and `container.smartDiff` getters + overrides; register `smartDiff` in `modules/index.ts`; `server/README.md` §API map row.
Acceptance: AC1, AC2, AC3, AC4 (unit level); route reads only stored data and writes nothing.
Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/smart-diff- --exclude '**/*.it.test.ts' && pnpm arch:check` (no violations beyond the 5 baseline)
Escalate if: `ReviewDto` does not satisfy `ReviewFindingsRead` structurally, `ReviewService` construction from the container has side effects, or arch:check flags `reviews/compose.ts`.

### T3 [P] [BE] Seed PR #482 for all roles
Owns: `server/src/db/seed.ts`
Depends on: T1
Skills: drizzle-orm-patterns
Route: agent:haiku
Steps:
1. Give every existing #482 `pr_files` row a unified-diff `patch`; `src/config.ts` patch adds new line 12 (fake key text per Risks); `src/api/users.ts` patch shows new lines 45–52; set each row's `additions/deletions` to the patch counts.
2. Add rows with patches: `src/api/users.test.ts` (test code), `src/index.ts` (only `export … from` lines and a comment), `README.md`, `pnpm-lock.yaml`.
3. Keep both seeded findings unchanged (`src/config.ts:12`, `src/api/users.ts:45-52`).
Acceptance: seeded #482 classifies as core 4 (2 with findings) · tests 1 · wiring 1 · docs 1 · boilerplate 1 (input for AC9).
Verify: `cd server && pnpm typecheck && pnpm exec vitest run reviews.it.test.ts integration.it.test.ts intent.it.test.ts pulls-comments.it.test.ts --no-file-parallelism`
Escalate if: an existing integration test asserts the old file set or patch-less diff.

### T4 [P] [FE] Grouped Files changed + inline findings
Owns: `client/src/components/diff-viewer/**` (incl. new `findings.ts`, `findings.test.ts`, `FileCard/FileCard.test.tsx`), `client/src/lib/hooks/smart-diff.ts`, `client/src/lib/hooks/smart-diff.test.tsx`, `client/src/lib/hooks/index.ts`, `client/src/lib/hooks/reviews.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/**` (incl. `_components/SmartDiffGroup/`, `helpers.ts`, `helpers.test.ts`, `DiffTab.test.tsx`), `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
Depends on: T1
Skills: next-best-practices, react-best-practices, react-testing-library
Route: agent
Interfaces: consumes `GET /pulls/:id/smart-diff`, `usePrReviews`, `useFindingAction`, `FindingCard`; provides `useSmartDiff`, `anchorFindings`, extended `FileCard`/`CodeLine`/`DiffTab` props.
Steps:
1. Tests: `findings.test.ts` — anchor on `end_line`; fallback to largest visible `newNo` in range; outside → file-level; no patch → all file-level; stack order CRITICAL → SUGGESTION. `FileCard.test.tsx` — badge count + `max_severity` colour; card with findings starts open above `AUTO_EXPAND_MAX_LINES` and opens when findings arrive later; `renderFinding` output under the anchored line; file-level block with `findingsOutsideDiff`; comments still render. `DiffTab.test.tsx` (fetch mocked, `prReview` + `shell` messages) — groups in server order with label, `N files`, `M with findings`; Boilerplate collapsed, expanded when it has findings; inline `FindingCard` accept fires `POST /findings/:id/accept`; smart-diff loading or 500 → flat `DiffViewer` list, no `ErrorState`. `smart-diff.test.tsx` — key `["smart-diff", prId]`; finding action / run / delete invalidate it with `["reviews", prId]`.
2. `findings.ts` + local severity order/colour constants; `FileCard`/`CodeLine` props; export `FileCard`.
3. Hook + invalidations in `reviews.ts`; `DiffTab/helpers.ts` (`indexFindings(reviews)`, `resolveGroups(smartDiff, prFiles, index)` — PR files missing from smart-diff appended to Core without overlay); `SmartDiffGroup` header + collapse; `DiffTab` uses `filesChangedTitle`, `renderFinding` → `FindingCard` with `useFindingAction` (`prId`), `repoFullName`, `headSha`.
4. `page.tsx`: pass `repoFullName`/`headSha` to `DiffTab`; `onRunDone` also invalidates `["smart-diff", prId]`.
Acceptance: AC6, AC7 (accept/dismiss from diff refreshes Agent runs via shared `["reviews", prId]`), AC8.
Verify: `cd client && pnpm typecheck && pnpm exec vitest run src/components/diff-viewer src/app/repos src/lib/hooks`
Escalate if: a needed field is missing from `SmartDiffResponse`/`FindingRecord`, or a new `vendor/ui` primitive is needed.

## Wave 2 — integration / e2e

### T5 [BE] smart-diff integration test
Owns: `server/test/smart-diff.it.test.ts`
Depends on: T2, T3
Skills: drizzle-orm-patterns
Route: agent
Steps:
1. Real pg + `seed`: `GET /pulls/<#482 id>/smart-diff` → roles `core, tests, wiring, docs, boilerplate`; core `files_with_findings` 2; `src/config.ts` `finding_lines [12]`, `max_severity 'CRITICAL'`; `split_suggestion.too_big` false.
2. Insert two reviews for one agent (older one with a finding) → only the newer run's findings count; dismiss a finding via `POST /findings/:id/dismiss` → it disappears; finding on a non-PR file → absent; random uuid → 404 (AC2, AC4).
Acceptance: AC2, AC4 end-to-end on Postgres.
Verify: `cd server && pnpm exec vitest run smart-diff.it.test.ts`

### T6 [FE] e2e: grouped diff with inline finding
Owns: `e2e/specs/05-pr-diff.flow.json`
Depends on: T2, T3, T4
Route: inline
Steps: after `tab=diff`, `wait --text` for `Core`, `Boilerplate`, `2 with findings`, and the seeded finding title `Hardcoded Stripe secret key in commit` (rendered only inline on this tab); keep the existing `src/config.ts` step.
Acceptance: AC9 on seeded data.
Verify: `cd e2e && npm run e2e:hermetic` (skip-verify on macOS 12 hosts — e2e/INSIGHTS 2026-10-18)

---

## Execution (for the orchestrator)
Goal: every check below still runs; tokens are saved by not repeating work.

**Dispatch**
1. One `implementer` per task. Delegation message, in this order (the shared
   part first and byte-identical across a wave, so parallel workers hit the
   prompt cache; the task-specific part last):
   ```
   plan: specs/plans/smart-diff.md
   <wave notes: interfaces from earlier tasks, branch to ff-merge, known host limits>
   report: specs/plans/reports/smart-diff/T<n>.md
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
   and append the result to `specs/plans/reports/smart-diff/verify-<sha>.md`
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
   - `cd e2e && npm run e2e:hermetic` (if the host can run it — see `e2e/INSIGHTS.md`)
10. `/pr-self-review`, then record "Insight candidates" from the report files
    with `engineering-insights`.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | todo | |
| T2 | todo | |
| T3 | todo | |
| T4 | todo | |
| T5 | todo | |
| T6 | todo | |
