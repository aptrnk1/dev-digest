# Plan: DevDigest MCP server

Spec: `specs/mcp-server.md` · Modules: new `mcp/` (+ root docs, `.mcp.json`, CI workflow, `scripts/worktree-bootstrap.sh`) · Status: Approved

## Goal
An external agent (Claude Code, Cursor) connected over stdio can list reviewers, run a review on a PR and get compact findings plus a verdict, read accepted repo conventions, and call a stable `get_blast_radius` stub. It reaches DevDigest only through the existing HTTP API on :3001.
Not doing: real blast radius, Streamable HTTP/remote access/OAuth, MCP resources/prompts, any `server/` change (no new endpoint, contract or migration), cancelling runs from MCP, outputSchema/structuredContent.

## Architecture
`mcp/` is a standalone npm package set up like `reviewer-core`: no workspace; `@devdigest/shared` → `../server/src/vendor/shared` via tsconfig `paths` + a vitest alias; `zod` is force-aliased to `mcp/node_modules/zod`. The package follows the onion rings from `.claude/skills/onion-architecture` (server-scoped there; its rings and rules are applied here):
```
mcp/src/
  domain/   findings.ts · errors.ts                     pure rules, DomainError {code}
  app/      ports.ts · resolve.ts · use-cases/<uc>.ts   use cases over ports, return plain views
  adapters/ http/{api-client,errors}.ts                 outbound: implements DevDigestApi, ApiError
            memory/run-registry.ts                      outbound: implements RunStore
            mcp/{definitions,result,register}.ts        inbound: SDK, zod arg shapes, error → isError
            mcp/tools/<tool>.ts                         inbound: args → use case → jsonResult
  compose.ts                                            composition root: createServer(config, overrides?)
  index.ts                                              env + StdioServerTransport + compose
```
`index.ts` reads `DEVDIGEST_API_URL` and connects `createServer` to stdio. `compose.ts` builds the HTTP client, run registry, sleeper, clock, resolver and the five use cases, then `registerTools(server, useCases)`. A tool adapter validates flat args (zod shape from `definitions.ts`), applies defaults, calls its use case and returns `jsonResult(view)`. `toErrorResult` maps `DomainError`/`ApiError` to `{isError:true}` text. `server/` is not touched. The workspace comes from `LocalNoAuthProvider`: no headers, always the default workspace.

## Cross-task decisions
- **Contracts**: consumed read-only from `server/src/vendor/shared`. Runtime zod parse happens only in `adapters/http` (parse at the edge). `domain/` and `app/` use `import type` only. Types used: `Agent`, `Repo`, `PrMeta`, `ReviewRunResponse`, `RunSummary`, `ReviewRecord`/`FindingRecord`, `ConventionsList`, `ConventionCategory`, `Severity`, `Verdict`. No copy, and no edits to either `vendor/shared`.
- **Data**: none.
- **Endpoint mapping** (all exist today; workspace is implicit):
  | Tool | Calls |
  |---|---|
  | `list_agents` | `GET /agents` → `Agent[]`, keep `enabled === true` |
  | `run_agent_on_pr` | resolve (`GET /repos`, `GET /repos/:id/pulls`, `GET /agents`) → `POST /pulls/:prId/review {agentId}` → `ReviewRunResponse.runs[0].run_id` → poll `GET /pulls/:prId/runs` (`RunSummary.status`: `running\|done\|failed\|cancelled`, `.error`) → on `done`, `GET /pulls/:prId/reviews` and pick the review whose `run_id` matches |
  | `get_findings` | by run: `GET /pulls/:prId/runs` + `GET /pulls/:prId/reviews` filtered by `run_id`. By PR: resolve, then the same two calls, with the newest review (kind `review`) per agent, overlaid by a newer non-`done` run of that agent |
  | `get_conventions` | resolve repo → `GET /repos/:id/conventions` → `items` with `status === 'accepted'` (+ `category`) |
  | `get_blast_radius` | none (stub) |
  Polling uses `GET /pulls/:id/runs` because it is workspace-scoped, cheap and carries `status` + `error` from the moment the run is created. `/runs/:id/trace` is rejected: it is written only on completion (404 while running) and is not workspace-scoped.
- **Ring rules** (enforced by `mcp/.dependency-cruiser.cjs`, `npm run arch:check`, no baseline):
  1. `domain-is-pure`: `src/domain/**` imports nothing from `src/app`, `src/adapters`, `src/compose.ts`, `src/index.ts`, `@modelcontextprotocol/*` or `zod`.
  2. `core-contracts-type-only`: `src/domain/**` and `src/app/**` → `server/src/vendor/shared/**` must be `type-only`. The config needs `tsPreCompilationDeps: true` and `tsConfig` pointing at `mcp/tsconfig.json`, so the alias resolves.
  3. `app-no-infra`: `src/app/**` imports nothing from `src/adapters`, `src/compose.ts`, `src/index.ts`, `@modelcontextprotocol/*` or `zod`.
  4. `sdk-only-at-mcp-edge`: only `src/adapters/mcp/**`, `src/compose.ts` and `src/index.ts` import `@modelcontextprotocol/*`.
  5. `adapters-isolated`: an adapter folder doesn't import another adapter folder. The one exception is `adapters/mcp` → `adapters/http/errors.ts` (needed to map `ApiError`). No adapter imports `compose.ts`/`index.ts`.
  Also checked in review, not by the tool: `fetch` is called only in `adapters/http`, and stdout is written only by the transport.
- **Interfaces**:
  - `app/ports.ts`:
    - `interface DevDigestApi { listAgents(): Promise<Agent[]>; listRepos(): Promise<Repo[]>; listPulls(repoId: string): Promise<PrMeta[]>; startReview(prId: string, agentId: string): Promise<ReviewRunResponse>; listRuns(prId: string): Promise<RunSummary[]>; listReviews(prId: string): Promise<ReviewRecord[]>; listConventions(repoId: string): Promise<ConventionsList> }`
    - `RunRef = {prId: string; repo: string; pr: number; agent: string}`
    - `interface RunStore { remember(runId: string, ref: RunRef): void; lookup(runId: string): RunRef | undefined }`
    - `type Sleeper = (ms: number, signal?: AbortSignal) => Promise<void>`; `type Clock = () => number`
    - `type ProgressSink = (progress: number, total?: number) => Promise<void>`
    - `RunCtx = {signal: AbortSignal; progress?: ProgressSink}`
  - `domain/errors.ts`: `abstract class DomainError extends Error {code: DomainErrorCode}`. The message is the actionable next step. Codes: `repo_not_found`, `repo_bad_format`, `pr_not_found`, `agent_not_found`, `agent_ambiguous`, `agent_disabled`, `run_unknown`, `run_failed`, `bad_args`. There is one subclass per code; constructors take the data the message needs (e.g. `new RepoNotFound(repo, known: string[])`).
  - `domain/findings.ts`:
    - `CompactFinding = {id, severity, file, line, title, suggestion?, rationale?}`
    - `compactFindings(f: FindingRecord[], o: {severityMin?: Severity; detail: 'concise'|'full'; limit?: number}): {findings: CompactFinding[]; truncated: number}`
    - `countsBySeverity(f): Record<Severity, number>`
    - `deriveVerdict(apiVerdict: Verdict | null, f: FindingRecord[]): Verdict`
    - `toRunView(input: {run_id: string|null; agent: string; status: string; error?: string|null; review?: ReviewRecord}, o): RunView`
    - `fitBudget<T>(payload: T, maxChars?: number): T`
    - `SEVERITY_ORDER`, `MAX_FINDINGS = 50`, `MAX_RESPONSE_CHARS = 16000`
  - `app/resolve.ts`: `createResolver(api: Pick<DevDigestApi,'listRepos'|'listPulls'|'listAgents'>): Resolver` with methods:
    - `repo(repo: string): Promise<Repo>`
    - `pull(repo: Repo, pr: number): Promise<{id: string; number: number}>` (positive hits cached in the resolver instance)
    - `agent(agent: string, o: {enabledOnly: boolean}): Promise<Agent>`
  - `app/use-cases/*` (factories with narrow deps, returning plain views; no SDK types):
    - `makeListAgents({api: Pick<DevDigestApi,'listAgents'>}): () => Promise<AgentView[]>`
    - `makeRunReview({api: Pick<…,'startReview'|'listRuns'|'listReviews'>, resolver, runs: RunStore, sleep: Sleeper, now: Clock}): (i: {repo, pr, agent, timeoutS, severityMin?, detail}, ctx: RunCtx) => Promise<RunView | PendingRunView>`
    - `makeGetFindings({api: Pick<…,'listRuns'|'listReviews'>, resolver, runs: RunStore}): (i: {runId?, repo?, pr?, agent?, severityMin?, detail}) => Promise<RunView | PrFindingsView>`
    - `makeGetConventions({api: Pick<…,'listConventions'>, resolver}): (i: {repo, category?}) => Promise<ConventionsView>`
    - `makeGetBlastRadius(): (i: {repo, pr}) => Promise<{status: 'not_implemented'; hint: string}>`
    - `UseCases` = the record of these five functions (declared in `app/use-cases/index.ts`).
  - `adapters/http/api-client.ts`: `createApiClient(o: {baseUrl: string; fetch?: typeof fetch; timeoutMs?: number}): DevDigestApi`. The default timeout is 30 000 ms because `GET /repos/:id/pulls` syncs GitHub synchronously. `adapters/http/errors.ts`: `class ApiError extends Error {kind: 'unreachable'|'not_found'|'rate_limited'|'http'; status?: number; url: string}`.
  - `adapters/memory/run-registry.ts`: `class RunRegistry implements RunStore` (cap 200, oldest evicted).
  - `adapters/mcp/definitions.ts`: `TOOL_DEFS: Record<ToolName, {description: string; inputSchema: ZodRawShape; annotations: ToolAnnotations}>`, `SERVER_INSTRUCTIONS`, `DEFAULT_TIMEOUT_S = 300`, `MAX_TIMEOUT_S = 600`.
  - `adapters/mcp/result.ts`: `jsonResult(payload: unknown): CallToolResult` (one compact JSON `text` block); `toErrorResult(err: unknown, baseUrl: string): CallToolResult`.
  - `adapters/mcp/tools/<tool>.ts`: `export function <camel>Tool(uc: UseCases['<key>'], baseUrl: string): ToolCallback`. The callback parses args, applies defaults, builds `RunCtx` from SDK `extra` (`signal`, and a progress sink when `_meta.progressToken` is present), and returns `jsonResult`/`toErrorResult`.
  - `adapters/mcp/register.ts`: `registerTools(server: McpServer, uc: UseCases, baseUrl: string): void`.
  - `compose.ts`: `createServer(config: {baseUrl: string}, overrides?: Partial<{api: DevDigestApi; runs: RunStore; sleep: Sleeper; now: Clock}>): McpServer`.
- **Constraints**:
  - Tool args are flat scalars:
    - `repo: string` (`owner/name`, case-insensitive match on `Repo.full_name`); `pr: number int ≥1`; `agent: string` (case-insensitive id or name); `run_id: string`.
    - `timeout_s: int 5..600`, default 300; `severity_min: Severity` (`CRITICAL|WARNING|SUGGESTION`), default all; `detail: 'concise'|'full'`, default `concise`; `category: ConventionCategory`.
    - All `get_findings` args are optional; the use case checks the combination (`BadArgs`).
  - Annotations: `readOnlyHint: true` on four tools; `run_agent_on_pr` gets `readOnlyHint: false, destructiveHint: false, idempotentHint: false`. No `title`/outputSchema (token budget).
  - Budget:
    - `SERVER_INSTRUCTIONS` ≤ 4 lines; each description ≤ 3 sentences.
    - `JSON.stringify(tools/list result).length + instructions.length ≤ 6000` chars (1 500 tokens at chars/4).
    - Every tool response is ≤ 16 000 chars (`fitBudget`): fields are capped at title 200 / suggestion 400 / rationale 800 chars (with `…`), then tail findings move into `truncated`.
  - Findings:
    - Drop findings with `dismissed_at != null`.
    - Sort by severity (CRITICAL > WARNING > SUGGESTION), then `file` asc, then `start_line` asc. `line = start_line`.
    - Limit 50. `truncated > 0` adds `hint: "filter with severity_min"`.
    - `counts_by_severity` is computed before the `severity_min` filter and truncation.
    - Without `agent`, the 50 cap is shared across runs (newest first) and each run reports its own `truncated`.
  - Verdict: `ReviewRecord.verdict` when non-null, else CRITICAL → `request_changes`, other findings → `comment`, none → `approve` (the contract's `Verdict` enum).
  - Polling:
    - Backoff 1, 2, 3, 4, 5, 5, … s (`sleep`) until a terminal status or until `now()` passes `timeoutS`.
    - An aborted `ctx.signal` stops polling and does not cancel the run (no `/runs/:id/cancel`).
    - `ctx.progress` is called each poll when present.
    - Timeout → `PendingRunView {status:"running", run_id, hint:"call get_findings(run_id=…, repo=…, pr=…) later"}` (not an error).
    - `failed`/`cancelled` → `RunFailed` with `RunSummary.error` and the advice "check the agent's provider key in Settings or the run log in the UI".
  - Error texts (AC8, all `isError:true`, rendered by `toErrorResult`):
    - `ApiError` `unreachable` → `DevDigest API is not responding at <url>; start it with ./scripts/dev.sh`.
    - `rate_limited` → `rate limit hit (POST /pulls/:id/review allows 10/min); retry in a minute`.
    - `RepoNotFound` lists ≤10 known `full_name`s.
    - `PrNotFound` → `PR #N not found in owner/name; refresh the repo in the UI`.
    - `AgentNotFound`/`AgentAmbiguous`/`AgentDisabled` → `… call list_agents`.
    - `RunUnknown` → `run_id not started in this MCP session; pass repo and pr too`.
    - Anything else → a generic message, logged to stderr.
  - Logs go only to `console.error`. `DEVDIGEST_API_URL` defaults to `http://localhost:3001`.
  - Versions: `@modelcontextprotocol/sdk ~1.32.1` (peer zod `^3.25 || ^4`), `zod 3.25.76` (same as server/client), `dependency-cruiser ^17.4.3` (same as server), `typescript ^5.7.2`, `vitest ^2.1.8`, `tsx ^4.19.2`, `@types/node ^22.10.0`.
  - Tests mirror the rings: `test/domain/**` and `test/app/**` use the port fakes in `test/fakes.ts` (`fakeApi(overrides?)`, `memoryRunStore()`, `instantSleep`, `fakeClock()`, fixtures typed by the shared contracts); `test/adapters/http/**` injects `fetch`; `test/adapters/mcp/**` and the protocol tests go through `compose.createServer(…, overrides)` + `InMemoryTransport`.

## Risks
- Resolved (user, 2026-10-22): `get_findings(run_id)` uses option a. Runs started by this MCP process are found through `RunStore`; any other run needs `repo`+`pr` passed too (there is no API from `run_id` to PR). The timeout hint includes `repo`/`pr`. No `server/` endpoint is added.
- Assumption: the spec's `changes_requested` and `CRITICAL/HIGH` map to the contract's `request_changes` and `CRITICAL` (the severity enum has no HIGH; this matches the default `ci_fail_on: critical`).
- Assumption: dismissed findings are hidden. Disabled agents are hidden from `list_agents` and rejected by `run_agent_on_pr`, but are accepted by `get_findings(agent=…)`.
- Assumption: seeded reviews have `run_id: null` (seed inserts no `agent_runs`). `get_findings(repo, pr)` is therefore review-based and reports `run_id: null` for them.
- Assumption: the onion skill is server-scoped. Here it is applied by analogy: `compose.ts` replaces `Container`, and there are no modules, so the rules are per ring.
- dependency-cruiser must resolve `@devdigest/shared` outside `mcp/` through `tsConfig` for rule 2 to fire. T1 probes the rule with a deliberate violation before trusting it (server/INSIGHTS 2026-10-18).
- `GET /repos/:id/pulls` syncs GitHub and backfills up to 10 PRs per call (slow with a token). The resolver caches hits, and the HTTP client uses a 30 s timeout (T2).
- The global rate limit of 120/min per IP is shared with the web UI on localhost. Polling at ≤5 s backoff stays under ~15 req/min (T4).
- An MCP client tool timeout shorter than `timeout_s` can cut the call. Mitigation: progress notifications (T4). Documented in README (T8).
- `.mcp.json` runs `mcp/node_modules/.bin/tsx --tsconfig mcp/tsconfig.json mcp/src/index.ts` from the repo root. tsx must apply `paths` to imports from `server/src/vendor/shared` (incl. `zod`). T3's stdio test proves this or escalates.
- `scripts/worktree-bootstrap.sh` does not know `mcp/`. T1 adds it, so W1 worktrees get `mcp/node_modules`.

---

## Wave 0 — foundation (sequential)

### T1 [BE] Package scaffold, ports, domain, arch gate
Owns: `mcp/package.json`, `mcp/package-lock.json`, `mcp/tsconfig.json`, `mcp/vitest.config.ts`, `mcp/.dependency-cruiser.cjs`, `mcp/src/app/ports.ts`, `mcp/src/domain/errors.ts`, `mcp/src/domain/findings.ts`, `mcp/test/domain/findings.test.ts`, `mcp/test/domain/errors.test.ts`, `mcp/test/fakes.ts`, `.github/workflows/mcp.yml`, `scripts/worktree-bootstrap.sh`, `mcp/.gitignore`
Depends on: —
Skills: onion-architecture, zod, typescript-expert
Route: agent
Interfaces: provides `app/ports.ts`, `domain/errors.ts`, `domain/findings.ts`, `test/fakes.ts` (signatures above).
Steps:
1. Tests: `findings.test.ts`:
   - dismissed findings dropped; sort order; `severity_min`; limit 50 + `truncated` + hint; `rationale` only with `full`; `suggestion` omitted when null; counts computed pre-filter.
   - verdict from the API vs derived (CRITICAL / WARNING-only / none).
   - `fitBudget` keeps 50 long `full` findings ≤ 16 000 chars and raises `truncated`; `toRunView` shape.
   `errors.test.ts`: every subclass has its `code`, and its message names the next step (≤10 repos listed).
2. `package.json`:
   - `"type":"module"`, private.
   - scripts `typecheck`, `test`, `start` = `tsx --tsconfig tsconfig.json src/index.ts`, `arch:check` = `depcruise src --config .dependency-cruiser.cjs --output-type err`.
   - versions per Constraints; `npm install` → lockfile.
   `tsconfig.json`/`vitest.config.ts` mirror `reviewer-core` (both aliases).
3. `.dependency-cruiser.cjs` with rules 1–5. Probe: a temporary runtime `zod` import in `domain/` and a `@modelcontextprotocol` import in `app/` must each fail `arch:check`; remove them afterwards.
4. Implement `ports.ts`, `domain/*`, `test/fakes.ts`.
5. `.github/workflows/mcp.yml` copies `reviewer-core.yml` (paths `mcp/**`, `server/src/vendor/shared/**`, the workflow) with steps `npm ci`, `npm run typecheck`, `npm run arch:check`, `npm test`. Add `mcp` to `PACKAGES` in `worktree-bootstrap.sh`.
Acceptance: AC5 rules at the domain level (limit/truncated/verdict); arch gate in place and probed.
Verify: `cd mcp && npm run typecheck && npx vitest run test/domain && npm run arch:check`
Escalate if: SDK 1.32 rejects zod 3.25.76, shared contracts fail to typecheck under the mcp tsconfig, or depcruise cannot resolve `@devdigest/shared` for rule 2.

### T2 [BE] Outbound adapters + resolver
Owns: `mcp/src/adapters/http/api-client.ts`, `mcp/src/adapters/http/errors.ts`, `mcp/src/adapters/memory/run-registry.ts`, `mcp/src/app/resolve.ts`, `mcp/test/adapters/http/api-client.test.ts`, `mcp/test/adapters/memory/run-registry.test.ts`, `mcp/test/app/resolve.test.ts`
Depends on: T1
Skills: onion-architecture, zod
Route: agent
Interfaces: provides `createApiClient`, `ApiError`, `RunRegistry`, `createResolver`; consumes `DevDigestApi`, `RunStore`, domain errors.
Steps:
1. Tests:
   - `api-client` (injected fetch): each method hits the exact path/method/body from the endpoint mapping and parses with its contract. ECONNREFUSED or abort → `unreachable`; 404 → `not_found`; 429 → `rate_limited`; 500 `{error:{message}}` → `http` with that message.
   - `run-registry`: remember/lookup; eviction at 201.
   - `resolve` (fakeApi): repo is case-insensitive; unknown repo → `RepoNotFound` with ≤10 names; `shop` → `RepoBadFormat`; PR found or `PrNotFound`; a second `pull()` makes no API call; agent by id, by name (case-insensitive), `AgentAmbiguous`, `AgentNotFound`, `AgentDisabled` with `enabledOnly`.
2. Implement the three files.
Acceptance: AC8 (resolution errors, API failure kinds).
Verify: `cd mcp && npm run typecheck && npx vitest run test/adapters test/app/resolve.test.ts && npm run arch:check`
Escalate if: a needed field is missing from the shared contracts.

### T3 [BE] MCP inbound adapter, compose, entry, `list_agents`, `get_blast_radius`
Owns:
- `mcp/src/app/use-cases/index.ts`, `mcp/src/app/use-cases/list-agents.ts`, `mcp/src/app/use-cases/get-blast-radius.ts`
- `mcp/src/app/use-cases/{run-review,get-findings,get-conventions}.ts` (stubs with final factory signatures)
- `mcp/src/adapters/mcp/{definitions,result,register}.ts`
- `mcp/src/adapters/mcp/tools/{list-agents,get-blast-radius}.ts`
- `mcp/src/adapters/mcp/tools/{run-agent-on-pr,get-findings,get-conventions}.ts` (stubs)
- `mcp/src/compose.ts`, `mcp/src/index.ts`
- `mcp/test/app/use-cases/list-agents.test.ts`, `mcp/test/app/use-cases/get-blast-radius.test.ts`, `mcp/test/adapters/mcp/result.test.ts`, `mcp/test/protocol.list.test.ts`, `mcp/test/stdio.test.ts`

Depends on: T2
Skills: onion-architecture, zod, typescript-expert
Route: agent
Interfaces:
- Provides `UseCases`, `TOOL_DEFS`, `SERVER_INSTRUCTIONS`, `jsonResult`, `toErrorResult`, `registerTools`, `createServer`.
- Stub use cases throw `new Error('not implemented')`; stub tool adapters already call their use case, so W1 only fills them in. `compose.ts` wires all five with their final deps and is not edited in W1.
- SDK imports, only in `adapters/mcp`, `compose.ts` and `index.ts`: `McpServer` (`@modelcontextprotocol/sdk/server/mcp.js`), `StdioServerTransport` (`…/server/stdio.js`), `InMemoryTransport` (`…/inMemory.js`), `Client` (`…/client/index.js`), `StdioClientTransport` (`…/client/stdio.js`).
Steps:
1. Tests:
   - `protocol.list.test.ts` (compose + InMemoryTransport + Client): exactly 5 tools with the spec names; descriptions ≤3 sentences; no `inputSchema` property of type `object`/`array`; `readOnlyHint` true on all but `run_agent_on_pr`; instructions ≤4 lines; `JSON.stringify(listTools()).length + instructions.length ≤ 6000` (AC1, AC2).
   - `list-agents.test.ts`: only enabled agents, shaped `{id,name,description?,model}`, empty description omitted (AC3).
   - `get-blast-radius.test.ts`: `{status:"not_implemented", hint}` (AC7).
   - `result.test.ts`: every `DomainError` code and every `ApiError` kind → `isError:true` with the Constraints text; unknown error → generic; `jsonResult` is compact JSON.
   - `stdio.test.ts`: spawn `node_modules/.bin/tsx --tsconfig tsconfig.json src/index.ts` with `DEVDIGEST_API_URL` set to a closed port; `listTools` returns 5; `list_agents` returns the unreachable text with `isError:true`. This proves the path aliases work at runtime and that stdout carries only protocol.
2. Implement `definitions.ts`, `result.ts`, `register.ts`, `compose.ts`, `index.ts`, the two use cases + tool adapters, and the stubs.
Acceptance: AC1, AC2, AC3, AC7, AC8 (unreachable, error mapping).
Verify: `cd mcp && npm run typecheck && npx vitest run test/protocol.list.test.ts test/stdio.test.ts test/app/use-cases test/adapters/mcp && npm run arch:check`
Escalate if: the token budget cannot be met with ≤3-sentence descriptions, tsx does not apply `paths` to `server/src/vendor/shared` at runtime, or a rule in the arch gate blocks `register.ts`/`compose.ts`.

## Wave 1 — parallel (disjoint Owns)

| File | Task |
|---|---|
| `mcp/src/app/use-cases/run-review.ts`, `mcp/src/adapters/mcp/tools/run-agent-on-pr.ts`, `mcp/test/app/use-cases/run-review.test.ts`, `mcp/test/adapters/mcp/tools/run-agent-on-pr.test.ts` | T4 |
| `mcp/src/app/use-cases/get-findings.ts`, `mcp/src/adapters/mcp/tools/get-findings.ts`, `mcp/test/app/use-cases/get-findings.test.ts`, `mcp/test/adapters/mcp/tools/get-findings.test.ts` | T5 |
| `mcp/src/app/use-cases/get-conventions.ts`, `mcp/src/adapters/mcp/tools/get-conventions.ts`, `mcp/test/app/use-cases/get-conventions.test.ts`, `mcp/test/adapters/mcp/tools/get-conventions.test.ts` | T6 |

### T4 [P] [BE] `run_agent_on_pr` (use case `runReview` + tool adapter)
Owns: `mcp/src/app/use-cases/run-review.ts`, `mcp/src/adapters/mcp/tools/run-agent-on-pr.ts`, `mcp/test/app/use-cases/run-review.test.ts`, `mcp/test/adapters/mcp/tools/run-agent-on-pr.test.ts`
Depends on: T3
Skills: onion-architecture, zod
Route: agent
Interfaces: implements `makeRunReview` (signature fixed in T3); consumes `Resolver`, `toRunView`, `fitBudget`, `RunStore.remember`, `Sleeper`, `Clock`, `RunCtx`.
Steps:
1. Tests:
   - Use case (fakes, `fakeClock`, recording sleep):
     - `running → running → done` → `RunView` and sleeps of 1000, 2000.
     - `timeoutS` passed → `PendingRunView` with the hint.
     - `failed`/`cancelled` → `RunFailed` carrying the reason.
     - Aborted signal → no further API calls and no cancel.
     - The run is remembered in `RunStore`; `progress` is called each poll; `AgentDisabled` propagates.
   - Tool adapter: defaults (`timeout_s` 300, `detail` concise); `timeout_s` 601 → validation error; `ApiError('rate_limited')` → rate-limit text.
2. Implement both files.
Acceptance: AC4, AC8.
Verify: `cd mcp && npm run typecheck && npx vitest run test/app/use-cases/run-review.test.ts test/adapters/mcp/tools/run-agent-on-pr.test.ts && npm run arch:check`
Escalate if: `ReviewRunResponse.runs` is empty for a valid agent, a `done` run has no review with its `run_id`, or `compose.ts` needs a change.

### T5 [P] [BE] `get_findings` (use case + tool adapter)
Owns: `mcp/src/app/use-cases/get-findings.ts`, `mcp/src/adapters/mcp/tools/get-findings.ts`, `mcp/test/app/use-cases/get-findings.test.ts`, `mcp/test/adapters/mcp/tools/get-findings.test.ts`
Depends on: T3
Skills: onion-architecture, zod
Route: agent
Interfaces: implements `makeGetFindings`; consumes `Resolver`, `toRunView`, `fitBudget`, `RunStore.lookup`. Output: by run → `RunView`; by PR → `PrFindingsView {repo, pr, runs: RunView[]}`.
Steps:
1. Tests:
   - Use case:
     - A `runId` in the store → view; `runId` + `repo` + `pr` (not in the store) → view.
     - An unknown `runId` alone → `RunUnknown`; a still-running run → `status:"running"` with no findings.
     - `repo`+`pr`+`agent` → newest review of that agent; `repo`+`pr` → newest review per agent, with a newer `failed` run shown as `failed` + error.
     - A review with `run_id: null` (seed) is included; 60 findings → 50 + `truncated:10`.
     - No args, or `repo` without `pr` → `BadArgs`.
   - Tool adapter: maps `run_id`/`severity_min`/`detail`; `BadArgs` → `isError` with usage.
2. Implement both files.
Acceptance: AC5, AC8.
Verify: `cd mcp && npm run typecheck && npx vitest run test/app/use-cases/get-findings.test.ts test/adapters/mcp/tools/get-findings.test.ts && npm run arch:check`
Escalate if: `compose.ts` needs a change.

### T6 [P] [BE] `get_conventions` (use case + tool adapter)
Owns: `mcp/src/app/use-cases/get-conventions.ts`, `mcp/src/adapters/mcp/tools/get-conventions.ts`, `mcp/test/app/use-cases/get-conventions.test.ts`, `mcp/test/adapters/mcp/tools/get-conventions.test.ts`
Depends on: T3
Skills: onion-architecture, zod
Route: agent:haiku
Interfaces: implements `makeGetConventions`. Output: `ConventionsView {repo, conventions: [{category, rule, path, line}], truncated?, hint?}` with `path = evidence_path` and `line = evidence_line`.
Steps:
1. Tests:
   - Use case:
     - Only `accepted` items; `category` filter.
     - Empty → hint `run extraction in the UI: Skills Lab → Conventions`; scan `running` → hint that extraction is in progress.
     - >60 items → 60 + `truncated` + hint `pass category`; unknown repo → `RepoNotFound`.
   - Tool adapter: invalid `category` → validation error.
2. Implement both files.
Acceptance: AC6, AC8.
Verify: `cd mcp && npm run typecheck && npx vitest run test/app/use-cases/get-conventions.test.ts test/adapters/mcp/tools/get-conventions.test.ts && npm run arch:check`
Escalate if: needs a file outside Owns.

## Wave 2 — integration / docs

### T7 [P] [BE] Protocol `tools/call` test for every tool
Owns: `mcp/test/protocol.call.test.ts`
Depends on: T4, T5, T6
Skills: onion-architecture
Route: agent:haiku
Steps:
1. `createServer({baseUrl}, {api: fakeApi(…), sleep: instantSleep, now: fakeClock()})` + InMemoryTransport:
   - `tools/call` on happy fixtures returns parseable JSON text with the documented keys for all 5 tools.
   - Unknown repo → `isError:true`.
   - Every response is ≤16 000 chars.
Acceptance: AC3–AC8 end-to-end through the SDK.
Verify: `cd mcp && npm run typecheck && npm run arch:check && npm test`

### T8 [P] [SHARED] Docs + registration
Owns: `mcp/README.md`, `mcp/CLAUDE.md`, `mcp/INSIGHTS.md`, `.mcp.json`, `README.md`, `CLAUDE.md`, `TESTING.md`
Depends on: T4, T5, T6
Skills: mermaid-diagram, onion-architecture
Route: agent:haiku
Steps:
1. `mcp/README.md`:
   - purpose; a ring diagram (Mermaid) plus the import rules and `npm run arch:check`.
   - a tool table with args/outputs; the endpoint mapping; error texts; env (`DEVDIGEST_API_URL`).
   - the client tool-timeout note; the `run_id` session limitation.
   - a manual live smoke: `./scripts/dev.sh`, then in Claude Code `list_agents` → `run_agent_on_pr` on seeded `#482`.
2. `mcp/CLAUDE.md` in the `reviewer-core/CLAUDE.md` shape:
   - where each ring lives, and that new tools need a use case in `app/use-cases/` + an adapter in `adapters/mcp/tools/` + a line in `compose.ts`.
   - npm, not pnpm; stdout is protocol-only; no DB, API only; keep both aliases; `arch:check` must stay clean (no baseline).
   `mcp/INSIGHTS.md` = empty template sections.
3. `.mcp.json`: `mcpServers.devdigest` = `{type:"stdio", command:"mcp/node_modules/.bin/tsx", args:["--tsconfig","mcp/tsconfig.json","mcp/src/index.ts"], env:{DEVDIGEST_API_URL:"http://localhost:3001"}}`.
4. Root files:
   - `CLAUDE.md`: Map row + Commands line `cd mcp && npm run typecheck && npm run arch:check && npm test`.
   - `README.md`: Architecture mention + Useful scripts/Testing.
   - `TESTING.md`: suite-map row (`mcp`, unit + protocol, vitest, `mcp.yml`, no Docker).
Acceptance: AC9.
Verify: `jq . .mcp.json >/dev/null && cd mcp && npm test`
Escalate if: root docs need a structural rewrite beyond adding rows/lines.

---

## Execution (for the orchestrator)
Goal: every check below still runs; tokens are saved by not repeating work.

**Dispatch**
1. One `implementer` per task. Delegation message, in this order (the shared
   part first and byte-identical across a wave, so parallel workers hit the
   prompt cache; the task-specific part last):
   ```
   plan: specs/plans/mcp-server.md
   <wave notes: interfaces from earlier tasks, branch to ff-merge, known host limits>
   report: specs/plans/reports/mcp-server/T<n>.md
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
   and append the result to `specs/plans/reports/mcp-server/verify-<sha>.md`
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
   - `cd mcp && npm run typecheck && npm run arch:check && npm test`
   - `cd server && pnpm typecheck` (shared contracts untouched — sanity only)
10. `/pr-self-review`, then record "Insight candidates" from the report files
    with `engineering-insights`.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | done | typecheck · arch:check (probed) · 25 tests; + mcp/.gitignore; rule 5 split in two |
| T2 | done | 19 tests; id match beats name; PR without id → not found |
| T3 | done | 61 tests; loose registrar (TS2589); orchestrator added ZodError→invalid-args in result.ts (+1 test); tools/list+instructions = 3140 chars (~785 tok) |
| T4 | done | 11 tests; abort → pending view; done-without-review → verdict null (not escalated) |
| T5 | done | 11 tests; nullable agent/status handled with fallbacks; adapter unchanged from T3 |
| T6 | done | 10 tests; agent hit turn limit after finishing code — orchestrator verified + fixed stale comment; fitBudget not used (60-item cap only) |
| T7 | done | 9 protocol tests; full suite 103 |
| Review | done | arch-reviewer APPROVE_WITH_CONCERNS → fixes (A1 RunNotStarted, A3 typed shapes via satisfies, conventions char budget) → delta APPROVE; plan-verifier COMPLETE → delta COMPLETE; A2 accepted |
| T8 | done | docs + .mcp.json; root CLAUDE.md: Map row + Commands line only; jq absent → validated with python3 |
