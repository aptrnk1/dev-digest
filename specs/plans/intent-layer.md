# Plan: Intent Layer

Spec: `specs/intent-layer.md` · Modules: server, reviewer-core, client, e2e · Status: Draft

## Goal
A reviewer sees a cached, source-attributed PR intent card on Overview (derivable before a review), and every Run Review prompt carries it as an untrusted `## PR intent` block.
Not doing: Jira/Linear/external URL fetch (detect only), per-objective "addressed" status, auto re-derive on polling, Smart Diff / Blast Radius / PR Brief.

## Architecture
New module `server/src/modules/intent/` (routes → compose → service → ports → repository; `domain.ts` for the confidence ceiling) gathers sources (§3), hashes them, returns the cached `pr_intent` row or calls the `review_intent` model. Reviews (legacy, takes `Container`) reach it only via a `container.intent` facade (same pattern as `container.repoIntel`), render it to a string and pass `ReviewInput.intent` into reviewer-core, which wraps it with `wrapUntrusted('pr-intent', …)`. Client adds `IntentCard` + hooks over the two routes; `INJECTION_GUARD`, grounding and `agent_runs.cost_usd` stay as is.

## Cross-task decisions
- **Contracts** (both `vendor/shared` copies):
  - `brief.ts`: `IntentRiskKind` enum `security|dependency|performance|data|api|other`; `IntentConfidence` `high|medium|low`; `IntentBasis` `spec|ticket|description|inferred`; `IntentSource {kind: IntentBasis, ref: string, truncated: boolean}`; `UnresolvedRef {ref: string, reason: string}`; `Intent` += `risk_areas: {label, kind}[]`, `confidence`, `basis`, `sources: IntentSource[]`, `unresolved_refs: UnresolvedRef[]`.
  - `review-api.ts`: `PrIntentRecord` += `head_sha`, `model`: `string|null`, `cost_usd: number|null`, `updated_at: string|null`; new `PrIntentState {intent: PrIntentRecord|null, stale: boolean}`, `DeriveIntentBody {force?: boolean}`.
  - `trace.ts`: `PromptAssembly.intent: z.string().nullish()` — nullish like sibling slots, so old traces parse without a `getRunTrace` default.
  - `platform.ts` + `client/src/lib/feature-models.ts`: `review_intent` → `openrouter` / `anthropic/claude-haiku-4-5`, label `PR Intent (classifier)`.
  - `adapters.ts`: `GitClient.showFile(repo: RepoRef, ref: string, path: string): Promise<string | null>` — `git show <ref>:<path>` in the clone; `null` on any failure, never fetches.
- **Data**: `server/src/db/schema/reviews.ts` `prIntent` += columns of spec §7 (jsonb `'[]'` defaults, `confidence` not null default `'low'`, `updated_at` default now, rest nullable) → `pnpm db:generate`.
- **Interfaces**:
  - `GET /pulls/:id/intent` → `PrIntentState`; `POST /pulls/:id/intent` body `DeriveIntentBody` → `PrIntentRecord`; 404 unknown PR, 422 `llm_not_configured`.
  - `IntentService.ensure(workspaceId, prId, opts?: {force?: boolean; log?: IntentLog}): Promise<PrIntentRecord>`; `IntentService.get(workspaceId, prId): Promise<PrIntentState>`.
  - `IntentLog = {info(msg: string): void; error(msg: string): void}` (RunLogger satisfies it).
  - `container.intent: IntentFacade` (`modules/intent/types.ts`) = `{ensure, renderForPrompt(intent: Intent): string}`.
  - reviewer-core: `ReviewInput.intent?: string`, `PromptParts.intent?: string`, `assembly.intent`.
  - client: `usePrIntent(prId): UseQueryResult<PrIntentState>` (key `["pr-intent", prId]`), `useDeriveIntent(prId)`: mutation `{force?: boolean}` → `PrIntentRecord`.
- **Constraints**: limits of §3 (spec ≤3×6000, issues ≤3×4000, body ≤4000, ≤30 commits, ≤100 paths); truncated text ends with `…[truncated]` and sets `truncated: true`; LLM: `schemaName 'pr_intent'`, temperature 0, `maxRetries 1`, `timeoutMs 20000`; server slices arrays to 6; `confidence = min(ceiling, llm)`; `input_hash = sha256(head_sha, title, body, each source ref + sha256(content))`; pino logs only the §10 fields, never source text; intent cost stays in `pr_intent`.

## Risks
- Assumption: "meaningful" description = body after stripping HTML comments, markdown headings, checkbox/template lines and whitespace; ≥80 chars → `medium`.
- Assumption: relative body links resolve from the repo root; any `..` that escapes root, absolute path, other-repo blob URL or non-`.md/.mdx/.txt` → `unresolved_refs` with a reason (AC7).
- Assumption: issue fetch timeout 5 s each; missing `GITHUB_TOKEN` / fetch error → issue goes to `unresolved_refs` ("not fetched: …"), not a failure.
- Assumption: dead `upsertIntent/getIntent` in `reviews/repository/pull.repo.ts` + `ReviewRepository` are deleted in T1 (they stop typechecking against the new `Intent`; `pr_intent` gets one owner, the intent module). Table and contract stay.
- Assumption: seeded `pr_intent` for #482 uses the seeded `head_sha` (not stale) and `input_hash 'seed'`, so a POST re-derives.
- Existing `reviews.it.test.ts` would feed a `Review` fixture to the classifier — T5 keys fixtures by `structuredBySchema` (`Review`, `pr_intent`).
- `showFile` returns `null` when the head commit isn't in the clone (no fetch here) → `unresolved_refs` "not found at head"; Run Review calls intent after `Loading PR diff`, which already uses the clone.

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] Contracts, `pr_intent` columns, `GitClient.showFile`, feature-model default
Owns: `server/src/vendor/shared/{contracts/brief.ts,contracts/review-api.ts,contracts/trace.ts,contracts/platform.ts,adapters.ts}`, the same five in `client/src/vendor/shared/`, `client/src/lib/feature-models.ts`, `server/src/db/schema/reviews.ts`, `server/src/db/migrations/<generated>` (+ `meta/`), `server/src/adapters/git/simple-git.ts`, `server/src/adapters/mocks.ts`, `server/src/modules/reviews/repository/pull.repo.ts`, `server/src/modules/reviews/repository.ts`, `server/test/contracts.test.ts`
Depends on: —
Skills: zod, drizzle-orm-patterns, postgresql-table-design
Steps:
1. Test: `contracts.test.ts` — full `Intent`/`PrIntentState` parse; `PromptAssembly` without `intent` parses; `FEATURE_MODELS` `review_intent` default is openrouter Haiku 4.5.
2. Contracts per Cross-task decisions, identical in both copies (client copy stays type-only for consumers).
3. Schema columns → `pnpm db:generate` (no hand edits); `SimpleGitClient.showFile`; `MockGitClient.showFile` backed by an optional `files: Record<"<ref>:<path>", string>` option.
4. Delete dead `upsertIntent/getIntent` (pull.repo.ts + ReviewRepository wrappers).
Acceptance: both typechecks pass; migration adds only §7 columns (AC4 default, AC5 trace field, AC9 shapes).
Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/contracts.test.ts && pnpm arch:check` · `cd client && pnpm typecheck` · `cd reviewer-core && npm run typecheck`
Escalate if: `db:generate` proposes a rename/drop, or another caller of the deleted functions exists.

## Wave 1 — parallel (disjoint Owns)

### T2 [P] [BE] reviewer-core `## PR intent` block
Owns: `reviewer-core/src/prompt.ts` (not `INJECTION_GUARD`), `reviewer-core/src/review/run.ts`, `reviewer-core/test/prompt.test.ts`, `reviewer-core/test/run.test.ts`, `reviewer-core/README.md`, `docs/agent-prompts/README.md`
Depends on: T1
Skills: typescript-expert
Interfaces: provides `ReviewInput.intent?`, `PromptParts.intent?`, `PromptAssembly.intent` (null when absent).
Steps:
1. Test: `prompt.test.ts` — with intent: `## PR intent` directly after `## PR description`, body inside `wrapUntrusted('pr-intent', …)` with the spec §5.3 sentence; without: section absent, prompt byte-identical to today; injection string stays inside the wrapper; `INJECTION_GUARD` snapshot unchanged. `run.test.ts` — `intent` reaches `assembly.intent`.
2. Thread `intent` ReviewInput → PromptParts → assemblePrompt; document the block in both READMEs.
Acceptance: AC5 (engine side), AC11.
Verify: `cd reviewer-core && npm run typecheck && npm test`
Escalate if: the change needs `INJECTION_GUARD` or grounding edits.

### T3 [P] [BE] `intent` module: sources, confidence, classifier, cache, routes
Owns: `server/src/modules/intent/{routes,compose,service,ports,domain,helpers,prompt,repository,constants,types,http-errors}.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/src/db/seed.ts`, `server/README.md`, `server/test/intent-{refs,domain,prompt,service}.test.ts`, `server/test/intent.it.test.ts`
Depends on: T1
Skills: onion-architecture, fastify-best-practices, drizzle-orm-patterns, zod, security
Interfaces: provides the routes, `IntentService`, `container.intent`, `renderForPrompt`; consumes `resolveFeatureModel(c, ws, 'review_intent')`, `GitHubClient.getIssue`, `GitClient.showFile`.
Steps:
1. Tests: `intent-refs` — `extractRefs({body, branch, repo})` → closing keywords (all forms, optional `:`), bare `#N`, same-repo `owner/repo#N`, other repo → unresolved, branch `(^|/)(\d+)[-_]`, Jira key and Linear URL → unresolved, spec links (relative + same-repo blob URL), path traversal/absolute/extension (AC7, AC8); `intent-domain` — ceiling table §4, LLM `high` with empty body → `low`/`inferred` (AC2); `intent-prompt` — one `<untrusted source="spec:path|issue:#N|pr-description|pr-signals">` per source, truncation marker, instructions repeated after content (AC1, AC11); `intent-service` (fakes) — cache hit makes no LLM call, body/head change recomputes, `force` recomputes (AC3), model from resolver (AC4), no GitHub call for Jira/Linear (AC8), arrays sliced to 6.
2. Ports: `IntentStore` (pull + repo + ≤30 commits + ≤100 file paths with `+/-`, get/upsert intent), `IssueSource`, `FileSource`, `ModelResolver`, `IntentLog`, `Logger`. Repository implements `IntentStore` with Drizzle.
3. `IntentClassification` zod (no min/max) + system/user prompt in `prompt.ts` (SECURITY paragraph as in `server/src/prompts/onboarding.system.md`).
4. Service `ensure`/`get` per spec §5.2 with §10 run-log lines and pino fields; compose maps a missing provider key (`ConfigError`) to `IntentDomainError('llm_not_configured')`; `http-errors.ts` → 422.
5. Routes with zod params/body/response; register in `modules/index.ts`; `container.intent` getter; seed `pr_intent` for #482; `server/README.md` §API map.
6. `intent.it.test.ts` — POST with `MockLLMProvider({structuredBySchema: {pr_intent}})` persists; second POST is a cache hit (mock call count); GET `stale` false, then true after head_sha change; 422 without key; 404 unknown PR (AC9).
Acceptance: AC1–AC4, AC7–AC9, AC11 (classifier side).
Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/intent- --exclude '**/*.it.test.ts' && pnpm arch:check` · `cd server && pnpm exec vitest run intent.it.test.ts`
Escalate if: a needed read is only reachable through another module's internals, or arch:check flags the container getter.

### T4 [P] [FE] IntentCard, hooks, trace block
Owns: `client/src/lib/hooks/intent.ts`, `client/src/lib/hooks/index.ts`, `client/src/lib/hooks/reviews.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/**`, `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/**`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx`, `client/messages/en/brief.json`, `client/messages/en/runs.json`
Depends on: T1
Interfaces: `usePrIntent`, `useDeriveIntent` (both via `api.get/post`); `OverviewTab({prId, prBody})`; `IntentCard({prId})`.
Steps:
1. Test: `IntentCard.test.tsx` — loaded (quote, in/out scope, risk chips by kind, badge, "Derived from" footer, unresolved refs greyed), `low` hint, empty + "Derive intent" fires POST, stale "Outdated" + "Re-derive" (force), loading Skeleton, ErrorState; hooks test for keys/invalidation; `RunTraceDrawer.test.tsx` — intent block shown when `prompt_assembly.intent` set.
2. Hooks; `useRunReview` also invalidates `["pr-intent", prId]`; IntentCard from vendor/ui primitives above Description; risk-kind→icon map local under `satisfies Record<…>` (type-only shared imports); strings in `brief.json` (no `<word>`); TraceBody `PromptBlock` for `intent` (label in `runs.json`).
Acceptance: AC10; trace part of AC5.
Verify: `cd client && pnpm typecheck && pnpm exec vitest run src/app/repos src/lib/hooks`
Escalate if: the card needs a new `vendor/ui` primitive or a server field not in `PrIntentState`.

## Wave 2 — integration / e2e

### T5 [BE] Run Review pre-work + integration
Owns: `server/src/modules/reviews/run-executor.ts`, `server/test/reviews.it.test.ts`
Depends on: T2, T3
Steps:
1. Test: `reviews.it.test.ts` — fixtures via `structuredBySchema` (`Review`, `pr_intent`); every agent's trace has `prompt_assembly.intent` and user prompt contains `## PR intent` (AC5); classifier throws/times out → runs `done`, Live Log has an `error` line, `prompt_assembly.intent` null (AC6); intent cost absent from `agent_runs.cost_usd`.
2. After `Loading PR diff`: `container.intent.ensure(ws, pull.id, {log: runLog})` in try/catch → `runLog.error`, continue; pass `intent: renderForPrompt(...)` to `reviewPullRequest`; add `'intent'` to `PROMPT_BLOCKS`.
Acceptance: AC5, AC6.
Verify: `cd server && pnpm typecheck && pnpm arch:check && pnpm exec vitest run reviews.it.test.ts`

### T6 [FE] e2e: PR #482 shows IntentCard
Owns: `e2e/specs/02-repo-pulls-detail.flow.json`
Depends on: T3, T4
Steps: extend flow 02 — after detail load, wait for `INTENT` and the seeded intent quote text; no LLM, no POST.
Acceptance: AC10 on seeded data.
Verify: `cd e2e && npm run e2e:hermetic`

---

## Execution (for the orchestrator)
1. Run each wave's tasks with the `implementer` agent, one task per agent. Delegation message: `plan: specs/plans/intent-layer.md` · `task: T<n>` (+ interfaces reported by earlier tasks). Parallel `[P]` tasks run with `isolation: "worktree"` passed in the Agent call; wave 0 runs in the main checkout.
2. Worktrees branch from the default branch, not from the current HEAD — commit the plan and wave 0 (and merge the previous wave) before starting a parallel wave, or the workers won't see them.
3. Merge worktree results one at a time; a merge conflict means two tasks were not independent — fix the plan, not the code. Update `## Progress` from the workers' reports (workers never edit the plan).
4. Any `NEEDS_CONTEXT` / `BLOCKED` → resolve (update the plan or the task) before the next wave. Never re-dispatch an unchanged task.
5. Final verify:
   - `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check`
   - `cd server && pnpm exec vitest run .it.test` (Docker)
   - `cd client && pnpm typecheck && pnpm test`
   - `cd reviewer-core && npm run typecheck && npm test`
   - `cd e2e && npm run e2e:hermetic`
6. `/pr-self-review`, then record "Insight candidates" from the reports with `engineering-insights`.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | done | DONE_WITH_CONCERNS: `head_sha` non-null in contract, mapper coalesces |
| T2 | done | merged 351b8fb |
| T3 | done | DONE_WITH_CONCERNS: pino fields only on HTTP path; body `.nullish()` |
| T4 | done | DONE_WITH_CONCERNS: reuses `PROMPT_COLORS.specs`; hook tests under IntentCard/ |
| T5 | done | reviews.it 8/8; pino §10 fields absent on Run Review path (open) |
| T6 | done (unverified) | e2e cannot run on macOS 12 host (e2e/INSIGHTS 2026-10-18) |
