# Plan: PR Why + Risk Brief — бриф PR на вкладці Overview

Spec: `specs/2026-10-24-pr-risk-brief.md` · Modules: server, client, e2e · Execution mode: multi-agent · Status: Approved

## Goal
Рев'юер на вкладці Overview натискає Generate brief і отримує збережений у `pr_brief` бриф: підсумок, ризики з файлами й severity, Review focus `файл:рядок — причина` (клік відкриває Files changed на цьому файлі), явні missing inputs і ознаку застарілого intent; після перезавантаження бриф показується без нового LLM-виклику.
Not doing: банер вердикту/score і вартість генерації, розгортання `explanation`, іконки за `kind`, «Prior PRs», зміни Files changed понад перехід до файла (перемикач Smart order, «What this does», підсвітка рядка), MCP-тул, seed-бриф, автогенерація, виведення intent під час брифу, стан «генерація триває» після перезавантаження, будь-які зміни `INJECTION_GUARD` / grounding gate / Blast radius / Intent (картка Intent і її risk-чипи без змін).

## Architecture
Новий модуль `server/src/modules/brief/` за зразком `intent` + `onboarding`: routes → compose → service → ports → repository, плюс чисті `facts.ts` / `prompt.ts` / `validate.ts`. Сервіс збирає факти лише через фасади контейнера: `container.intent.get` (новий, read-only), `container.blast.get`, `container.smartDiff.facts` (новий: ролі + якорі findings за правилом Smart Diff), `container.runContext.resolveForRepo` (новий: спеки всіх увімкнених агентів). Потім один `completeStructured` (модель `risk_brief`, провайдер з `container.llmWithLimits`, власний повтор ≤ 1 у сервісі), перевірка посилань і ліміти, upsert `pr_brief.json`. Нової таблиці/міграції немає. Клієнт: хуки `src/lib/hooks/brief.ts`, компоненти `BriefCard` / `BriefRisks` / `ReviewFocus` в `OverviewTab`, deep-link `?tab=diff&file=&line=` читає `DiffTab` сам; `page.tsx` не змінюється.

## Cross-task decisions
- **Contracts** (обидві копії `vendor/shared/contracts/brief.ts`, T1):
  - `BlastDegradedReason` переноситься з `review-api.ts` у `brief.ts` (секція Blast radius) — інакше цикл імпорту `review-api.ts → brief.ts → review-api.ts`; `review-api.ts` імпортує його з `./brief.js` і більше не визначає. Ім'я й експорт з barrel ті самі (D-a).
  - `BriefMissingInput = z.enum(['intent','blast','specs','review_findings'])`
  - `BriefBlast = { summary: string, caller_files: string[], degraded_reason: BlastDegradedReason | null }`
  - `ReviewFocusItem = { file: string, line: int, reason: string }`
  - `PrBrief = { summary: string, intent: Intent | null, intent_stale: boolean, blast: BriefBlast | null, risks: Risks, review_focus: ReviewFocusItem[], history: PrHistory (default { history: [] }), missing_inputs: BriefMissingInput[], head_sha: string, generated_at: string (ISO datetime), model: string, cost_usd: number | null }` — ім'я `PrBrief` лишається (реекспорт у `client/src/lib/types.ts:40`).
  - `PrBriefState = { brief: PrBrief | null, stale: boolean }`
- **Data**: без змін схеми. `pr_brief (pr_id PK, json jsonb)` — один рядок на PR, `json` = повний `PrBrief`; upsert `ON CONFLICT (pr_id) DO UPDATE`.
- **Interfaces** (server):
  - `GET /pulls/:id/brief` → 200 `PrBriefState` · 404 `pr_not_found` · 422 (не-uuid)
  - `POST /pulls/:id/brief` (без body) → 200 `PrBrief` · 404 · 409 `brief_in_progress` · 422 `llm_not_configured` · 502 `brief_failed`
  - `IntentFacade.get(workspaceId: string, prId: string): Promise<PrIntentState>` — делегує наявному `IntentService.get`, без LLM (D-d)
  - `RunContextFacade.resolveForRepo(input: RepoContextInput, log: ContextLog): Promise<RunProjectContext>`, `RepoContextInput = { workspaceId: string; repoId: string; repo: RepoRef; clonePath: string | null; base: string }`; новий метод порту `AttachmentStore.listEnabledAgentIds(workspaceId: string): Promise<string[]>` (за `agents.created_at` asc) (D-c)
  - `SmartDiffFacade.facts(workspaceId: string, prId: string): Promise<SmartDiffFacts>`, `SmartDiffFacts = { files: { path: string; role: SmartDiffRole }[] /* порядок відображення Smart Diff */; findings: { file: string; start_line: number; severity: Severity; title: string }[] /* selectFindings */; reviewed: boolean /* ≥ 1 рев'ю PR */ }`; `FindingRef` отримує `title: string` (D-b)
  - Brief ports (`brief/ports.ts`, T6): `BriefStore { loadPull(ws, prId): Promise<BriefPull | undefined>; getBriefJson(prId): Promise<unknown | undefined>; upsertBrief(prId, brief: PrBrief): Promise<void> }`; `BriefPull = { id, title, body: string | null, headSha, base, repoId, repo: RepoRef, clonePath: string | null, files: { path, additions, deletions, patch: string | null }[] }`; `IntentSource = Pick<IntentFacade,'get'>`; `BlastSource = { get(ws, prId): Promise<BlastRadiusResponse> }`; `DiffFactsSource = Pick<SmartDiffFacade,'facts'>`; `SpecSource = Pick<RunContextFacade,'resolveForRepo'>`; `ModelResolver = (ws) => Promise<{ model: string; provider: LLMProvider }>` (кидає `BriefDomainError('llm_not_configured')`); `TokenCounter { count(text): number }`; `Clock = () => Date`
  - `BriefDomainError(code: 'pr_not_found' | 'brief_in_progress' | 'llm_not_configured' | 'brief_failed')` → `http-errors.ts`: 404 / 409 / 422 / 502 (`AppError(code, msg, status)`)
  - `BriefService.get(ws, prId): Promise<PrBriefState>` · `BriefService.generate(ws, prId): Promise<PrBrief>`
  - client: `usePrBrief(prId): UseQueryResult<PrBriefState, ApiError>` (key `["pr-brief", prId]`), `useGenerateBrief(prId): UseMutationResult<PrBrief, ApiError, void>` (onSuccess → `setQueryData(["pr-brief", prId], { brief, stale: false })`)
  - client components: `BriefCard({ prId })`, `BriefRisks({ risks: Risk[] })`, `ReviewFocus({ items: ReviewFocusItem[] })`; `FileCard` новий проп `target?: boolean`; `SmartDiffGroup` / `DiffViewer` новий проп `targetPath?: string | null`
- **Constraints** (`brief/constants.ts`):
  - LLM: `timeoutMs: 45_000` на спробу, ≤ 2 спроби (власний цикл у сервісі; провайдер `llmWithLimits(provider, { maxRetries: 0, timeoutMs: 45_000 })`, `completeStructured({ maxRetries: 0 })`) (D-e). Повтор — на будь-яку помилку, крім `llm_not_configured`; після двох — `brief_failed`.
  - `BriefDraft` (structured output) — `.strict()` на кожному об'єкті: `{ summary, risks: { kind, title, explanation, severity: high|medium|low, file_refs: string[] }[], review_focus: { file, line: int, reason }[] }` (AC48).
  - Вхід: ≤ 100 файлів (у порядку `SmartDiffFacts.files`), ≤ 20 діапазонів `+c,d` на файл, ≤ 30 якорів (severity desc → path → line), опис ≤ 4000 символів, спеки ≤ 8000 токенів (через `resolveForRepo`), промпт ≤ 20 000 токенів (`container.tokenizer`); понад бюджет — відкидати файли з кінця списку (D-j).
  - Вихід: відкинути focus поза файлами/діапазонами нової сторони, file_refs поза changed ∪ caller files, ризики без refs → перші 6 ризиків і 6 focus → обрізання по code point: summary 600, reason 200, title 120, explanation 500, kind 40.
  - Blast: `degraded && 0 symbols && 0 callers` → `blast: null` + missing; інакше `{ summary, caller_files: унікальні файли викликачів у порядку появи, degraded_reason }`.
  - Lock: in-memory `Set<prId>` у єдиному екземплярі сервісу (створюється раз у `routes.ts`), знімається у `finally` (D-f).
  - Одне `now()` на генерацію для `generated_at`.
  - Hunk-діапазони — лише числа з `@@ -a,b +c,d @@`; текст після другого `@@` і рядки patch у промпт не йдуть.
- **UI strings** (`client/messages/en/brief.json`, namespace `brief`, володіє T2; існуючі ключі не видаляти): `title` «PR Brief», `block.risks` → «Risks by file», `unavailable` (без змін), `unavailableHint` → «Generate a brief from the PR's intent, blast radius, diff stats and attached specs.», `noRisks` (без змін), `generate` «Generate brief», `generating` «Generating brief…», `refresh` «Regenerate brief», `stale` «Outdated», `staleHint` «The PR changed since this brief was generated.», `missingInputs` «Generated without: {list}», `input.intent` «intent», `input.blast` «blast radius», `input.specs` «attached specs», `input.review_findings` «review findings», `intentStale` «Generated from an outdated intent — re-derive the intent and regenerate the brief.», `severity.high|medium|low` «High severity» / «Medium severity» / «Low severity», `focus.title` «Review focus — read these first», `noFocus` «No specific lines to start with.», `error.title` «Couldn't load the brief», `error.body` «The PR brief could not be loaded.», `generateError.notConfigured` «No LLM key for the Risk Brief model — add one in Settings → Feature Models.», `generateError.inProgress` «A brief is already being generated for this PR.», `generateError.generic` «Could not generate the brief. Try again.», `fileNotInDiff` «{file} is not in the current diff.». Без `<word>` у значеннях.
- **UI layout**: порядок Overview — PR Brief, рядок Intent + Blast (`display: grid; grid-template-columns: repeat(auto-fit, minmax(472px, 1fr)); gap: 16px` — одна колонка при ширині < 960 px, D-i), «Risks by file», Review focus, Description. Risks і Focus рендеряться лише коли `brief` є; skeleton / ErrorState / empty — лише в блоці PR Brief (D-g). Колір severity: high `var(--crit)`, medium `var(--warn)`, low `var(--text-secondary)`; одна іконка (`AlertTriangle`) для всіх `kind`. Перелік severity — локальна константа `satisfies Record<RiskSeverity, …>`, без runtime-імпорту з `@devdigest/shared` (client/INSIGHTS).
- **Deep-link**: пункт Review focus — `<a href>` з `onClick` → `preventDefault` + `router.replace(\`${pathname}?tab=diff&file=<enc>&line=<n>\`)` (інші query-параметри відкидаються, D-h). `DiffTab` читає `file` через `useSearchParams`; збіг — точне порівняння шляху.

## Requirements review
- **Clarified**: режим виконання → multi-agent (користувач).
- **Clarified** (вирішено за кодом, користувач не заперечив):
  - D-a `BlastDegradedReason` → `brief.ts` (цикл імпорту) — AC1.
  - D-b `container.smartDiff.facts` замість імпорту `selectFindings` з чужого модуля; `FindingRef.title` — AC54, AC40.
  - D-c `container.runContext.resolveForRepo` — об'єднання вкладень агентів — AC42, AC39.
  - D-d `container.intent.get` — read-only, без виведення — AC36, AC51.
  - D-e власний цикл повтору в сервісі, провайдер з `maxRetries: 0`, `BriefDraft.strict()` — AC6, AC27, AC48.
  - D-f in-memory lock у сервісі; без міграції — AC8.
  - D-g Risks/Focus не рендеряться без брифу — AC9, AC15, AC18.
  - D-h `<a href>` + `router.replace`, інші параметри відкидаються; `page.tsx` не змінюється — AC17, AC28.
  - D-i grid `minmax(472px, 1fr)` — AC19.
  - D-j обрізання файлів з кінця, якщо промпт > 20 000 токенів — NFR3.
- **Recommendations**: немає.
- **Spec updates needed**: —

## Risks
- Assumption: `container.smartDiff.facts` / `container.intent.get` кидають лише `pr_not_found` або інфраструктурні помилки; PR перевіряється першим, тож інші помилки йдуть як 500. `resolveForRepo`, що кинув, вважається «спек немає» (`specs` у missing, `logger.info`, не `error` — server/INSIGHTS про best-effort збагачення).
- Assumption: `blast.get` сам перетворює збій repo-intel на degraded-відповідь (`no_data`), тож brief не ловить його окремо.
- Assumption: файл, що є в `pr_files`, але не в `SmartDiffFacts.files`, іде в промпт без ролі (`role: null`) у кінці списку.
- Assumption: параметр `file` лишається в URL після перемикання вкладок (наявний `setParam` у `page.tsx` його не чистить), тож повернення на Files changed повторить перехід — прийнятно.
- Assumption: клієнтський `apiFetch` не має таймауту, тож NFR2 (клієнт не обриває запит раніше 100 с) виконується тим, що хук не передає `signal`; T7 перевіряє це тестом.
- `scripts/check.sh server arch` у worktree дає хибні legacy-помилки `drizzle-only-in-repositories` (server/INSIGHTS) — перезапустити в main checkout перед тим, як вважати провалом.
- `check.sh server it` у sandbox self-skip-ається (server/INSIGHTS) — запускати без sandbox; «all skipped» — не pass (T4, T12).
- `depcruise` не ловить імпорт модульних адаптерів (`brief/repository.ts`) у `service.ts` (server/INSIGHTS) — T10 перевіряє імпорти `service.ts` вручну.
- Обрізання тексту — по code point (server/INSIGHTS про lone surrogate у jsonb) — T6 має тест з емодзі на межі.
- Manual check: AC19 — розробник звіряє розміщення Intent і Blast radius поруч із D1 на seed-PR #482 при ширині вікна 1440 px і 900 px (при 900 px — один під одним) перед мержем.
- Manual check: NFR6 — розробник проходить флоу Generate → Review focus → Files changed лише клавіатурою (Tab / Enter, фокус на заголовку FileCard) перед мержем.

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] Контракти `PrBrief` / `PrBriefState` (обидві копії)
Owns: `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`, `server/src/vendor/shared/contracts/review-api.ts`, `client/src/vendor/shared/contracts/review-api.ts`, `server/test/contracts.test.ts`
Depends on: —
Skills: zod
Route: agent
Interfaces: `BlastDegradedReason`, `BriefMissingInput`, `BriefBlast`, `ReviewFocusItem`, `PrBrief`, `PrBriefState` — точно як у Cross-task decisions.
Steps:
1. Test: `server/test/contracts.test.ts` — `PrBrief` парсить повний бриф; `history` за замовчуванням `{ history: [] }`; `intent: null`, `blast: null` допустимі; `missing_inputs` з невідомим значенням і severity поза `high|medium|low` — помилка; `PrBriefState.parse({ brief: null, stale: false })`; `BlastDegradedReason` і далі доступний з barrel.
2. Перенести `BlastDegradedReason` у `brief.ts` (обидві копії), у `review-api.ts` замінити визначення на імпорт з `./brief.js`.
3. Замінити `PrBrief` новою формою, додати `PrBriefState` поруч; обидві копії байт-ідентичні.
Acceptance:
- AC1 [unit] `PrBrief` в обох копіях має рівно поля зі спеки; тест контракту зелений.
- Типи `BlastRadiusResponse`, `BlastDegradedReason`, `PrBrief` компілюються в server і client без змін споживачів.
Verify: `scripts/check.sh server typecheck test test/contracts.test.ts` · `scripts/check.sh client typecheck` · `scripts/check.sh mcp typecheck`
Escalate if: `BlastDegradedReason` імпортується напряму з `review-api.js` поза barrel; mcp typecheck падає через контракт.

### T2 [FE] Рядки `brief.json`
Owns: `client/messages/en/brief.json`
Depends on: —
Skills: —
Route: inline
Steps:
1. Додати/змінити ключі namespace `brief` дослівно зі списку UI strings у Cross-task decisions; існуючі ключі (`block.intent`, `intent.*`, `why.*`, …) не чіпати.
Acceptance:
- Усі ключі зі списку UI strings присутні з точним текстом; жоден наявний ключ не видалено; немає `<word>` у значеннях; JSON валідний.
- Наявні тести IntentCard зелені.
Verify: `scripts/check.sh client typecheck test "src/app/repos/[repoId]/pulls/[number]/_components/IntentCard"`
Escalate if: ключ уже використовується з іншим значенням деінде в client.

## Wave 1 — parallel (disjoint Owns)

Owns-таблиця хвилі: T3 → `server/src/modules/intent/{types,compose}.ts`; T4 → `server/src/modules/context/{run-context.service,types,ports,repository}.ts`, `server/test/context-run.test.ts`, `server/test/context-run.it.test.ts`; T5 → `server/src/modules/smart-diff/{types,service,compose}.ts`, `server/test/smart-diff-service.test.ts`; T6 → `server/src/modules/brief/{constants,domain,ports,facts,prompt,validate,helpers}.ts` + 3 тести; T7 → `client/src/lib/hooks/{brief.ts,brief.test.tsx,index.ts}`, `…/_components/BriefCard/**`; T8 → `…/_components/BriefRisks/**`, `…/_components/ReviewFocus/**`; T9 → `…/_components/DiffTab/**`, `client/src/components/diff-viewer/{FileCard,DiffViewer}/**`.

### T3 [BE] `container.intent.get` — read-only стан intent
Owns: `server/src/modules/intent/types.ts`, `server/src/modules/intent/compose.ts`
Depends on: T1
Skills: onion-architecture
Route: inline
Interfaces: provides `IntentFacade.get(workspaceId, prId): Promise<PrIntentState>`.
Steps:
1. Test: наявний `server/test/intent-service.test.ts` покриває `IntentService.get`; новий тест не потрібен (обгортка в один рядок).
2. Додати `get` в `IntentFacade` (`types.ts`) і в `createIntentFacade` → `service.get(workspaceId, prId)`.
Acceptance:
- `container.intent.get` повертає те саме, що `GET /pulls/:id/intent`, без LLM-виклику; `ensure` / `renderForPrompt` без змін.
Verify: `scripts/check.sh server typecheck arch test test/intent-service.test.ts`
Escalate if: потрібна зміна `IntentService`.

### T4 [P] [BE] `container.runContext.resolveForRepo` — спеки всіх увімкнених агентів
Owns: `server/src/modules/context/run-context.service.ts`, `server/src/modules/context/types.ts`, `server/src/modules/context/ports.ts`, `server/src/modules/context/repository.ts`, `server/test/context-run.test.ts`, `server/test/context-run.it.test.ts`
Depends on: T1
Skills: onion-architecture, drizzle-orm-patterns
Route: agent
Interfaces: provides `RunContextFacade.resolveForRepo(input: RepoContextInput, log: ContextLog): Promise<RunProjectContext>`, `AttachmentStore.listEnabledAgentIds(workspaceId): Promise<string[]>`.
Steps:
1. Test: `server/test/context-run.test.ts` (фейки порту) — два агенти: порядок за `created_at`, усередині агента — власні, потім через скіли (`mergeAttachments`); дублікат шляху лишає перше входження; спільний бюджет 8000 токенів і ті самі правила пропуску (missing / > `MAX_DOC_BYTES` / budget); немає вкладень / немає клону / немає `origin/<base>` → `specs: []`; вимкнений агент не враховується.
2. Test: `server/test/context-run.it.test.ts` — новий кейс: два увімкнені агенти з вкладеннями на одному репо, один вимкнений → `resolveForRepo` читає об'єднаний список з `origin/<base>`; наявні кейси без змін.
3. `repository.ts`: `listEnabledAgentIds(ws)` — `agents.enabled = true`, `workspace_id = ws`, `ORDER BY created_at, id`.
4. `run-context.service.ts`: винести цикл читання/бюджету з `resolveForRun` у приватний метод; `resolveForRepo` = агенти → `loadForRun` + `mergeAttachments` на кожного → dedupe → той самий цикл; один підсумковий рядок логу.
Acceptance:
- AC42 [unit] [it] об'єднання вкладень увімкнених агентів без дублікатів, по агентах за `created_at`, усередині — порядок рев'ю, читання з `origin/<base>`, ≤ 8000 токенів.
- `resolveForRun` поводиться як раніше (наявні тести зелені).
Verify: `scripts/check.sh server typecheck arch test test/context-run.test.ts` · `scripts/check.sh server it context-run.it.test.ts`
Escalate if: потрібна зміна `mergeAttachments` у `context/domain.ts` або схеми.

### T5 [P] [BE] `container.smartDiff.facts` — ролі й якорі findings
Owns: `server/src/modules/smart-diff/types.ts`, `server/src/modules/smart-diff/service.ts`, `server/src/modules/smart-diff/compose.ts`, `server/test/smart-diff-service.test.ts`
Depends on: T1
Skills: onion-architecture
Route: agent
Interfaces: provides `SmartDiffFacade.facts(ws, prId): Promise<SmartDiffFacts>` (форма — Cross-task decisions); `FindingRef.title: string`.
Steps:
1. Test: `server/test/smart-diff-service.test.ts` — `facts`: `files` у порядку груп `get()` з роллю; `findings` — найновіше рев'ю на агента, без dismissed, лише файли PR, з `title`; `reviewed: false` без рев'ю, `true` при рев'ю з 0 findings; невідомий PR → `SmartDiffDomainError('pr_not_found')`.
2. `types.ts`: `title` у `FindingRef`, тип `SmartDiffFacts`, метод у `SmartDiffFacade`.
3. `service.ts`: `facts()` перевикористовує `loadPullFiles`, `listForPull`, ранги, `buildSmartDiff`, `selectFindings` (domain.ts не змінюється — `title` проходить через spread); `compose.ts` — прокинути метод.
Acceptance:
- AC54 [unit] якорі добираються за правилом Smart Diff (найновіше рев'ю кожного агента, без dismissed, лише файли PR), рядок — `start_line`, з `title`.
- AC40 [unit] `reviewed` розрізняє «немає рев'ю» і «рев'ю з 0 findings».
- Відповідь `GET /pulls/:id/smart-diff` не змінилась (наявні тести зелені).
Verify: `scripts/check.sh server typecheck arch test test/smart-diff-service.test.ts test/smart-diff-domain.test.ts test/smart-diff-routes.test.ts`
Escalate if: потрібно змінити `smart-diff/domain.ts` або контракт `SmartDiff`.

### T6 [P] [BE] Чисте ядро brief: факти, промпт, перевірка відповіді
Owns: `server/src/modules/brief/constants.ts`, `server/src/modules/brief/domain.ts`, `server/src/modules/brief/ports.ts`, `server/src/modules/brief/facts.ts`, `server/src/modules/brief/prompt.ts`, `server/src/modules/brief/validate.ts`, `server/src/modules/brief/helpers.ts`, `server/test/brief-facts.test.ts`, `server/test/brief-prompt.test.ts`, `server/test/brief-validate.test.ts`
Depends on: T1
Skills: onion-architecture, zod, security
Route: agent
Interfaces:
- provides `ports.ts` і `BriefDomainError` (Cross-task decisions); constants з Constraints.
- `hunkRanges(patch: string | null): { start: number; count: number }[]` — нова сторона `+c,d` (d за замовчуванням 1).
- `buildFacts(input: { pull: BriefPull; intent: PrIntentState; blast: BlastRadiusResponse; diff: SmartDiffFacts; specs: RunProjectContext }): BriefFacts` → `{ facts, missing: BriefMissingInput[], intentStale: boolean, intent: Intent | null, blast: BriefBlast | null, files: Map<string, {start,count}[]>, callerFiles: Set<string> }`.
- `BriefDraft` (zod, `.strict()`), `buildBriefMessages(facts: BriefFacts, tokens: TokenCounter): ChatMessage[]`.
- `sanitizeDraft(draft: BriefDraft, ctx: { files: Map<string, {start,count}[]>; callerFiles: Set<string> }): Pick<PrBrief, 'summary' | 'risks' | 'review_focus'>`, `truncateCodePoints(s: string, max: number): string`.
- `parseStoredBrief(json: unknown): PrBrief | null`, `toBriefBlast(r: BlastRadiusResponse): BriefBlast | null`.
Steps:
1. Test: `server/test/brief-facts.test.ts` — `hunkRanges` (кілька hunk-ів, `+c` без `,d`, `+c,0`); немає intent → `intent: null` + `intent` у missing; stale intent → використано, `intentStale: true`; blast degraded + 0/0 → `null` + missing; degraded з даними → збережено з `degraded_reason`, не missing; не degraded 0/0 → порожні `caller_files`, не missing; `specs: []` → `specs` у missing; `reviewed: false` → `review_findings` у missing, `reviewed: true` + 0 findings → не missing; якорі: сортування severity → path → line, ≤ 30; ≤ 100 файлів, ≤ 20 діапазонів.
2. Test: `server/test/brief-prompt.test.ts` — промпт містить усі факти зі спеки (intent-поля, blast, файли з ролями й `+c,d`, title/опис ≤ 4000, спеки, якорі, `missing_inputs`, `intent_stale` з інструкцією назвати їх у summary); жодного рядка patch і тексту після другого `@@` (фікстура з унікальними маркерами в коді й у заголовку hunk-а); кожне repo/LLM-значення лише всередині `<untrusted>` (`wrapUntrusted`) + нагадування після блоків; фікстура 300 файлів × 100 findings → ≤ 100 файлів, ≤ 30 якорів, промпт ≤ 20 000 токенів (реальний токенайзер).
3. Test: `server/test/brief-validate.test.ts` — `BriefDraft` відкидає зайве поле і severity поза enum; focus з файлом не з PR або рядком поза діапазонами відкидається; file_ref (`path`, `path:N`, `path:N-M`) поза changed ∪ callers прибирається, ризик без refs відкидається; ≥ 7 ризиків/пунктів → перші 6 у порядку моделі; обрізання по code point (емодзі на межі не дає lone surrogate); `parseStoredBrief` на битому/старому JSON → `null`.
4. Реалізувати файли; `prompt.ts` — системні інструкції константою (як `intent/prompt.ts`), без `INJECTION_GUARD`-змін; обрізання файлів з кінця при > 20 000 токенів.
Acceptance:
- AC34 [unit] у промпт ідуть рівно перелічені факти.
- AC35 [unit] жодного рядка `patch` чи тексту після другого `@@`.
- AC36 [unit] без збереженого intent — `intent: null`, `intent` у missing (без LLM у фактах).
- AC37 [unit] degraded без даних → `blast: null`, `blast` у missing.
- AC38 [unit] пункти focus поза файлами/діапазонами відкидаються.
- AC39 [unit] порожні спеки → `specs` у missing.
- AC40 [unit] немає рев'ю → `review_findings` у missing; рев'ю з 0 findings — ні.
- AC41 [unit] `missing_inputs` і `intent_stale` передаються з інструкцією.
- AC43 [unit] і AC44 [unit] file_refs поза PR/callers прибираються, ризик без refs відкидається.
- AC45 [unit] перші 6 / 6 і ліміти по code point.
- AC47 [unit] усі repo/GitHub/LLM-значення лише в `<untrusted>` + нагадування.
- AC48 [unit] зайве поле або severity поза enum — невалідна відповідь.
- AC51 [unit] застарілий intent використовується, `intent_stale: true`.
- AC53 [unit] і AC55 [unit] degraded з даними / не degraded порожній blast зберігаються, не missing.
- AC54 [unit] ≤ 30 якорів, severity → path → line.
- AC5 [unit] `parseStoredBrief` повертає `null` на JSON, що не проходить схему.
- NFR3: фікстура 300 файлів / 100 findings → ліміти й ≤ 20 000 токенів.
Verify: `scripts/check.sh server typecheck arch test test/brief-facts.test.ts test/brief-prompt.test.ts test/brief-validate.test.ts`
Escalate if: потрібен імпорт з `modules/smart-diff|intent|context` поза їхніми `types.ts`; потрібна зміна reviewer-core.

### T7 [P] [FE] Хуки брифу і блок PR Brief
Owns: `client/src/lib/hooks/brief.ts`, `client/src/lib/hooks/brief.test.tsx`, `client/src/lib/hooks/index.ts`, `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/**`
Depends on: T1, T2
Skills: react-best-practices, client-testing
Route: agent
Interfaces: provides `usePrBrief`, `useGenerateBrief` (Cross-task decisions), `BriefCard({ prId }: { prId: string | null })`.
Steps:
1. Test: `client/src/lib/hooks/brief.test.tsx` — GET `/pulls/:id/brief`; mutation POST без `signal`/таймауту; onSuccess кладе `{ brief, stale: false }` у кеш; монтування `usePrBrief` не робить POST.
2. Test: `…/_components/BriefCard/BriefCard.test.tsx` (next-intl з `messages/en/brief.json`) — loading → skeleton; GET-помилка → ErrorState `brief.error.title` + Retry повторює запит; немає брифу → `unavailable`, `unavailableHint`, кнопка `Generate brief`, без POST до кліку; клік → кнопка disabled «Generating brief…», після успіху summary з'являється без reload; регенерація — попередній summary видимий; бриф є → кнопка з доступною назвою «Regenerate brief» робить POST; `stale` → бейдж «Outdated» з `staleHint`; `missing_inputs` → «Generated without: intent, blast radius»; `intent_stale` → рядок `intentStale` одразу після рядка missing; 422 `llm_not_configured` / 409 `brief_in_progress` / 502 / мережевий збій → відповідні тексти під кнопкою, попередній бриф лишається; summary з `<b>` і `**x**` рендериться як текст; сирих ключів немає.
3. Реалізувати хуки (додати в `hooks/index.ts`) і `BriefCard` (SectionLabel `brief.title`, права частина — бейдж stale + кнопка refresh; патерн IntentCard без авто-генерації). design: `specs/designs/2026-10-24-pr-risk-brief/D1.png` (секція «PR BRIEF», без банера вердикту).
Acceptance:
- AC9 [unit] skeleton під час GET.
- AC10 [unit] порожній стан з текстом, підказкою і кнопкою.
- AC11 [unit] відкриття лише читає (GET), POST тільки після кліку.
- AC12 [unit] summary з'являється після успіху без reload.
- AC20 [unit] рядок «Generated without: …».
- AC21 [unit] і AC22 [unit] disabled «Generating brief…», попередній бриф видимий.
- AC23 [unit] бейдж Outdated з підказкою.
- AC24 [unit] ErrorState з Retry.
- AC25 [unit] кнопка оновлення з доступною назвою робить POST.
- AC26 [unit] текст `notConfigured` на 422.
- AC33 [unit] текст `inProgress` на 409.
- AC46 [unit] summary як звичайний текст.
- AC50 [unit] generic-текст на інші помилки, попередній бриф лишається.
- AC52 [unit] рядок intentStale під рядком missing.
- NFR2 (клієнт): POST без таймауту/AbortSignal. NFR7: тест не бачить сирих ключів.
Verify: `scripts/check.sh client typecheck test src/lib/hooks/brief.test.tsx "src/app/repos/[repoId]/pulls/[number]/_components/BriefCard"`
Escalate if: потрібна зміна `src/lib/api.ts` або `page.tsx`.

### T8 [P] [FE] Блоки «Risks by file» і Review focus
Owns: `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefRisks/**`, `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocus/**`
Depends on: T1, T2
Skills: react-best-practices, next-best-practices, client-testing
Route: agent
Interfaces: provides `BriefRisks({ risks: Risk[] })`, `ReviewFocus({ items: ReviewFocusItem[] })`; ReviewFocus використовує `useRouter` / `usePathname` з `next/navigation`.
Steps:
1. Test: `…/BriefRisks/BriefRisks.test.tsx` — заголовок «Risks by file»; рядок = `title` + перший `file_refs` моноширинним текстом (не `<a>`); однакова іконка для різних `kind`; колір за severity і доступна назва «High/Medium/Low severity»; 0 ризиків → `noRisks`; `title` з HTML — текстом.
2. Test: `…/ReviewFocus/ReviewFocus.test.tsx` — заголовок `focus.title` з лічильником; пункти в порядку `items` у форматі `<file>:<line> — <reason>`; кожен пункт — role link; клік і Enter → `router.replace` з `?tab=diff&file=<encoded>&line=<n>` поточного шляху PR; 0 пунктів → `noFocus`; `reason` з HTML — текстом.
3. Реалізувати компоненти. design: `specs/designs/2026-10-24-pr-risk-brief/D1.png` («RISK AREAS» — як окремий блок, «REVIEW FOCUS — READ THESE FIRST»).
Acceptance:
- AC13 [unit] окремий блок «Risks by file», `title` + перший file_ref звичайним моноширинним текстом.
- AC14 [unit] одна іконка, колір за severity, доступна назва severity.
- AC15 [unit] `noRisks` при 0 ризиків.
- AC16 [unit] заголовок, лічильник, порядок і формат пунктів.
- AC17 [unit] пункт — посилання, активується мишею й Enter.
- AC18 [unit] `noFocus` при 0 пунктів.
- AC28 [unit] перехід на URL з `tab=diff&file=&line=`.
- AC46 [unit] `title`, `reason` і шляхи — звичайний текст.
Verify: `scripts/check.sh client typecheck test "src/app/repos/[repoId]/pulls/[number]/_components/BriefRisks" "src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocus"`
Escalate if: потрібні дані поза пропсами (хуки брифу) або зміна `page.tsx`.

### T9 [P] [FE] Files changed: перехід до файла за `?file=`
Owns: `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/**`, `client/src/components/diff-viewer/FileCard/**`, `client/src/components/diff-viewer/DiffViewer/**`
Depends on: T2
Skills: react-best-practices, client-testing
Route: agent
Interfaces: `FileCard` проп `target?: boolean` (відкрити, `scrollIntoView` заголовка, фокус на заголовку з `tabIndex={-1}`; один раз на монтування з `target`); `DiffViewer` / `SmartDiffGroup` проп `targetPath?: string | null` (група з цільовим файлом відкрита); `DiffTab` читає `useSearchParams().get("file")`; helper `matchTarget(files: PrFile[], file: string | null): string | null` у `DiffTab/helpers.ts`.
Steps:
1. Test: `…/DiffTab/helpers.test.ts` — `matchTarget`: точний збіг, немає параметра, невідомий шлях.
2. Test: `…/DiffTab/DiffTab.test.tsx` — з `file` у згорнутій Boilerplate-групі й згорнутому FileCard → обидва розгорнуті, `scrollIntoView` викликано, `document.activeElement` — заголовок FileCard; Smart Diff ще не завантажено → те саме в плаському списку; Smart Diff довантажився → один повторний перехід у групах; невідомий `file` → інфо-рядок «{file} is not in the current diff.», стан груп і файлів без змін.
3. Test: `client/src/components/diff-viewer/FileCard/FileCard.test.tsx` — `target` відкриває великий файл і фокусує заголовок; без `target` поведінка як раніше.
4. Реалізувати. design: `specs/designs/2026-10-24-pr-risk-brief/D2.png` (лише ціль переходу; решта макета — non-goal).
Acceptance:
- AC29 [unit] група й FileCard розгортаються, заголовок у видимій області.
- AC30 [unit] фокус клавіатури на заголовку FileCard.
- AC31 [unit] перехід у плаському списку, поки Smart Diff не завантажився або впав.
- AC32 [unit] інфо-рядок для невідомого `file`, стан не змінено.
- AC49 [unit] один повторний перехід після переходу на групи.
Verify: `scripts/check.sh client typecheck test "src/app/repos/[repoId]/pulls/[number]/_components/DiffTab" src/components/diff-viewer`
Escalate if: потрібна зміна `page.tsx` або підсвітка рядка.

## Wave 2 — service, routes, Overview wiring

### T10 [P] [BE] Сервіс brief, репозиторій, маршрути, реєстрація
Owns: `server/src/modules/brief/service.ts`, `server/src/modules/brief/repository.ts`, `server/src/modules/brief/compose.ts`, `server/src/modules/brief/routes.ts`, `server/src/modules/brief/http-errors.ts`, `server/src/modules/index.ts`, `server/test/brief-service.test.ts`, `server/test/brief-routes.test.ts`, `server/README.md`
Depends on: T3, T4, T5, T6
Skills: onion-architecture, fastify-best-practices, drizzle-orm-patterns
Route: agent
Interfaces: consumes `container.intent.get`, `container.blast.get`, `container.smartDiff.facts`, `container.runContext.resolveForRepo`, `container.llmWithLimits`, `container.tokenizer`, `resolveFeatureModel(c, ws, 'risk_brief')` (як `onboarding/compose.ts`); provides `BriefService.get` / `generate`, маршрути з Interfaces.
Steps:
1. Test: `server/test/brief-service.test.ts` (фейки портів, мок-провайдер з лічильником) — `get`: немає рядка → `{ brief: null, stale: false }`; битий JSON → `brief: null`; `head_sha` ≠ PR → `stale: true`; 0 LLM-викликів. `generate`: невідомий PR → `pr_not_found` без LLM (і для `get`); рівно 1 виклик з моделлю `risk_brief` (override і дефолт реєстру); невалідна відповідь → 2-й виклик → успіх; дві невдачі / таймаут 45 с → `brief_failed`, `upsertBrief` не викликано; немає ключа → `llm_not_configured`; паралельний `generate` того самого PR → `brief_in_progress` без другого виклику, lock знято після помилки; без intent — жодного виклику intent-виведення; `resolveForRepo` кинув → `specs` у missing; збережений бриф має `head_sha` PR, `generated_at` з одного `now()`, `model`, `cost_usd`.
2. Test: `server/test/brief-routes.test.ts` (`app.inject` + `ContainerOverrides`) — GET/POST статуси 200 / 404 / 409 / 422 / 502 і тіла помилок; не-uuid `:id` → 422.
3. `repository.ts` (Drizzle: `pull_requests` ⋈ `repos` + `pr_files`; `pr_brief` select / upsert); `service.ts` (порядок: PR → lock → факти → модель → ≤ 2 спроби → `sanitizeDraft` → upsert → unlock у `finally`); `http-errors.ts`; `compose.ts` (єдине місце з Container, `ConfigError` → `llm_not_configured`); `routes.ts` створює сервіс один раз; рядок у `modules/index.ts`; §API map у `server/README.md`.
Acceptance:
- AC3 [unit] GET без брифу → 200 `{ brief: null, stale: false }`.
- AC4 [unit] 404 на GET і POST для чужого/невідомого PR без LLM.
- AC5 [unit] невалідний JSON у `pr_brief` → `brief: null`.
- AC6 [unit] рівно один structured-запит (≤ 1 повтор) з моделлю `risk_brief`.
- AC8 [unit] 409 `brief_in_progress` без другого виклику.
- AC26 [unit] 422 `llm_not_configured` без ключа.
- AC27 [unit] 502 `brief_failed` після таймауту / невалідної відповіді з повтором, рядок не змінено.
- AC36 [unit] без intent — без додаткового LLM-виклику.
- AC39 [unit] і AC40 [unit] missing `specs` / `review_findings` у збереженому брифі.
- AC51 [unit] `intent_stale: true` при застарілому intent.
- NFR2 (сервер): таймаут 45 с на спробу, ≤ 2 спроби. NFR4: 0 LLM-викликів на GET, 1 (+≤ 1) на POST.
- `service.ts` не імпортує `repository.ts`, `drizzle-orm`, `fastify`, Container (перевірено вручну + `arch`).
Verify: `scripts/check.sh server typecheck arch test test/brief-service.test.ts test/brief-routes.test.ts`
Escalate if: потрібна зміна `container.ts`, схеми БД, `INJECTION_GUARD` чи grounding; потрібен файл з T6 Owns.

### T11 [P] [FE] Overview: порядок блоків і рядок Intent + Blast
Owns: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/**`
Depends on: T7, T8
Skills: react-best-practices, client-testing
Route: agent
Interfaces: consumes `BriefCard`, `BriefRisks`, `ReviewFocus`, `usePrBrief`; `OverviewTab` props без змін.
Steps:
1. Test: `…/OverviewTab/OverviewTab.test.tsx` — з брифом порядок у DOM: PR Brief → рядок (Intent, Blast radius) → «Risks by file» → Review focus → Description; без брифу / під час завантаження Risks і Focus не рендеряться; монтування не робить POST.
2. Реалізувати: `BriefCard` першим, обгортка-grid для `IntentCard` + `BlastRadiusCard` (стиль з UI layout у `styles.ts`), далі `BriefRisks` / `ReviewFocus` з `usePrBrief(prId).data?.brief`. design: `specs/designs/2026-10-24-pr-risk-brief/D1.png`.
Acceptance:
- AC19 [unit] порядок блоків у DOM; розміщення поруч / один під одним — Manual check у Risks.
- Наявні тести IntentCard і BlastRadiusCard зелені.
Verify: `scripts/check.sh client typecheck test "src/app/repos/[repoId]/pulls/[number]/_components"`
Escalate if: потрібна зміна `IntentCard` або `BlastRadiusCard`.

## Wave 3 — integration / e2e

### T12 [P] [BE] Інтеграційний тест brief (Postgres)
Owns: `server/test/brief.it.test.ts`
Depends on: T10
Skills: drizzle-orm-patterns
Route: agent
Steps:
1. Test: `server/test/brief.it.test.ts` (testcontainers, migrate + seed, `ContainerOverrides.llmWithLimits` → мок-провайдер) — POST для PR #482 → 200, рядок `pr_brief` з `head_sha` PR; повторний POST перезаписує той самий рядок; GET → той самий бриф, лічильник LLM не зріс; провайдер, що кидає (обидві спроби) → 502, рядок байт-ідентичний попередньому; 20 GET-запитів до #482 зі збереженим брифом → p95 ≤ 300 мс.
Acceptance:
- AC2 [it] GET повертає збережений бриф без LLM-виклику.
- AC7 [it] успішна генерація зберігає один рядок на PR з поточним `head_sha` і повертає той самий `PrBrief`.
- AC27 [it] збій провайдера → 502, `pr_brief` без змін.
- NFR1: p95 GET ≤ 300 мс на 20 запитах. NFR5: збій генерації не змінює збережений бриф.
Verify: `scripts/check.sh server it brief.it.test.ts`
Escalate if: тести self-skip-аються (Docker недоступний у sandbox) — перезапустити без sandbox, не вважати pass.

### T13 [P] [FE] e2e: порожній стан PR Brief на seed-PR #482
Owns: `e2e/specs/12-pr-brief.flow.json`
Depends on: T11
Skills: —
Route: agent:haiku
Steps:
1. Flow за зразком `e2e/specs/02-repo-pulls-detail.flow.json`: відкрити `/` → PR #482 → `wait --text "Brief not available yet."`, `wait --text "Generate brief"`, `wait --text "Intent"`, `wait --text "Blast radius"`. Кнопку не натискати (жодного LLM).
Acceptance:
- AC10 [e2e] на seed-PR #482 видно «Brief not available yet.» і кнопку «Generate brief».
- Наявні флоу 02 і 05 не змінено.
Verify: `cd e2e && npm run e2e:hermetic`
Escalate if: seed кладе щось у `pr_brief`.

---

## Execution
Run with `/run-plan plan: specs/plans/2026-10-24-pr-risk-brief.md` — the procedure
(dispatch, merge + gate + commit per wave, review, fix loop, finish) lives in
`.claude/skills/run-plan/references/execute.md` and `review-fix.md`.
Plan-specific notes for the orchestrator (host limits, skip-verify, ordering)
go here:
- T13: `skip-verify` на macOS 12 (agent-browser не стартує, e2e/INSIGHTS) — флоу перевіряється в CI (`e2e-web.yml`).
- T4, T12: `check.sh server it` запускати без sandbox; «all skipped» — не pass.
- `scripts/check.sh server arch` з worktree може давати хибні legacy-помилки — перевіряти в main checkout після merge.
- T3 і T2 — `inline`, виконуються в main checkout до/разом із dispatch [P]-задач своєї хвилі.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | todo | |
| T2 | todo | |
| T3 | todo | |
| T4 | todo | |
| T5 | todo | |
| T6 | todo | |
| T7 | todo | |
| T8 | todo | |
| T9 | todo | |
| T10 | todo | |
| T11 | todo | |
| T12 | todo | |
| T13 | todo | |
