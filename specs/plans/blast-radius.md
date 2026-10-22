# Plan: Blast Radius

Spec: none — inline requirements R1–R9 below (orchestrator brief, 2026-10-23) · Modules: server, client, mcp, e2e (+ seed) · Status: Draft

## Goal
On a PR's **Overview** tab a reviewer sees what else the diff can touch: changed symbols, their callers as GitHub `file:line` links, and the endpoints/crons that depend on each symbol. Claude Code gets the same map from `get_blast_radius`.
Not doing (P3): "Prior PRs touching these files". (Collapsible tree, Tree/Graph toggle and graph view were pulled in by the user on 2026-10-23 — Wave 3, R10–R12.) Also not doing: re-analysis or any LLM call, recomputing repo-intel limits (`MAX_CALLERS_PER_SYMBOL`, `BFS_DEPTH`), polling for resync completion, any new table or migration.

## Requirements (inline)
- **R1** The Overview tab shows a "Blast radius" block for the PR (below Intent, above Description).
- **R2** A summary row shows the counts of changed symbols, callers, endpoints affected and crons affected.
- **R3** Each changed symbol that has callers lists them as `file:line`, followed by endpoint chips and cron chips for that symbol.
- **R4** Clicking `file:line` opens the GitHub blob at that line, not the PR diff.
- **R5** There is a clear state for "no callers at all" and for "index missing, incomplete, failed or disabled". It offers a rebuild CTA where a rebuild helps.
- **R6** Server: a new `blast` module and route return the blast contract, mapped from one `repoIntel.getBlastRadius` call. No re-analysis, no LLM.
- **R7** Client: the data is fetched by a hook in `client/src/lib/hooks/`, following the same pattern as the existing hooks.
- **R8** MCP: `get_blast_radius` returns the same data as the browser (it calls the same route).
- **R9** "Prior PRs touching these files" stays excluded (see Not doing).
- **R10** (Wave 3) Each changed symbol in the list is collapsible: its callers and chips hide/show via the symbol row; all expanded by default.
- **R11** (Wave 3) A Tree / Graph toggle in the stats row switches between the list (Tree, default) and a graph view.
- **R12** (Wave 3) Graph view: changed symbols → callers → endpoints/crons as an SVG node-link diagram with a legend; client-only, no new dependency, no contract change.

## Architecture
New module `server/src/modules/blast/`: routes → compose → service → ports → repository, plus `helpers.ts` (pure mapper) and `domain.ts` (error only, following the intent/smart-diff precedent). The service has three steps:
1. Load the PR's `repo_id` and `pr_files` paths through its own repository. This follows the smart-diff precedent; modules may not import each other's repositories.
2. Call `container.repoIntel.getBlastRadius(repoId, paths)` and `getIndexState(repoId)` in parallel.
3. Map the result with `toBlastRadiusResponse`.

The route calls `container.blast`, a lazy getter with `overrides.blast` (like `container.smartDiff`), so the route test needs no DB. Client: `useBlastRadius` feeds a new `BlastRadiusCard` that `OverviewTab` renders. The degraded CTA reuses the existing `useResyncRepoIntel`. MCP: the stub use case is replaced by resolve(repo, pr) → `GET /pulls/:prId/blast-radius`, so the MCP tool and the browser share one source of truth. repo-intel itself is not changed.

## Cross-task decisions
- **Contracts** (both `contracts/review-api.ts` copies, byte-identical; `brief.ts`/`BlastRadius`/`PrBrief` unchanged — an `Intent.extend` → `PrIntentRecord` precedent, so the future-lesson brief stays intact):
  - `BlastDegradedReason` = `z.enum(['flag_off','index_failed','index_partial','repo_too_large','no_data'])`
  - `BlastStats` = `{ symbols, callers, endpoints, crons }` (all `z.number().int().nonnegative()`)
  - `BlastRadiusResponse` = `BlastRadius.extend({ pr_id: z.string(), index_sha: z.string().nullable(), stats: BlastStats, degraded: z.boolean(), degraded_reason: BlastDegradedReason.nullable() })`. The barrel already re-exports `review-api.ts`.
- **Data**: no schema change, no migration. Seed only (T3).
- **Interfaces (server)**:
  - `GET /pulls/:id/blast-radius` → `BlastRadiusResponse`. Uses zod `IdParams` + a response schema. Unknown PR → 404; non-uuid → 400.
  - `container.blast: BlastFacade` (`blast/types.ts`) = `{ get(workspaceId: string, prId: string): Promise<BlastRadiusResponse> }`, plus `ContainerOverrides.blast?`.
  - Ports (`blast/ports.ts`):
    - `PullPathsRead { prId, repoId, paths: string[] }`
    - `BlastStore.loadPull(workspaceId, prId): Promise<PullPathsRead | undefined>`
    - `BlastSource = Pick<RepoIntel, 'getBlastRadius' | 'getIndexState'>` (`import type` from `../repo-intel/types.js`; allowed by rule 11)
  - `BlastService(deps: { store: BlastStore; intel: BlastSource; repoIntelEnabled: boolean })` with `.get(workspaceId, prId): Promise<BlastRadiusResponse>`. `compose.ts` passes `c.config.repoIntelEnabled`.
  - `helpers.ts` (pure):
    - `deriveDegraded(i: { repoIntelEnabled: boolean; state: IndexState; result: BlastResult }): { degraded: boolean; reason: BlastDegradedReason | null }`
    - `toBlastRadiusResponse(i: { prId: string; result: BlastResult; state: IndexState; repoIntelEnabled: boolean }): BlastRadiusResponse`
  - `domain.ts`: `class BlastDomainError extends Error { code: 'pr_not_found' }`. `http-errors.ts` maps it to `NotFoundError`.
- **Interfaces (client)**:
  - `useBlastRadius(prId: string | null): UseQueryResult<BlastRadiusResponse>` in `lib/hooks/blast.ts`. Query key `["blast", prId]`; calls `api.get` on `/pulls/${prId}/blast-radius`; `enabled: !!prId`. Exported from `lib/hooks/index.ts`.
  - `BlastRadiusCard({ prId, repoId, repoFullName, headSha }: { prId: string | null; repoId: string; repoFullName: string | null; headSha: string | null })`
  - `OverviewTab` props gain `repoId`, `repoFullName`, `headSha`. `page.tsx` passes `repoId`, `repoFullName` and `pr.head_sha`.
- **Interfaces (mcp)**:
  - `DevDigestApi.getBlastRadius(prId: string): Promise<BlastRadiusResponse>`. The API client calls `GET /pulls/:prId/blast-radius` and parses the response with `BlastRadiusResponse`.
  - `makeGetBlastRadius({ api: Pick<DevDigestApi,'getBlastRadius'>, resolver }): (i: { repo: string; pr: number }) => Promise<BlastRadiusView>`, where `BlastRadiusView = { repo: string; pr: number } & BlastRadiusResponse & { truncated_callers?: number; hint?: string }`.
- **Constraints (mapping, T2 `helpers.ts`)**:
  - Empty PR paths → the service skips `getBlastRadius` and uses an empty, non-degraded result. It still calls `getIndexState`.
  - If `getBlastRadius`/`getIndexState` reject, the service returns an empty result with `degraded: true` and `degraded_reason: 'no_data'`, never a 500.
  - `changed_symbols` = `result.changedSymbols` → `{name, file, kind}`, deduped by `name+file`, in input order.
  - `downstream` = callers grouped by `viaSymbol`. Only symbols with ≥1 caller get an entry. Groups are ordered by caller count desc, then symbol asc.
  - Per caller: `{ name: row.symbol, file, line }`. Duplicates (same `file+line`) are dropped within a symbol; the same caller row under two symbols stays in both. Callers are ordered by `rank` desc, then `file` asc, then `line` asc.
  - `endpoints_affected`/`crons_affected` per symbol = the deduped, asc-sorted union of `factsByFile[caller.file]` over that symbol's callers. If `factsByFile` is absent, both are `[]`; the flat `impactedEndpoints` is not shown, so the summary and the list stay consistent.
  - `stats`:
    - `symbols` = `changed_symbols.length`
    - `callers` = Σ callers in `downstream`
    - `endpoints`/`crons` = distinct union across `downstream`
  - `summary` = `` `${symbols} changed symbols · ${callers} callers · ${endpoints} endpoints · ${crons} crons` ``, plus `` ` (index degraded: ${reason})` `` when degraded.
  - `deriveDegraded` precedence (first match wins):
    1. `!repoIntelEnabled` → `flag_off`
    2. `state.degraded` → `state.degradedReason ?? 'index_failed'`
    3. `state.status === 'partial'` → `index_partial`
    4. `result.degraded` → `result.reason ?? 'no_data'`
    5. otherwise `{ degraded: false, reason: null }`

    Data is still returned when degraded.
  - `index_sha` = `state.lastIndexedSha || null`.
- **Constraints (UI, T4)**:
  - The card title is `SectionLabel` "Blast radius". The stats row uses `stats` with the existing `stat.*` labels.
  - The symbol row shows the mono name and `callerCount` on the right. The caller row shows `↳ file:line` (`CornerDownRight`) plus the caller name, muted.
  - Endpoint chips use the `Globe` icon in blue; cron chips use the `Clock` icon in orange. Both are styled spans in `styles.ts`: the `Chip` primitive is a toggle button (`aria-pressed`) and must not be used here.
  - Link = `githubBlobUrl(repoFullName, index_sha ?? headSha, file, line)` with `target="_blank" rel="noopener noreferrer"`. Plain text when the repo or sha is missing. `index_sha` is preferred because caller lines come from the indexed commit, not the PR head.
  - States:
    - loading → `Skeleton` (`data-testid="blast-loading"`)
    - error → `ErrorState` with retry
    - degraded → a banner with `degraded.<reason>` above any data. The `degraded.rebuild` button shows only for `no_data | index_failed | index_partial`; it calls `useResyncRepoIntel(repoId).mutate()`, is disabled while pending, and then shows `degraded.rebuildStarted`.
    - `changed_symbols` empty and not degraded → `empty`
    - `changed_symbols` > 0 and `downstream` empty → `noDownstream` with `{count}`
  - Only `import type` from `@devdigest/shared` (client/INSIGHTS 2026-10-19). The reason→message-key and reason→CTA maps live in `constants.ts` under `satisfies Record<BlastDegradedReason, …>`.
  - New `blast.json` keys (no `<word>`):
    - `title` "Blast radius"
    - `empty` "No symbols are declared in the changed files."
    - `error.title` "Couldn't load blast radius"
    - `error.body` "The impact map is unavailable right now."
    - `degraded.flag_off` "Repo intelligence is turned off (REPO_INTEL_ENABLED=false), so callers can't be shown."
    - `degraded.no_data` "This repository isn't indexed yet, so callers can't be shown."
    - `degraded.index_failed` "The repository index failed to build — callers may be missing."
    - `degraded.index_partial` "The repository index is incomplete — some callers may be missing."
    - `degraded.repo_too_large` "The repository is too large to index fully — callers may be missing."
    - `degraded.rebuild` "Rebuild index"
    - `degraded.rebuildStarted` "Re-index started. Reopen this PR in a minute."

    Existing keys are kept.
- **Constraints (MCP, T5)**:
  - The view is the API body plus `repo` and `pr`.
  - Degraded responses add a `hint`:
    - `flag_off` → "repo intelligence is disabled on the server (REPO_INTEL_ENABLED=false)"
    - otherwise → "index is <reason>; rebuild it in the UI (PR Overview → Rebuild index)"
  - Over `MAX_RESPONSE_CHARS`, callers are popped from the last `downstream` entry (dropping entries that become empty) into `truncated_callers`, with the hint "response too large; open the PR Overview in the UI".
  - New description, ≤3 sentences: "Impact map of a PR: symbols declared in the changed files, their callers (file:line) and the endpoints/crons that depend on them. Reads the repo index; degraded=true means the index is missing or incomplete." `tools/list` + instructions stay ≤ 6000 chars.

## Risks
- Assumption: the facade only ever reports `reason: 'no_data'`, and a `partial` index returns `degraded: false` (`repo-intel/service.ts` `tryPersistentBlast`). The `flag_off | index_partial | index_failed` reasons are therefore derived in `deriveDegraded` from `getIndexState` and the config flag (T2).
- Assumption: the facade caps callers at `MAX_CALLERS_PER_SYMBOL` globally (one `slice` after the rank sort), not per symbol. Per the brief we do not recompute it, so a symbol may show fewer callers than it has. Recorded as an insight candidate.
- Assumption: crons are shown as stored in `file_facts` (`0 * * * *`, `job:<kind>`), not prettified like the mock's "reset-rate-buckets (hourly)".
- Assumption: the degraded ripgrep path has no `factsByFile`, so no per-symbol chips are shown there. The banner explains why.
- Assumption: the e2e coverage extends the existing Overview flow `02-repo-pulls-detail` (one flow per screen kind) instead of adding a new one.
- Seeding index rows for `acme/payments-api` (T3) makes repo-intel reads non-empty for #482: `getCallerSignatures` and `getUnresolvedReferences` feed the review prompt, and the index badge shows `full`. Mitigation:
  - caller files are not PR files, so PR files get no `file_rank` row and the smart-diff order is unchanged;
  - T3 runs the affected it suites;
  - rows are inserted only when the repo has no `repo_index_state` row (the `references` table has no unique key, so this keeps reseeding idempotent).
- No polling after resync: the job is async with no completion event. The user reopens the PR (`degraded.rebuildStarted` says so).
- `pnpm arch:check` carries 5 known baseline errors (server/INSIGHTS 2026-10-18). The gate is "no new violations".
- `.it.test` suites skip silently inside the sandbox (server/INSIGHTS 2026-10-22). Check the skipped count and rerun with the sandbox disabled.
- e2e cannot run on macOS 12 (e2e/INSIGHTS 2026-10-18; this host is Darwin 21.6), so T7 gets `skip-verify`.

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] `BlastRadiusResponse` contract
Owns: `server/src/vendor/shared/contracts/review-api.ts`, `client/src/vendor/shared/contracts/review-api.ts`, `server/test/contracts.test.ts`
Depends on: —
Skills: zod
Route: agent:haiku
Steps:
1. Test: in `contracts.test.ts`, `BlastRadiusResponse` parses a full payload, a degraded payload (`degraded_reason: 'index_partial'`) and `index_sha: null`. It rejects `degraded_reason: 'unknown'` and negative stats.
2. Add `BlastDegradedReason`, `BlastStats` and `BlastRadiusResponse` (import `BlastRadius` from `./brief.js`) to the server copy, then copy the file byte-for-byte to the client.
Acceptance: R6 contract — `diff` of the two copies is empty; the contracts test is green; `BlastRadius`/`PrBrief` are unchanged.
Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/contracts.test.ts && pnpm arch:check` · `cd client && pnpm typecheck` · `cd mcp && npm run typecheck`
Escalate if: the client copy of `review-api.ts` differs from the server copy before the edit.

## Wave 1 — parallel (disjoint Owns)

| File / glob | Task |
|---|---|
| `server/src/modules/blast/**`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/README.md`, `server/test/blast-{helpers,service,routes}.test.ts` | T2 |
| `server/src/db/seed.ts` | T3 |
| `client/src/app/repos/[repoId]/pulls/[number]/{page.tsx,_components/OverviewTab/**,_components/BlastRadiusCard/**}`, `client/src/lib/hooks/{blast.ts,blast.test.tsx,index.ts}`, `client/messages/en/blast.json` | T4 |
| `mcp/src/**` (listed files), `mcp/test/**` (listed files), `mcp/README.md` | T5 |

### T2 [P] [BE] `blast` module + route
Owns: `server/src/modules/blast/{routes,compose,service,ports,repository,helpers,domain,http-errors,types}.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/README.md`, `server/test/blast-helpers.test.ts`, `server/test/blast-service.test.ts`, `server/test/blast-routes.test.ts`
Depends on: T1
Skills: onion-architecture, fastify-best-practices, drizzle-orm-patterns, zod
Route: agent
Interfaces: provides the route, `container.blast`, `BlastService`, `toBlastRadiusResponse`, `deriveDegraded`; consumes `container.repoIntel.{getBlastRadius,getIndexState}`, `c.config.repoIntelEnabled`.
Steps:
1. Tests:
   - `blast-helpers`:
     - grouping by `viaSymbol`; caller `name` = row `symbol`;
     - dedupe of the same `file+line` within a symbol; the same caller under two symbols is kept in both;
     - caller sort (rank → file → line) and group sort (count → name);
     - a symbol without callers is absent from `downstream` but present in `changed_symbols`; `changed_symbols` dedupe;
     - per-symbol endpoints/crons from `factsByFile` (union, dedupe, sort); no `factsByFile` → `[]`;
     - `stats` and the exact `summary`, with and without degraded;
     - `index_sha` `''` → null;
     - the `deriveDegraded` precedence table, all 5 rows plus "degraded data still returned" (R2, R3, R5, R6).
   - `blast-service` (fakes):
     - unknown PR → `BlastDomainError('pr_not_found')` and no intel calls;
     - PR paths + `repoId` are passed to `getBlastRadius`;
     - empty paths → `getBlastRadius` is not called;
     - intel rejects → `degraded: true, degraded_reason: 'no_data'`, no throw.
   - `blast-routes` (`buildApp` with `overrides { auth: MockAuthProvider, blast: stub }`): 200 body parses as `BlastRadiusResponse` and the stub got `['w1', id]`; `pr_not_found` → 404; non-uuid → 400.
2. `domain.ts`, `types.ts` (`BlastFacade`), `ports.ts`, `repository.ts` (`BlastRepository implements BlastStore`: workspace-scoped `pull_requests` + `pr_files.path` read, writes nothing), `helpers.ts`, `service.ts`, `http-errors.ts`.
3. `compose.ts` `createBlastFacade(c)` (wires `c.repoIntel` and `c.config.repoIntelEnabled`); `routes.ts` calls `app.container.blast.get`; register `blast` in `modules/index.ts`; `container.blast` getter + `ContainerOverrides.blast`; add a `server/README.md` §API map row.
Acceptance: R2, R3, R5, R6 at unit level; the route reads stored data only and makes no LLM call.
Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/blast- --exclude '**/*.it.test.ts' && pnpm arch:check` (no violations beyond the 5 baseline)
Escalate if: arch:check flags the `import type` from `repo-intel/types.ts` in `ports.ts`/`helpers.ts`, or `RepoIntel` does not satisfy `BlastSource`.

### T3 [P] [BE] Seed repo-intel index rows for PR #482
Owns: `server/src/db/seed.ts`
Depends on: T1
Skills: drizzle-orm-patterns
Route: agent:haiku
Steps:
1. Insert the following rows only if `acme/payments-api` has no `repo_index_state` row:
   - `repo_index_state`:
     - `status 'full'`, `lastIndexedSha 'b1a5700000000000000000000000000000000482'`
     - `indexerVersion` = `INDEXER_VERSION` (from `modules/repo-intel/constants.ts`), `filesIndexed 12`
   - `symbols` declared in PR files:
     - `rateLimit` (function, `src/middleware/ratelimit.ts`, line 12, exported)
     - `TokenBucket` (interface, same file, line 3)
     - `getUserList` (function, `src/api/users.ts`)
   - Enclosing symbols in the caller files:
     - `registerPublicRoutes` (`src/api/public/index.ts` 1–60)
     - `listItems` (`src/api/public/items.ts` 20–50)
     - `healthRoute` (`src/api/public/health.ts` 5–20)
     - `buildServer` (`src/server.ts` 80–120)
     - `registerAdminRoutes` (`src/api/admin/index.ts` 1–40)
   - `references` with `declFile` set:
     - `rateLimit` ← `src/api/public/index.ts:23`, `src/api/public/items.ts:31`, `src/api/public/health.ts:11`, `src/server.ts:88`
     - `getUserList` ← `src/api/admin/index.ts:14`
   - `file_rank` for the 5 caller files only — never for a PR file.
   - `file_facts`:
     - `src/api/public/index.ts` → `['GET /api/public/items','POST /api/public/webhooks']`
     - `src/api/public/health.ts` → `['GET /api/public/health']`
     - `src/api/admin/index.ts` → `['GET /api/admin/users']`
     - `src/server.ts` → crons `['job:reset_rate_buckets']`
2. Re-run the seed twice on one DB; expect no duplicate `references`.
Acceptance: the seeded #482 blast is 3 symbols · 5 callers · 4 endpoints · 1 cron. `rateLimit` has 4 callers; `TokenBucket` has none. This is the input for T6/T7.
Verify: `cd server && pnpm typecheck && pnpm exec vitest run reviews.it.test.ts integration.it.test.ts smart-diff.it.test.ts intent.it.test.ts --no-file-parallelism` (Docker; sandbox disabled)
Escalate if: an existing it test asserts an empty repo map, empty caller signatures or an unindexed state for the seeded repo.

### T4 [P] [FE] Blast radius block on Overview + hook
Owns: `client/src/lib/hooks/blast.ts`, `client/src/lib/hooks/blast.test.tsx`, `client/src/lib/hooks/index.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/{BlastRadiusCard.tsx,BlastRadiusCard.test.tsx,constants.ts,styles.ts,index.ts}`, `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `client/messages/en/blast.json`
Depends on: T1
Skills: next-best-practices, react-best-practices, react-testing-library
Route: agent
Interfaces: consumes `GET /pulls/:id/blast-radius`, `useResyncRepoIntel`, `githubBlobUrl`; provides `useBlastRadius`, `BlastRadiusCard`, the extended `OverviewTab` props.
Steps:
1. Tests:
   - `blast.test.tsx` (fetch mocked): key `["blast", prId]`, URL `/pulls/<id>/blast-radius`, disabled without `prId`.
   - `BlastRadiusCard.test.tsx` (mock `@/lib/hooks/blast` and `@/lib/hooks/repo-intel` like `IntentCard.test.tsx`; messages `{ blast }`):
     - stats row numbers and labels;
     - symbol rows with `4 callers`;
     - caller link `href` = blob URL at `index_sha` with `#L23`, falling back to `headSha` when `index_sha` is null; plain text without `repoFullName`;
     - endpoint and cron chips under their symbol only;
     - `noDownstream` with the count;
     - `empty`;
     - degraded `index_partial` banner above the data, with a rebuild button that calls `mutate`, then `rebuildStarted`;
     - `flag_off` and `repo_too_large` show no button;
     - loading skeleton; error → retry calls `refetch` (R1–R5).
2. Hook + export; `blast.json` keys; `constants.ts` maps; `BlastRadiusCard` + styles.
3. `OverviewTab` renders `<BlastRadiusCard>` between `IntentCard` and Description; `page.tsx` passes `repoId`, `repoFullName`, `pr.head_sha`.
Acceptance: R1, R2, R3, R4, R5, R7.
Verify: `cd client && pnpm typecheck && pnpm exec vitest run src/app/repos src/lib/hooks`
Escalate if: a needed field is missing from `BlastRadiusResponse`, or a new `vendor/ui` primitive is needed.

### T5 [P] [BE] MCP `get_blast_radius` wired to the route
Owns: `mcp/src/app/ports.ts`, `mcp/src/adapters/http/api-client.ts`, `mcp/src/app/use-cases/get-blast-radius.ts`, `mcp/src/compose.ts`, `mcp/src/adapters/mcp/definitions.ts`, `mcp/src/adapters/mcp/tools/get-blast-radius.ts`, `mcp/test/fakes.ts`, `mcp/test/app/use-cases/get-blast-radius.test.ts`, `mcp/test/adapters/http/api-client.test.ts`, `mcp/test/adapters/mcp/tools/get-blast-radius.test.ts` (new), `mcp/test/protocol.call.test.ts`, `mcp/README.md`
Depends on: T1
Skills: onion-architecture, zod
Route: agent
Interfaces: provides `DevDigestApi.getBlastRadius`, `makeGetBlastRadius({api, resolver})`, `BlastRadiusView`; consumes `GET /pulls/:prId/blast-radius`.
Steps:
1. Tests:
   - use case (fakes): resolves repo + PR, returns the API body plus `repo`/`pr` unchanged; degraded `no_data` → rebuild hint; `flag_off` → flag hint; unknown PR → `PrNotFound`; an oversized payload → ≤ `MAX_RESPONSE_CHARS` with `truncated_callers` > 0.
   - api-client: URL + parse; a malformed body → `ApiError('http')`.
   - tool adapter: args → use case → `jsonResult`.
   - `protocol.call.test.ts`: replace the `not_implemented` case with a real payload; the 16k budget case still passes (R8).
2. Port + API client method; `fakes.ts` `getBlastRadius` default (empty, non-degraded).
3. Use case; `compose.ts` passes `{ api, resolver }`; new description in `definitions.ts`; `README.md` §Tools row.
Acceptance: R8 — the MCP payload equals the route body for the same PR (plus `repo`/`pr`); the `protocol.list` budget test is still ≤ 6000.
Verify: `cd mcp && npm run typecheck && npm run arch:check && npm test`
Escalate if: `@devdigest/shared` does not expose `BlastRadiusResponse` through the mcp alias, or the description pushes the list budget over 6000.

## Wave 2 — integration / e2e

### T6 [BE] blast integration test
Owns: `server/test/blast.it.test.ts`
Depends on: T2, T3
Skills: drizzle-orm-patterns
Route: agent
Steps:
1. Real pg + `seed`: `GET /pulls/<#482 id>/blast-radius` returns:
   - `stats {symbols:3, callers:5, endpoints:4, crons:1}`;
   - `downstream[0].symbol 'rateLimit'` with 4 callers, `src/api/public/index.ts` line 23 among them, endpoints incl. `GET /api/public/items`, crons `['job:reset_rate_buckets']`;
   - `degraded false`, `index_sha` = seeded sha.
2. Delete the repo's `repo_index_state` → `degraded true`, `degraded_reason 'no_data'`, empty `downstream`. An app built with `REPO_INTEL_ENABLED=false` → `flag_off`. A random uuid → 404.
Acceptance: R5, R6 end-to-end on Postgres.
Verify: `cd server && pnpm exec vitest run blast.it.test.ts` (sandbox disabled; check skipped = 0)

### T7 [FE] e2e: Overview shows the blast radius
Owns: `e2e/specs/02-repo-pulls-detail.flow.json`
Depends on: T2, T3, T4
Route: inline
Steps: after the intent quote step, add `wait --text` steps for `Blast radius`, `rateLimit`, `src/api/public/index.ts:23`, `GET /api/public/items` and `job:reset_rate_buckets`.
Acceptance: R1–R3 on seeded data.
Verify: `cd e2e && npm run e2e:hermetic` (skip-verify on this macOS 12 host — e2e/INSIGHTS 2026-10-18)

---

## Wave 3 — P3 views (user request 2026-10-23; client only, sequential)

Decisions:
- No contract/server change. The contract has endpoints/crons per *symbol*, not per caller, so the graph draws solid `symbol → caller` edges and **dashed** `symbol → endpoint/cron` edges (they are affected *via* that symbol's callers). It never invents caller→endpoint edges.
- No new dependency: hand-rolled SVG (`viewBox`, width 100%, scales down on phone width). Layout is a pure function so it is unit-testable without a DOM.
- The `Chip` primitive is a toggle button (`aria-pressed`) — fine for the Tree/Graph segmented toggle, but the plan keeps styled buttons in `styles.ts` for visual parity with the mock; either is acceptable.
- Existing `blast.json` keys `view.tree`, `view.graph`, `graph.empty`, `graph.ariaLabel` are reused (values may be capitalised: "Tree", "Graph"). New keys: `graph.legend.symbol` "changed symbol", `graph.legend.callers` "callers", `graph.legend.affected` "endpoints / crons affected", `graph.more` "+{count} more callers not shown", `tree.toggle` "Show or hide callers of {symbol}".

### T8 [FE] `BlastGraph` SVG view
Owns: `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastGraph/{BlastGraph.tsx,BlastGraph.test.tsx,layout.ts,layout.test.ts,styles.ts,index.ts}`, `client/messages/en/blast.json`
Depends on: T4
Skills: react-best-practices, react-testing-library
Route: agent
Interfaces: provides `BlastGraph({ downstream, repoFullName, sha }: { downstream: BlastRadiusResponse['downstream']; repoFullName: string | null; sha: string | null })` and pure `layoutBlastGraph(downstream, opts?) => { width, height, nodes: GraphNode[], edges: GraphEdge[], hiddenCallers: number }` with `GraphNode = { id, kind: 'symbol'|'caller'|'endpoint'|'cron', label, x, y, w, h, file?, line? }`, `GraphEdge = { from, to, dashed: boolean }`.
Steps:
1. Tests: `layout.test.ts` — three columns (symbol x < caller x < affected x); callers deduped by `name+file` across symbols with one edge per symbol; endpoint/cron nodes deduped; dashed edges only symbol→endpoint/cron; caps at `MAX_GRAPH_CALLERS` (30) with `hiddenCallers`; empty downstream → no nodes. `BlastGraph.test.tsx` — renders an `svg` with `role="img"` + `aria-label` from `graph.ariaLabel`; node labels visible (long labels truncated with `…`, full text in `<title>`); caller nodes link to `githubBlobUrl(...)` with `target=_blank rel="noopener noreferrer"` when repo+sha exist, plain otherwise; legend text; `graph.more` when callers are capped; `graph.empty` when downstream is empty.
2. `layout.ts` (pure, constants for column x, node size, gaps), `BlastGraph.tsx` (curved `path` edges, endpoint nodes blue border, cron nodes orange, symbol nodes accent, uses CSS vars from the theme), `styles.ts`, barrel; new `blast.json` keys.
Acceptance: R12.
Verify: `cd client && pnpm typecheck && pnpm exec vitest run src/app/repos`
Escalate if: the layout needs per-caller endpoints (contract change).

### T9 [FE] Collapsible tree + Tree/Graph toggle
Owns: `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/{BlastRadiusCard.tsx,BlastRadiusCard.test.tsx,BlastTree.tsx,constants.ts,styles.ts}`, `e2e/specs/02-repo-pulls-detail.flow.json`
Depends on: T8
Skills: react-best-practices, react-testing-library
Route: agent
Interfaces: consumes `BlastGraph`; provides `BlastTree({ downstream, repoFullName, sha })` (the current list, extracted).
Steps:
1. Tests (extend `BlastRadiusCard.test.tsx`, existing cases stay green): Tree is the default; symbol row is a `button` with `aria-expanded="true"` and `aria-label` from `tree.toggle`; clicking it hides that symbol's callers and chips only; toggle buttons `view.tree`/`view.graph` with `aria-pressed`; clicking Graph renders the graph (`role="img"`) and hides the tree; the toggle is hidden when `downstream` is empty; degraded banner and stats still render in both views.
2. Extract the list into `BlastTree.tsx` with per-symbol collapse state (`Set` of collapsed symbols, chevron icon); add the segmented toggle to the right of the stats row (`styles.ts`); `BlastRadiusCard` holds `view` state and renders `BlastTree` or `BlastGraph`.
3. e2e flow: after the existing blast steps add `find text Graph click` + `wait` for the graph aria-label, then switch back to Tree (keep `file:line` assertions on the Tree view).
Acceptance: R10, R11 (+ R1–R5 unchanged).
Verify: `cd client && pnpm typecheck && pnpm test` · e2e skip-verify (macOS 12)

---

## Execution (for the orchestrator)
Goal: every check below still runs; tokens are saved by not repeating work.

**Dispatch**
1. One `implementer` per task. Delegation message, in this order (the shared
   part first and byte-identical across a wave, so parallel workers hit the
   prompt cache; the task-specific part last):
   ```
   plan: specs/plans/blast-radius.md
   <wave notes: interfaces from earlier tasks, branch to ff-merge, known host limits>
   report: specs/plans/reports/blast-radius/T<n>.md
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
   and append the result to `specs/plans/reports/blast-radius/verify-<sha>.md`
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
   - `cd mcp && npm run typecheck && npm run arch:check && npm test`
   - `cd e2e && npm run e2e:hermetic` (if the host can run it — see `e2e/INSIGHTS.md`)
10. `/pr-self-review`, then record "Insight candidates" from the report files
    with `engineering-insights`.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | done | contract, 1383d84 |
| T2 | done | merged; non-uuid → 422 (app-wide validation handler), test asserts 4xx |
| T3 | done | merged; it suites 24/24 |
| T4 | done | merged; client 136/136 |
| T5 | done | merged; mcp 115/115 |
| T6 | done | blast.it 4/4, 0 skipped |
| T7 | done | inline, 68c4f65; skip-verify on macOS 12 |
| T8 | done | 9603b5a; client 147 |
| T9 | done | 8300bcc; client 152; e2e skip-verify |
