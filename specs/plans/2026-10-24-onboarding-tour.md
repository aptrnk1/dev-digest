# Plan: Onboarding Tour — згенерований тур по незнайомому репозиторію

Spec: `specs/2026-10-24-onboarding-tour.md` · Modules: server, client, e2e · Execution mode: multi-agent · Status: Approved

## Goal
Користувач відкриває `/repos/:repoId/tour`, генерує (або перегенеровує) тур активного репо одним LLM-викликом у фоні й читає п'ять секцій: Architecture overview з діаграмою, Critical paths, How to run locally, Guided reading path, First tasks. Усі шляхи перевірено в клоні, команди мають перевірене джерело, Open веде на GitHub, copy і Share link копіюють у буфер. Seed дає готовий тур для `acme/payments-api`.
Not doing: MCP-тул, бейдж «тур застарів», позначки прочитання, scroll-spy, показ моделі/вартості, перегляд файлів у DevDigest, історію версій туру, задачі з issues/TODO, автогенерацію, інші мови, будь-які зміни reviewer-core (зокрема `OpenRouterProvider`, `INJECTION_GUARD`, grounding), інші пункти сайдбару з D1, зміни `e2e/specs/06-onboarding.flow.json`.

## Architecture
Новий модуль `server/src/modules/onboarding/` за зразком `conventions` (202 → фонова генерація → polling, завислий запуск після 10 хв = `failed`): routes → compose → service → ports → repository + `fs-source.ts` (вихідний адаптер ФС клону) і чисті `input.ts` / `prompt.ts` / `validate.ts` / `classify.ts`. Маршрути беруть `container.onboarding(app.log)` (lazy-фасад + override, як `container.blast`), тож route-тести обходяться без БД. На кожен HTTP-запит до провайдера сервіс бере окремий провайдер з `container.llmWithLimits(id, { maxRetries: 0, timeoutMs: <залишок 180 с> })`. Повтор (≤ 1) робить сам сервіс, тож ліміт «≤ 2 запити» рахується в одному місці. reviewer-core не змінюється: для `openrouter` фабрика передає наявні опції конструктора `OpenRouterProvider` (`maxRetries`, `timeoutMs`). Клієнт: хуки в `src/lib/hooks/onboarding.ts`, сторінка `src/app/repos/[repoId]/tour/`, картки секцій у `tour/_components/sections/`, пункт сайдбару в `vendor/ui/nav.ts`.

## Cross-task decisions
- **Contracts** (обидві копії `vendor/shared/contracts/knowledge.ts`; заготовки `Onboarding`, `OnboardingSection`, `OnboardingLink` замінюються, це урок L05):
  - `OnboardingIndexStatus = 'full' | 'partial' | 'degraded' | 'failed' | 'none'`; `OnboardingNodeKind = 'external' | 'entry' | 'module' | 'middleware' | 'datastore'`
  - `OnboardingTour = { commit_sha: string /^[0-9a-f]{40}$/, generated_at: string, files_indexed: int ≥ 0, index_status, architecture: { summary: string ≤ 800, diagram: { nodes: { id, label ≤ 40, kind, path: string | null }[] ≤ 12, edges: { from, to }[] ≤ 20 } }, critical_paths: { path, description ≤ 140 }[] ≤ 8, run_steps: { command ≤ 500, source_path }[] ≤ 10, reading_path: { path, why ≤ 140 }[] ≤ 8, first_tasks: { title ≤ 80, description ≤ 140, size: 'S' | 'M', files: string[] 1–3 }[] ≤ 5 }`
  - `OnboardingJob = { status: 'running' | 'done' | 'failed', error: string ≤ 200 | null, started_at: string, finished_at: string | null }`
  - `OnboardingTourResponse = { job: OnboardingJob | null, tour: OnboardingTour | null }`; `OnboardingGenerateResponse = { job: OnboardingJob }`
- **Data** (`server/src/db/schema/context.ts`, таблиця `onboarding`, міграція лише через `pnpm db:generate`): `json` → nullable; `generated_at` → nullable, без default. Нові колонки: `status text enum(running|done|failed) NOT NULL default 'running'`, `error text NULL`, `started_at timestamptz NOT NULL defaultNow`, `finished_at timestamptz NULL`, `run_id uuid NOT NULL defaultRandom`. Колонки не видаляються.
- **Interfaces**:
  - `GET /repos/:id/onboarding` → 200 `OnboardingTourResponse` · 404 · 422 (не-uuid)
  - `POST /repos/:id/onboarding/generate` → 202 `OnboardingGenerateResponse` · 404 · 409 `repo_not_cloned` · 409 `onboarding_in_progress` · 422 `llm_not_configured`
  - `container.llmWithLimits(id: 'openai' | 'anthropic' | 'openrouter', limits: LlmLimits): Promise<LLMProvider>`, де `LlmLimits = { maxRetries: number; timeoutMs: number }`. Без кешу; `ConfigError`, якщо ключа немає. Override: `ContainerOverrides.llmWithLimits?: (id, limits) => LLMProvider`.
  - `container.onboarding(logger: OnboardingLogger): OnboardingFacade`, override `ContainerOverrides.onboarding?: OnboardingFacade`
  - `OnboardingFacade = { get(workspaceId, repoId): Promise<OnboardingTourResponse | undefined>; generate(workspaceId, repoId): Promise<OnboardingJob | undefined> }`, де `undefined` означає, що репо не знайдено
  - client: `useOnboardingTour(repoId): UseQueryResult<OnboardingTourResponse, ApiError>`, `useGenerateOnboarding(repoId): UseMutationResult<OnboardingGenerateResponse, ApiError, void>`
- **Run identity (AC48, AC75)**:
  - `tryStart` — один атомарний `INSERT … ON CONFLICT (repo_id) DO UPDATE … WHERE status <> 'running' OR started_at < now - 10 min RETURNING`. Порожній результат означає `onboarding_in_progress`.
  - `complete` / `fail` — compare-and-set: `WHERE repo_id = ? AND run_id = ? AND status = 'running' AND started_at >= now - 10 min`.
  - 0 змінених рядків → результат відкидається, лише `logger.info`.
- **Constraints** (значення зі спеки, константи в `onboarding/constants.ts`):
  - дедлайн 180 000 мс від запису `running`; поріг завислого запуску 600 000 мс; ≤ 2 HTTP-запити на генерацію.
  - Вхід моделі (AC56): дерево ≤ 500 шляхів за зростанням `path` без `node_modules dist build coverage .next out vendor .git`; кореневий `README*` ≤ 20 000 символів; маніфести ≤ 400 рядків / 20 000 символів; назви lock-файлів; ≤ 15 файлів з найвищим рангом ≤ 200 рядків / 20 000 символів; ланцюги.
  - Бюджет: ≤ 60 000 токенів cl100k (`container.tokenizer`). Порядок обрізання: файли з найвищим рангом (від найнижчого рангу) → ланцюги → дерево → `failed` без запиту.
  - Тексти `job.error` — лише фіксовані рядки AC79. Мова промпту — `English`.
  - Порядок перевірок POST: репо (404) → клон (`clone_path` і `.git` у теці, 409) → активний запуск (409) → ключ (422) → `tryStart`.
  - Відповідь моделі обробляється так: відкинути невалідні шляхи (AC62, AC63) → прибрати повтори (AC65) → ліміти кількості з кінця (AC64, AC66, AC69) → обрізати тексти (`truncate(s, max)`: довжина ≤ max, кінець «…»).
  - `getIndexState` з `degradedReason: 'no_data'` або `repoIntelEnabled = false` → `index_status: 'none'`, `files_indexed: 0`.
- **UI strings** (`client/messages/en/onboarding.json`, namespace `onboarding`, володіє T5): групи `page.*` (title, crumb, subtitleIndexed з ICU plural `{count, plural, one {# file} other {# files}}`, subtitleFiles, ago.justNow/minutes/hours/days, regenerate, shareLink, regenerateDisabledHint), `toc.*` (onThisPage + 5 назв секцій), `sections.*` (заголовки, runNote, from, open/openLabel, copyLabel, notEnough, diagramUnavailable, size), `states.*` (noRepo, notCloned, empty.title/body/cta, generating.title/body, regenerating, partialIndex, connectionLost, loadError.title/retry, failed, regenerateFailed, tryAgain), `errors.*` (noKey, notCloned, startFailed), `toasts.*` (copied, linkCopied, copyFailed). Тексти — дослівно з AC. У рядках немає `<word>`.

## Requirements review
- **Clarified**: режим виконання → multi-agent (у користувача).
- **Clarified**: AC60 / AC54 (порт `LLMProvider` не має `AbortSignal` і ліміту транспортних повторів, а дефолтний провайдер `openrouter` живе в reviewer-core) → варіант b. reviewer-core не чіпаємо. Фабрика `container.llmWithLimits` будує провайдер на кожен запит з `maxRetries: 0` і `timeoutMs` = залишок дедлайну. Адаптери openai/anthropic отримують ці опції конструктора: SDK `maxRetries: 0`, `withRetry` не більше `maxRetries`. Дедлайн тримають таймаут запиту і wall-clock guard у сервісі. Збій схеми класифікується за текстом помилки в одній функції `isSchemaFailure` (T6) з unit-тестом. Відповідає AC54, AC60, AC79.
- **Clarified** (вирішено за кодом, прийнято користувачем): патерн модуля `conventions`; атомарний upsert з `run_id` (AC48); CAS за `run_id` (AC75); `no_data` / вимкнений repo-intel → `none` (AC61); проп `fallback` у `MermaidDiagram` (AC14); seed-дані в `server/src/db/seed-onboarding.ts` (AC71); e2e — skip-verify на macOS 12.
- **Recommendations**: немає.
- **Spec updates needed**: —

## Risks
- Збій схеми розпізнається за текстом помилки адаптера: «structured output failed schema validation» в openai/anthropic/openrouter. Якщо текст зміниться, помилка стане «Generation failed unexpectedly» і не отримає повтору. Пом'якшення: `isSchemaFailure` у `classify.ts` (T6) має unit-тест на точні рядки всіх трьох адаптерів.
- Немає справжнього `AbortSignal`. На дедлайні запит, що триває, обриває власний таймаут провайдера (= залишок бюджету), а guard у сервісі перестає чекати й не шле нових запитів (T11). Для `openrouter` ліміт запитів спирається на опції SDK у `OpenRouterProvider` (`maxRetries: 0`, `timeout`). Лічильника HTTP-запитів для цього шляху немає: без зміни reviewer-core туди не підставити `fetch`. AC60 перевіряється лічильником викликів на рівні сервісу (T11) і лічильником `fetch` для openai/anthropic (T3).
- Assumption: дерево файлів (AC56 п.1) береться обходом робочого дерева клону (`fs-source.ts`), а не з repo-intel. У symlink-теки обхід не заходить.
- Assumption: вимкнений repo-intel записується як `index_status: 'none'`, `files_indexed: 0`.
- Assumption: збережений `json`, що не проходить `OnboardingTour`, віддається як `tour: null` з `logger.info` (repository, T7).
- Assumption: обрізання шляху посередині (AC23) рахується за кількістю символів (`truncateMiddle(path, 60)`) і не вимірює ширину в пікселях. Повний шлях — у `title`.
- Assumption: wall-clock guard стартує від `started_at`, який повертає `tryStart`. Запис `failed` на дедлайні сам іде через CAS.
- `pnpm db:generate` питає «created or renamed?», коли та сама таблиця й видаляє колонки (server/INSIGHTS). Тут колонки не видаляються. Якщо запит усе ж з'явиться — запустити через pty і відповісти Enter (T2).
- `scripts/check.sh server arch` у worktree дає хибні 5 legacy-помилок (server/INSIGHTS). Перед тим як вважати це провалом, перезапустити arch у main checkout.
- `check.sh server it` у sandbox пропускає тести (self-skip). Запускати без sandbox; exit 3 — не pass (T13).
- Клієнт не імпортує runtime-значення з `@devdigest/shared` (client/INSIGHTS), лише `import type`. Переліки `kind` / `size` / секцій дублюються локально з `satisfies`.
- Manual check: AC13 — розробник звіряє кольори рамок вузлів (external / entry+module / middleware / datastore) з D1 на seed-турі перед мержем.
- Manual check: NFR1 — розробник запускає 5 генерацій на клоні DevDigest і записує p95 у PR.
- Manual check: NFR4 — розробник 10 разів запускає `GET /repos/:id/onboarding` локально й записує p95 у PR.
- Manual check: NFR5 — прохід сторінки лише клавіатурою перед мержем.

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] Контракти Onboarding Tour (обидві копії)
Owns: `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/index.ts`, `server/test/contracts.test.ts`
Depends on: —
Skills: zod
Route: agent
Interfaces: експортує `OnboardingIndexStatus`, `OnboardingNodeKind`, `OnboardingDiagramNode`, `OnboardingDiagramEdge`, `OnboardingTour`, `OnboardingJob`, `OnboardingTourResponse`, `OnboardingGenerateResponse` (схема + тип), поля як у Cross-task decisions.
Steps:
1. Test: `server/test/contracts.test.ts` — замінити кейс `Onboarding` на кейси: валідний тур проходить, 9 `critical_paths` / 13 вузлів / `files` з 4 файлами / `error` з 201 символу не проходять, `job: null, tour: null` проходить.
2. Замінити заготовки в обох `knowledge.ts` ідентичним кодом; оновити коментар-перелік в обох `index.ts`.
Acceptance:
- Обидві копії `knowledge.ts` однакові в секції Onboarding; `Onboarding*`-заготовок більше немає; server, client і mcp typecheck зелені.
- Ліміти схеми збігаються з AC64 [unit], AC66 [unit], AC69 [unit] і AC79 [unit] (≤ 200 символів) — перевіряє тест контрактів.
Verify: `scripts/check.sh server typecheck test test/contracts.test.ts` · `scripts/check.sh client typecheck` · `scripts/check.sh mcp typecheck`
Escalate if: якийсь код поза Owns імпортує `Onboarding`, `OnboardingSection` чи `OnboardingLink`.

### T2 [BE] Таблиця `onboarding`: стан генерації
Owns: `server/src/db/schema/context.ts`, `server/src/db/migrations/**` (лише згенеровані `pnpm db:generate`)
Depends on: —
Skills: drizzle-orm-patterns, postgresql-table-design
Route: agent:haiku
Steps:
1. Змінити `onboarding` за Cross-task decisions → Data.
2. `cd server && pnpm db:generate`; руками міграцію не редагувати.
Acceptance:
- Згенерована міграція лише змінює nullability і default у `json` / `generated_at` і додає 5 колонок; PK і `ON DELETE CASCADE` до `repos` незмінні (основа для AC55 [it], перевіряє T13).
Verify: `cd server && pnpm db:generate` · `scripts/check.sh server typecheck`
Escalate if: `db:generate` пропонує перейменування або видалення колонки.

### T3 [BE] Провайдер LLM з лімітами: `container.llmWithLimits`
Owns: `server/src/adapters/llm/openai.ts`, `server/src/adapters/llm/anthropic.ts`, `server/src/platform/container.ts`, `server/test/llm-limits.test.ts`
Depends on: —
Skills: onion-architecture
Route: agent
Interfaces:
- `new OpenAIProvider(apiKey, opts?: LlmProviderOptions)` і `new AnthropicProvider(apiKey, opts?)`, де `LlmProviderOptions = { maxRetries?: number; timeoutMs?: number; fetch?: typeof fetch }`.
- Якщо `maxRetries` задано: SDK-клієнт отримує `maxRetries: 0`, `withRetry` отримує `retries: maxRetries`, кожен запит — таймаут `timeoutMs`.
- Без опцій поведінка не змінюється.
- `container.llmWithLimits(id, limits)`: для `openrouter` → `new OpenRouterProvider(key, { maxRetries, timeoutMs, estimateCost })`. Плюс `ContainerOverrides.llmWithLimits` і експорт `LlmLimits`.
Steps:
1. Test: `server/test/llm-limits.test.ts`:
   - `OpenAIProvider` і `AnthropicProvider` з `{ maxRetries: 0, timeoutMs }` і фейковим `fetch`, що віддає 503: рівно 1 виклик `fetch` на `completeStructured({ maxRetries: 0 })` (AC60).
   - Те саме з 429.
   - `llmWithLimits` без ключа кидає `ConfigError` (AC49).
   - Override повертає підставлений провайдер.
2. Реалізувати опції в адаптерах і метод у контейнері; reviewer-core не змінювати.
Acceptance:
- AC60 [unit] з `maxRetries: 0` адаптер openai/anthropic робить рівно 1 HTTP-запит на виклик, зокрема на 429 / 503.
- AC49 [unit] `llmWithLimits` кидає `ConfigError`, коли в `SecretsProvider` немає ключа провайдера.
- Наявні виклики `container.llm(id)` поводяться як раніше (`server/test/adapters.test.ts` зелений).
Verify: `scripts/check.sh server typecheck arch test test/llm-limits.test.ts test/adapters.test.ts`
Escalate if: SDK не дає підставити `fetch` або вимкнути власні повтори без зміни reviewer-core.

### T4 [BE] Основа модуля onboarding: константи, порти, домен, типи
Owns: `server/src/modules/onboarding/constants.ts`, `server/src/modules/onboarding/ports.ts`, `server/src/modules/onboarding/domain.ts`, `server/src/modules/onboarding/types.ts`, `server/test/onboarding-domain.test.ts`
Depends on: T1
Skills: onion-architecture
Route: agent
Interfaces:
- `ports.ts`:
  - `RepoBasics { id, owner, name, clonePath: string | null }`
  - `JobRecord { runId, status, error: string | null, startedAt: Date, finishedAt: Date | null }`
  - `OnboardingState { job: JobRecord; tour: OnboardingTour | null }`
  - `OnboardingStore { getRepo(ws, repoId): Promise<RepoBasics | undefined>; getState(repoId): Promise<OnboardingState | undefined>; tryStart(repoId, runId, now: Date, staleMs): Promise<JobRecord | null>; complete(repoId, runId, tour: OnboardingTour, finishedAt: Date, staleMs): Promise<boolean>; fail(repoId, runId, error: string, finishedAt: Date, staleMs): Promise<boolean> }`
  - `RepoFiles { isClone(root): Promise<boolean>; listTree(root, { limit, excludeDirs }): Promise<string[]>; listRootFiles(root): Promise<string[]>; readCapped(root, path, { maxLines, maxChars }): Promise<string | null>; isRegularFileInside(root, path): Promise<boolean> }`
  - `IndexSource` = `Pick<RepoIntel, 'getIndexState' | 'getTopFilesByRank' | 'getCriticalPaths'>`
  - `HeadReader { currentHead(repo: RepoRef): Promise<string> }`
  - `TokenCounter { count(text): number }`
  - `ModelHandle { model: string; provider(timeoutMs: number): Promise<LLMProvider> }`, `ResolveModel = (ws) => Promise<ModelHandle>`
  - `OnboardingLogger { info(obj, msg): void; error(obj, msg): void }`
- `domain.ts`:
  - `OnboardingDomainError(code: 'repo_not_cloned' | 'onboarding_in_progress' | 'llm_not_configured', message)`
  - `GenerationAbort(kind: 'deadline' | 'context_too_large')`
  - `isStaleRunning(job, now, staleMs): boolean`
  - `isSafeRelativePath(p): boolean`
- `types.ts`: `OnboardingFacade`.
- `constants.ts`: усі ліміти з Cross-task decisions, `TREE_EXCLUDED_DIRS`, `MANIFEST_FILES`, `LOCK_FILES`, `ERROR_MESSAGES` (тексти AC79 + `httpError(status)`), `SCHEMA_NAME = 'OnboardingTourDraft'`, `MAX_HTTP_REQUESTS = 2`.
Steps:
1. Test: `server/test/onboarding-domain.test.ts`:
   - `isSafeRelativePath` відкидає абсолютний шлях, сегмент `..`, `\`, NUL, порожній рядок і пропускає `..notes.md` (server/INSIGHTS);
   - `isStaleRunning` на межі 10 хв;
   - `httpError(503)` дає «The model provider returned an error (HTTP 503)».
2. Написати чотири файли без реалізацій сервісу.
Acceptance:
- AC62 [unit] синтаксична частина (абсолютний, `..`, `\`, NUL) відкидається `isSafeRelativePath`.
- AC50 [unit] `isStaleRunning` повертає true лише для `running`, старшого за 600 000 мс.
- AC79 [unit] `ERROR_MESSAGES` містить рівно сім фіксованих текстів зі спеки, кожен ≤ 200 символів.
Verify: `scripts/check.sh server typecheck arch test test/onboarding-domain.test.ts`
Escalate if: порту бракує методу, який вимагає AC (тоді додати його тут, а не в задачах хвилі 1).

### T5 [FE] Хуки onboarding і рядки `onboarding.json`
Owns: `client/src/lib/hooks/onboarding.ts`, `client/src/lib/hooks/onboarding.test.tsx`, `client/src/lib/hooks/index.ts`, `client/messages/en/onboarding.json`
Depends on: T1
Skills: react-best-practices, client-testing
Route: agent
Interfaces:
- `onboardingQueries.tour(repoId)` (ключ `["onboarding", repoId]`).
- `useOnboardingTour(repoId)`:
  - `refetchInterval`: 2000 мс, поки останні успішні дані мають `job.status === 'running'`, інакше `false`;
  - `retry: false`;
  - після помилки повторного GET лишає останні дані.
- `useGenerateOnboarding(repoId)`:
  - POST `/repos/${repoId}/onboarding/generate`;
  - `onSuccess` кладе `job` у кеш і інвалідує запит;
  - на `ApiError.code === 'onboarding_in_progress'` теж інвалідує запит.
- Компоненти отримують помилку як `ApiError` з `status` і `code`.
Steps:
1. Test: `client/src/lib/hooks/onboarding.test.tsx`:
   - опитування кожні 2 с, поки `running`; зупинка на `done` / `failed`;
   - помилка повторного GET лишає `data` і опитування триває;
   - 409 `onboarding_in_progress` інвалідує запит.
2. Переписати `onboarding.json` за Cross-task decisions → UI strings. Ключ `generate.body` із заготовки замінити текстом AC29.
3. Додати експорт у barrel `index.ts`.
Acceptance:
- AC33 [unit] `useOnboardingTour` опитує кожні 2 с, поки `job.status = 'running'`, і зупиняється на `done` / `failed`.
- AC77 [unit] після помилки повторного GET хук лишає останні дані й продовжує опитування.
- AC39 [unit] 409 `onboarding_in_progress` не лишає мутацію в стані помилки для UI й запускає опитування.
- Усі UI-тексти зі спеки (шапка, навігація, секції, стани, тур без клону) є в `onboarding.json`; рядків з `<…>` немає (NFR7).
Verify: `scripts/check.sh client typecheck test src/lib/hooks/onboarding`
Escalate if: потрібен новий метод у `src/lib/api.ts` (зараз вистачає `api.get` / `api.post`).

## Wave 1 — parallel (disjoint Owns)

| Файл / тека | Задача |
|---|---|
| `server/src/modules/onboarding/{input,prompt,validate,classify}.ts`, `server/src/prompts/onboarding.system.md` | T6 |
| `server/src/modules/onboarding/{fs-source,repository}.ts` | T7 |
| `server/src/db/seed.ts`, `server/src/db/seed-onboarding.ts` | T8 |
| `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers*.ts` | T9 |
| `client/src/app/repos/[repoId]/tour/_components/sections/**`, `tour/helpers.ts`, `tour/useClipboard.ts`, `client/src/components/mermaid-diagram/**` | T10 |

### T6 [P] [BE] Чистий конвеєр: вхід моделі, промпт, перевірка відповіді, класифікатор
Owns: `server/src/modules/onboarding/input.ts`, `server/src/modules/onboarding/prompt.ts`, `server/src/modules/onboarding/validate.ts`, `server/src/modules/onboarding/classify.ts`, `server/src/prompts/onboarding.system.md`, `server/test/onboarding-input.test.ts`, `server/test/onboarding-validate.test.ts`, `server/test/onboarding-classify.test.ts`
Depends on: T4
Skills: onion-architecture, zod, security
Route: agent
Interfaces:
- `input.ts`:
  - `isSecretPath(path): boolean`
  - `toTourIndexStatus(state: Pick<IndexState, 'status' | 'filesIndexed' | 'degradedReason'>, enabled: boolean): { status: OnboardingIndexStatus; filesIndexed: number }`
  - `usesRankedInput(status): boolean` (лише `full` / `partial`)
  - `ModelInput = { tree: string[]; files: InputFile[]; lockFiles: string[]; chains: string[][] }`, де `InputFile = { path; content; kind: 'readme' | 'manifest' | 'ranked' }` і ranked-файли йдуть у порядку рангу desc
  - `fitToBudget(input, systemPrompt, tokens: TokenCounter, max): { ok: true; input; messages: ChatMessage[] } | { ok: false }`
  - `contentPaths(input): Set<string>` — шляхи README, маніфестів і ranked-файлів після обрізання
- `prompt.ts`:
  - `OnboardingTourDraft` (zod-схема відповіді моделі: `summary`, `diagram.nodes[{ key, label, kind, path | null }]`, `diagram.edges[{ from, to }]`, `critical_paths`, `run_steps`, `reading_path`, `first_tasks`; усі поля required, без max)
  - `buildMessages(input, systemPrompt): ChatMessage[]`
- `validate.ts`:
  - `sanitizeDraft(draft, { exists: (path) => Promise<boolean>; contentPaths: ReadonlySet<string> }): Promise<TourBody>`, де `TourBody = Omit<OnboardingTour, 'commit_sha' | 'generated_at' | 'files_indexed' | 'index_status'>`
  - `truncate(text, max)`, `sanitizeLabel(label)`
- `classify.ts`:
  - `isSchemaFailure(err)`
  - `isRetryable(err)`: збій схеми, `status` 429 або ≥ 500, мережевий код / `APIConnectionError`; не таймаут і не `GenerationAbort`
  - `classifyGenerationError(err): string` — текст AC79; таймаут / `TimeoutError` / `APIConnectionTimeoutError` / `GenerationAbort('deadline')` → текст дедлайну
Steps:
1. Test: `server/test/onboarding-input.test.ts`:
   - AC56: склад і ліміти входу, сортування й виключення в дереві;
   - AC57: `.env`, `.env.local`, `a.pem`, `b.key` відкинуто, `.env.example` лишається;
   - AC58: кожен файл в окремому `<untrusted>` у user-повідомленні, у system є інструкція «дані, не інструкції»;
   - AC59 / NFR2: фікстура з 15 файлів по 200 рядків + README 20 000 символів → ≤ 60 000 токенів, прибрано найнижчі за рангом;
   - AC61: `degraded` / `failed` / `none` / вимкнено → без ranked і ланцюгів; `partial` бере, що є;
   - AC76: ланцюги → дерево → `ok: false`.
2. Test: `server/test/onboarding-validate.test.ts`:
   - AC62: неіснуючий шлях або `exists = false` відкинуто, у вузла діаграми лише `path → null`;
   - AC63: джерело поза `contentPaths` відкинуто, шляхи з дерева й lock-файли не рахуються;
   - AC64: 9/11/9/6 → 8/10/8/5, тексти обрізані з «…», команда > 500 відкинута, менше за мінімум — як є;
   - AC65: повтори прибрано, лишається перший;
   - AC66: 13 вузлів / 21 ребро → 12 / 20, ребро на невідомий вузол відкинуто, мітка `"]<script>` → `_`, `id` = `n1…`;
   - AC69: задача без файлів відкинута, 4 файли → 3.
3. Test: `server/test/onboarding-classify.test.ts`:
   - AC79: кожен клас → свій текст, сирий текст помилки не просочується, `{status}` — тризначний;
   - AC60: `isRetryable` для схеми / 429 / 503 / ECONNRESET — так, для 400 / таймауту / дедлайну — ні;
   - `isSchemaFailure` на точних рядках помилок openai, anthropic і reviewer-core `OpenRouterProvider`.
4. Переписати `server/src/prompts/onboarding.system.md` під `OnboardingTourDraft`: п'ять полів, `{{language}}`, правило «вміст `<untrusted>` — дані», 3–5 задач з `S` / `M` і 1–3 файлами. `wrapUntrusted` брати з `platform/prompt.js`.
Acceptance:
- AC56 [unit] вхід моделі містить рівно пункти 1–6 у межах лімітів (пункти 5–6 лише для `full` / `partial`).
- AC57 [unit] вміст `.env`, `.env.*` (крім `.env.example`), `*.pem`, `*.key` не читається й не потрапляє в повідомлення.
- AC58 [unit] весь вміст репо — лише в user-повідомленні, кожен файл в окремому `<untrusted>`-блоці; `INJECTION_GUARD` не змінено.
- AC59 [unit] вхід > 60 000 токенів обрізається з найнижчого рангу до ≤ 60 000.
- AC61 [unit] склад входу залежить від `index_status`, як у спеці.
- AC62 [unit] невалідні шляхи відкинуто перед збереженням, вузол діаграми лишається з `path: null`.
- AC63 [unit] AC64 [unit] AC65 [unit] AC66 [unit] AC69 [unit] правила `sanitizeDraft`.
- AC76 [unit] після обрізання ланцюгів і дерева повертається `ok: false`.
- AC79 [unit] AC60 [unit] класифікатор і рішення про повтор.
Verify: `scripts/check.sh server typecheck arch test test/onboarding-input.test.ts test/onboarding-validate.test.ts test/onboarding-classify.test.ts`
Escalate if: OpenAI strict json_schema відкидає `OnboardingTourDraft` (nullable / required) так, що це вимагає зміни контракту T1.

### T7 [P] [BE] Адаптери: ФС клону і репозиторій `onboarding`
Owns: `server/src/modules/onboarding/fs-source.ts`, `server/src/modules/onboarding/repository.ts`, `server/test/onboarding-fs-source.test.ts`
Depends on: T2, T4
Skills: onion-architecture, drizzle-orm-patterns, security
Route: agent
Interfaces:
- `class FsRepoFiles implements RepoFiles`.
- `class OnboardingRepository implements OnboardingStore`:
  - `tryStart` і CAS — за Cross-task decisions → Run identity;
  - `getRepo` фільтрує за `workspaceId`;
  - `getState` робить `safeParse` `json` через `OnboardingTour`: невалідне → `tour: null`.
Steps:
1. Test: `server/test/onboarding-fs-source.test.ts` (tmp-тека):
   - `isClone` (тека без `.git` → false, файл замість теки → false);
   - `listTree`: виключені теки, ліміт, сортування, symlink-теки не обходяться;
   - `readCapped`: ліміти рядків і символів, мінізований однорядковий файл;
   - `isRegularFileInside`: symlink за межі → false, тека → false, `..notes.md` → true.
2. Реалізувати адаптер. Перевірка вкладеності — `rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)` (server/INSIGHTS).
3. Реалізувати репозиторій. Drizzle лише тут; повертати `JobRecord` / `OnboardingState`, не row-типи.
Acceptance:
- AC47 [unit] `isClone` = false для відсутньої теки, файлу й теки без `.git`.
- AC62 [unit] `isRegularFileInside` відкидає symlink за межі клону й не-файли.
- Репозиторій компілюється проти `OnboardingStore`; атомарність `tryStart` і CAS перевіряє інтеграційний тест T13.
Verify: `scripts/check.sh server typecheck arch test test/onboarding-fs-source.test.ts`
Escalate if: атомарний `tryStart` неможливо виразити одним запитом Drizzle без raw SQL.

### T8 [P] [BE] Seed-тур для `acme/payments-api`
Owns: `server/src/db/seed-onboarding.ts`, `server/src/db/seed.ts`, `server/test/seed-onboarding.test.ts`
Depends on: T1, T2
Skills: drizzle-orm-patterns
Route: agent
Interfaces:
- `seed-onboarding.ts`: `SEED_ONBOARDING_COMMIT_SHA` (40 hex) і `seedOnboardingTour(now: Date): OnboardingTour`.
- `seed.ts` робить upsert рядка `onboarding` для демо-репо (`onConflictDoUpdate` по `repo_id`): `status: 'done'`, `error: null`, `generated_at = finished_at = now − 2 год`, `started_at = generated_at − 1 хв`.
Steps:
1. Test: `server/test/seed-onboarding.test.ts` — `OnboardingTour.parse(seedOnboardingTour(now))` проходить. Перевірити:
   - summary дослівно з AC71;
   - 6 вузлів (`n1…n6`) з `kind` і `path` за AC71, 5 ребер;
   - 4 / 4 / 3 / 3 елементи з точними текстами;
   - описи задач ≤ 140;
   - `files_indexed = 12450`, `index_status = 'full'`;
   - `generated_at` = now − 2 год.
2. Дописати блок у `seed.ts` після блоку Blast Radius (рядок `// ---- L05 Onboarding Tour ----`), оновити JSDoc `seed()`.
Acceptance:
- AC71 [unit] seed-тур проходить `OnboardingTour` і має зміст AC71 (D1 / D2).
- Seed-репо лишається `clone_path: null` (передумова стану «тур без клону» в e2e T14).
Verify: `scripts/check.sh server typecheck test test/seed-onboarding.test.ts`
Escalate if: зміст AC71 не проходить ліміти контракту T1.

### T9 [FE] Пункт сайдбару «Onboarding Tour» і перемикання репо
Owns: `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.ts`, `client/src/components/app-shell/helpers.test.ts`
Depends on: —
Skills: client-testing
Route: inline
Steps:
1. Test: `client/src/components/app-shell/helpers.test.ts`:
   - WORKSPACE = `pulls`, `onboarding-tour`, `context` по порядку, у `onboarding-tour` немає `gKey`, `href` = `/repos/:repoId/tour`;
   - `activeKeyFor('/repos/r/tour') === 'onboarding-tour'`, `activeKeyFor('/onboarding') !== 'onboarding-tour'`;
   - `repoSwitchHref('/repos/r1/tour', 'r2') === '/repos/r2/tour'`.
2. `nav.ts`: пункт `{ key: 'onboarding-tour', label: 'Onboarding Tour', icon: <наявна іконка з vendor/ui/icons>, href: '/repos/:repoId/tour' }`. Ключ `shell.nav.onboarding-tour` уже є.
3. `helpers.ts`: у `activeKeyFor` замінити гілку `/onboarding` на `/^\/repos\/[^/]+\/tour(\/|$)/`; `repoSwitchHref` тримає `/tour` так само, як `/conventions`.
Acceptance:
- AC1 [unit] пункт «Onboarding Tour» стоїть у WORKSPACE між «Pull Requests» і «Project Context», веде на `/repos/:repoId/tour`, активний на цьому маршруті, без комбінації клавіш.
- AC2 [unit] на `/onboarding` пункт не активний.
- AC3 [unit] перемикання репо на `/repos/:id/tour` веде на `/repos/<новий id>/tour`.
Verify: `scripts/check.sh client typecheck test app-shell/helpers`
Escalate if: іконки, схожої на D1, немає в `vendor/ui/icons` (не додавати нову — взяти найближчу).

### T10 [P] [FE] Картки секцій туру, діаграма, copy, Open
Owns: `client/src/app/repos/[repoId]/tour/_components/sections/**`, `client/src/app/repos/[repoId]/tour/helpers.ts`, `client/src/app/repos/[repoId]/tour/helpers.test.ts`, `client/src/app/repos/[repoId]/tour/useClipboard.ts`, `client/src/components/mermaid-diagram/**`
Depends on: T1, T5
Skills: react-best-practices, client-testing
Route: agent
Interfaces:
- `tour/helpers.ts`:
  - `githubBlobUrl(owner, name, sha, path)` — кожен сегмент через `encodeURIComponent`
  - `truncateMiddle(path, max = 60)`
  - `parseSummary(text): { type: 'text' | 'code' | 'bold'; value: string }[]`
  - `toMermaid(diagram): string` — `flowchart LR`, `classDef` на `kind`; мітки ще раз фільтруються набором символів AC66
  - `SECTION_IDS = ['architecture', 'critical-paths', 'run-locally', 'reading-path', 'first-tasks'] as const`
- `useClipboard(): (text: string, kind: 'command' | 'link') => Promise<void>` — тости `toasts.copied` / `linkCopied` / `copyFailed` через `@/lib/toast`.
- `<SectionCard id icon title>` — chevron з `aria-expanded`, за замовчуванням розгорнута.
- `<TourSections tour={OnboardingTour} repo={{ owner, name }} />` — п'ять карток з `id` = `SECTION_IDS`.
- `MermaidDiagram` отримує проп `fallback?: ReactNode`: показується, коли діаграма невалідна; без пропа поведінка як раніше.
Steps:
1. Test: `tour/helpers.test.ts`:
   - `parseSummary`: chip, bold, `**` усередині chip буквально, непарні символи;
   - `githubBlobUrl` з пробілом і `#` у шляху;
   - `truncateMiddle`;
   - `toMermaid` для seed-діаграми.
2. Test: `tour/_components/sections/TourSections.test.tsx` (next-intl з `messages/en`, design: `specs/designs/2026-10-24-onboarding-tour/D1.png`, `D2.png`):
   - рядки кожної картки, кнопки `Open {path}` / `Copy command {n}` за role / name;
   - `href` / `target` / `rel` посилання Open;
   - copy пише повну команду в замоканий `navigator.clipboard` і показує «Copied»; збій → «Couldn't copy to clipboard»;
   - згортання картки оновлює `aria-expanded`, заголовок лишається;
   - порожні секції → «Not enough grounded information for this section.»;
   - порожні `nodes` / невалідна діаграма → «Diagram unavailable»;
   - `<script>` у тексті рендериться як текст;
   - бейдж розміру містить «S» / «M»;
   - у Guided reading path немає Open.
3. Реалізувати компоненти за D1 / D2 (кольори вузлів за AC13). Без `dangerouslySetInnerHTML` для текстів туру. Runtime-імпортів з `@devdigest/shared` немає.
Acceptance:
- AC10 [unit] AC11 [unit] картки з іконкою, заголовком і chevron з `aria-expanded`; спочатку розгорнуті; згортання ховає тіло.
- AC12 [unit] summary: code-chip, жирний `**…**`, інше буквально.
- AC13 [unit] вузли рендеряться як `flowchart LR`, клас на `kind` (кольори — Manual check у Risks).
- AC14 [unit] порожні вузли або невалідна діаграма → summary + «Diagram unavailable».
- AC15 [unit] AC16 [unit] рядки Critical paths і посилання Open на `github.com/{owner}/{name}/blob/{sha}/{path}` з кодуванням сегментів, `target="_blank"`, `rel="noopener noreferrer"`.
- AC17 [unit] AC18 [unit] AC19 [unit] How to run locally: примітка, нумерація, «from {source_path}», copy і тости.
- AC20 [unit] AC21 [unit] reading path без Open; First tasks з бейджем і Open для кожного файлу.
- AC22 [unit] AC23 [unit] порожня секція; обрізання шляху посередині з `title`, перенесення команд.
- AC43 [unit] збій буфера → «Couldn't copy to clipboard».
- AC67 [unit] AC68 [unit] увесь текст туру рендериться як текст, mermaid у `securityLevel: "strict"`, команди не виконуються.
Verify: `scripts/check.sh client typecheck test tour/helpers tour/_components/sections mermaid-diagram`
Escalate if: `@/lib/toast` недоступний поза `ToastProvider` у тестах (тоді обгорнути тест, а не змінювати провайдер).

## Wave 2 — service, wiring, page

### T11 [P] [BE] Сервіс onboarding, маршрути, підключення до контейнера
Owns: `server/src/modules/onboarding/service.ts`, `server/src/modules/onboarding/helpers.ts`, `server/src/modules/onboarding/http-errors.ts`, `server/src/modules/onboarding/compose.ts`, `server/src/modules/onboarding/routes.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/test/onboarding-service.test.ts`, `server/test/onboarding-routes.test.ts`, `server/test/onboarding-compose.test.ts`, `server/README.md`
Depends on: T3, T6, T7
Skills: onion-architecture, fastify-best-practices
Route: agent
Interfaces:
- `OnboardingService implements OnboardingFacade`, конструктор `OnboardingDeps = { store, files, index, head, tokens, resolveModel, loadSystemPrompt: () => Promise<string>, repoIntelEnabled: boolean, logger?, now?: () => Date }`.
- `helpers.ts`: `toJobDto(job, now)` — завислий `running` → `failed` з текстом AC50.
- `compose.ts`: `createOnboardingFacade(c, logger)`:
  - `resolveModel` → `resolveFeatureModel(c, ws, 'onboarding')`;
  - пробний `c.llmWithLimits(provider, { maxRetries: 0, timeoutMs: GENERATION_DEADLINE_MS })`: `ConfigError` → `OnboardingDomainError('llm_not_configured')`;
  - `provider(timeoutMs)` → `c.llmWithLimits(provider, { maxRetries: 0, timeoutMs })`;
  - `loadSystemPrompt` → `renderPrompt('onboarding.system.md', { language: 'English' })`.
- `container.onboarding(logger)` + `ContainerOverrides.onboarding`.
- `http-errors.ts`: 409 / 409 / 422.
Steps:
1. Test: `server/test/onboarding-service.test.ts` — in-memory фейки портів, `vi.useFakeTimers`. Кейси:
   - GET: `null` / `null` без рядка; завислий → `failed`; провайдера не викликано (NFR3);
   - POST: порядок перевірок, жодного `tryStart` на 404 / 409 / 422; `tryStart → null` → `onboarding_in_progress`;
   - фон, успіх: `complete` з `commit_sha` = HEAD на старті, `files_indexed` / `index_status` на старті;
   - модель: фейк `ModelHandle` рахує виклики `completeStructured` (кожен з `maxRetries: 0`, `timeoutMs` = залишок, модель з `resolveModel`);
   - 429 + 429 → рівно 2 виклики → `fail` з «(HTTP 429)»;
   - схема + успіх → 2 виклики → `complete`;
   - 400 → 1 виклик;
   - фейковий провайдер не відповідає → на 180 с `fail` з текстом дедлайну, без нового виклику;
   - `fitToBudget ok:false` → 0 викликів;
   - `complete` / `fail` → `false` → лише `logger.info`;
   - кожен збій → рівно один `logger.error` з `repoId`, фіксованим текстом і сирим текстом, без промпту й ключа (NFR8).
2. Test: `server/test/onboarding-routes.test.ts` — `buildApp` з `overrides.onboarding`: 200 тіло проходить `OnboardingTourResponse`; 404 на обох маршрутах; 422 на не-uuid; 202 тіло `{ job }`; доменні помилки → 409 `repo_not_cloned` / 409 `onboarding_in_progress` / 422 `llm_not_configured`.
3. Test: `server/test/onboarding-compose.test.ts` — `vi.mock` `settings/feature-models`: `llmWithLimits` отримує провайдер з вибору фічі `onboarding`; `ConfigError` → `llm_not_configured`.
4. Реалізувати сервіс за Cross-task decisions. Wall-clock guard: `Promise.race` виклику з таймером до `started_at + 180 с`; перед кожним кроком перевіряти залишок. Фон — `void execute().catch(log)`, як у conventions.
5. Зареєструвати `onboarding` у `modules/index.ts`, додати getter у `container.ts`, рядки API map у `server/README.md`.
Acceptance:
- AC44 [unit] GET повертає `OnboardingTourResponse` (`null` / `null` до першого запуску).
- AC45 [unit] 404 для чужого / неіснуючого репо на обох маршрутах, 422 `validation_error` для не-uuid.
- AC46 [unit] POST для клонованого репо з ключем записує `running`, повертає 202 `{ job }` і запускає фон.
- AC47 [unit] AC48 [unit] AC49 [unit] 409 `repo_not_cloned` / 409 `onboarding_in_progress` / 422 `llm_not_configured`, без створення запуску.
- AC50 [unit] завислий `running` у GET віддається як `failed` з текстом AC79, новий POST приймається.
- AC51 [unit] модель береться з Feature Models (`onboarding`) або з дефолту реєстру.
- AC53 [unit] AC54 [unit] AC74 [unit] збій або дедлайн → `failed` з фіксованим текстом за ≤ 180 с, тур не змінено.
- AC60 [unit] ≤ 2 виклики провайдера (кожен з `maxRetries: 0`), повтор лише для схеми / 429 / 5xx / мережі.
- AC61 [unit] `index_status` записується фактичний, `none` для `no_data` / вимкненого repo-intel.
- AC75 [unit] результат незначущого (застарілого або заміненого) запуску відкидається.
- AC76 [unit] завеликий вхід → `failed` без жодного виклику провайдера.
- AC79 [unit] AC80 [unit] `job.error` — лише фіксований текст; сирий текст — лише в одному рядку лога без промпту й ключа.
Verify: `scripts/check.sh server typecheck arch test test/onboarding-service.test.ts test/onboarding-routes.test.ts test/onboarding-compose.test.ts`
Escalate if: потрібна зміна портів T4 або функцій T6 (повідомити, а не правити чужі файли).

### T12 [P] [FE] Сторінка Onboarding Tour: шапка, навігація, стани
Owns: `client/src/app/repos/[repoId]/tour/page.tsx`, `client/src/app/repos/[repoId]/tour/_components/TourView/**`, `client/README.md`
Depends on: T5, T10
Skills: react-best-practices, next-best-practices, client-testing
Route: agent
Interfaces:
- `page.tsx`: `AppShell` з crumb `{owner/name} › Onboarding Tour`, `RepoNotFound` за `useRepoNotFound`, `<TourView key={repoId} repoId repo={activeRepo} />`.
- `TourView` бере `useOnboardingTour` / `useGenerateOnboarding` і `<TourSections>` (T10), `useClipboard` для Share link.
- `TourView/helpers.ts`: `formatAgo(generatedAt, now): { key: 'justNow' | 'minutes' | 'hours' | 'days'; n }`.
Steps:
1. Test: `TourView/TourView.test.tsx` (хуки замоковано, next-intl з `messages/en`; design: `specs/designs/2026-10-24-onboarding-tour/D1.png`):
   - шапка з accent-назвою і кнопками;
   - підзаголовок з `12,450` і межами «just now / m / h / d»;
   - варіант для `files_indexed = 0`;
   - банер часткового індексу;
   - «ON THIS PAGE»: 5 посилань, підсвітка за hash і без hash, клік → `scrollIntoView` + hash, deep link прокручує після рендера;
   - Share link копіює `location.href` з hash і показує «Link copied»; збій → «Couldn't copy to clipboard»;
   - стани AC25–AC41: скелетони, помилка першого GET + Retry, немає репо, не клоновано, порожній стан, генерація (`aria-live`), Regenerating-банер з disabled `aria-busy`, `failed` з туром і без, банери 422 / 409 / інші, 409 in_progress → опитування без помилки;
   - «Connection lost — retrying…» після помилки повторного GET і зникнення після успіху;
   - AC70: тур без клону — Regenerate disabled з `title` і `aria-describedby`.
2. Реалізувати за D1. `TourView/helpers.test.ts` — `formatAgo`.
3. Рядок маршруту `/repos/[repoId]/tour` у `client/README.md` §UI route map.
Acceptance:
- AC4 [unit] AC5 [unit] AC6 [unit] breadcrumb, заголовок, кнопки, підзаголовок і `{ago}`.
- AC7 [unit] AC8 [unit] AC9 [unit] «ON THIS PAGE», клік з hash, deep link.
- AC24 [unit] банер «Index is partial — critical paths may be less accurate.», коли `index_status` ≠ `full`.
- AC25 [unit] AC26 [unit] AC27 [unit] AC28 [unit] AC29 [unit] скелетони, помилка першого GET з Retry, порожні стани.
- AC30 [unit] AC31 [unit] AC32 [unit] AC33 [unit] AC34 [unit] Generate / Regenerate / Try again, стан генерації, Regenerating-банер, опитування, новий тур без перезавантаження.
- AC35 [unit] AC36 [unit] AC37 [unit] AC38 [unit] AC39 [unit] AC40 [unit] AC41 [unit] банери збою генерації й помилок POST, repo not found.
- AC42 [unit] AC43 [unit] Share link копіює повний URL з hash; тости успіху й збою.
- AC70 [unit] тур без клону показано, Regenerate disabled з підказкою, Share / copy / Open працюють.
- AC77 [unit] AC78 [unit] помилка повторного GET не скидає стан, показує «Connection lost — retrying…» в `aria-live` і ховає його після успіху.
Verify: `scripts/check.sh client typecheck test /tour/`
Escalate if: `RepoNotFound` / `useRepoNotFound` не покриває AC41 без змін поза Owns.

## Wave 3 — integration / e2e

### T13 [P] [BE] Інтеграційний тест onboarding (Postgres)
Owns: `server/test/onboarding.it.test.ts`
Depends on: T8, T11
Skills: drizzle-orm-patterns
Route: agent
Steps:
1. Test: `server/test/onboarding.it.test.ts`. Testcontainers + `buildApp`, migrate + seed. Фейк `llmWithLimits` (override); tmp-тека з `.git` і файлами як `clone_path`; заглушки `repoIntel` / `git` через overrides. Кейси:
   - GET до запуску → `null` / `null`;
   - POST → 202, далі `done` з туром, що проходить `OnboardingTour`;
   - два паралельні POST → рівно один 202 і один 409;
   - рядок з `started_at` −11 хв → GET `failed` з текстом AC50, POST приймається;
   - провайдер падає → `failed`, попередній тур на місці;
   - CAS: `complete` зі старим `run_id` після нового `tryStart` нічого не змінює;
   - видалення репо видаляє рядок `onboarding`;
   - новий інстанс app на тій самій БД → той самий тур (NFR6);
   - повторний `seed()` → рівно один seed-тур зі змістом AC71.
Acceptance:
- AC44 [unit] GET на реальній БД (`it`-лан: [it]).
- AC46 [unit] AC52 [it] POST → 202 → `done`; `generated_at` = час завершення, `commit_sha` = HEAD на старті (`it`-лан: [it]).
- AC48 [unit] два паралельні POST — один 202 і один 409 (`it`-лан: [it]).
- AC50 [unit] AC53 [unit] AC75 [unit] завислий запуск, збій провайдера, відкинутий застарілий результат (`it`-лан: [it]).
- AC55 [it] видалення репо видаляє тур і стан.
- AC71 [unit] AC72 [it] seed-тур на БД проходить схему; повторний seed лишає рівно один тур.
Verify: `scripts/check.sh server it onboarding.it.test.ts`
Escalate if: усі тести self-skip (Docker недоступний) — не вважати pass.

### T14 [P] [FE] e2e: сторінка туру на seed-даних
Owns: `e2e/specs/11-onboarding-tour.flow.json`
Depends on: T8, T9, T11, T12
Skills: —
Route: agent
Steps:
1. Флоу за зразком `09-conventions.flow.json`:
   - з `/pulls` клік «Onboarding Tour» → `--url /tour`;
   - «Onboarding for», «Generated from index of 12,450 files», «last refreshed»;
   - 5 пунктів «ON THIS PAGE»; клік «First tasks» → hash; deep link `#reading-path`;
   - згорнути / розгорнути картку (`aria-expanded`);
   - тексти summary, 4 шляхи, 4 команди, 3 кроки, 3 задачі; банера часткового індексу немає;
   - `href` посилання «Open src/server.ts» містить `github.com/acme/payments-api/blob/` і seed-SHA;
   - copy → «Copied», Share link → «Link copied»;
   - Regenerate disabled.
   LLM не викликається; `06-onboarding.flow.json` не змінюється.
Acceptance:
- AC1 [e2e] AC4 [e2e] AC5 [e2e] AC7 [e2e] AC8 [e2e] AC9 [e2e] навігація, шапка, deep link на seed-турі (компонентний лан [unit] — T9, T12).
- AC10 [e2e] AC11 [e2e] AC15 [e2e] AC16 [e2e] AC17 [e2e] AC18 [e2e] AC20 [e2e] AC21 [e2e] картки, Open `href`, copy-тост (компонентний лан [unit] — T10).
- AC42 [e2e] AC70 [e2e] Share link тост; Regenerate disabled для неклонованого seed-репо (компонентний лан [unit] — T12).
- AC73 [e2e] п'ять карток зі змістом AC71, без банера часткового індексу.
Verify: `cd e2e && npm run e2e:hermetic`
Escalate if: seed-репо отримує `clone_path` у hermetic-стеку (тоді стан AC70 недосяжний).

---

## Execution
Run with `/run-plan plan: specs/plans/2026-10-24-onboarding-tour.md` — the procedure
(dispatch, merge + gate + commit per wave, review, fix loop, finish) lives in
`.claude/skills/run-plan/references/execute.md` and `review-fix.md`.
Plan-specific notes for the orchestrator (host limits, skip-verify, ordering)
go here:
- Wave 0 іде в main checkout у порядку T1 → T2 → T3 → T4 → T5. T2, T3 і T5 залежать лише від T1 або ні від чого й мають непересічні Owns. Їх можна запускати паралельно, якщо orchestrator це підтримує.
- T9 — `inline` (main checkout), без `[P]`.
- `container.ts` належить T3 (W0) і T11 (W2) — різні хвилі, перетину немає.
- T14 — skip-verify на цьому хості (macOS 12, e2e/INSIGHTS: Chrome for Testing не стартує); e2e проганяється на CI.
- T13 (`check.sh server it`) — без sandbox; exit 3 (self-skip) не є pass.
- `check.sh server arch` з worktree з legacy-помилками `drizzle-only-in-repositories` — перезапустити в main checkout.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | done | contracts in both copies; old Onboarding stubs removed |
| T2 | done | migration 0016_wise_doctor_spectrum |
| T3 | done | AC60 fetch counter covers openai+anthropic only (plan Risks) |
| T4 | done (concerns) | MANIFEST_FILES/LOCK_FILES lists invented (spec silent); isSafeRelativePath stricter than AC — re-check P5 |
| T5 | done (concerns) | extra i18n keys; 409 in_progress resolves with cached/placeholder job — re-check P5 |
| T6 | done (concerns) | no INJECTION_GUARD in buildMessages — relies on system-prompt rule + <untrusted> blocks (AC58 as specced); prompt has only {{language}}, T11 substitutes |
| T7 | done (concerns) | repository logger is optional ctor arg — T11 must pass it; tryStart/CAS atomicity tested in T13 |
| T8 | done | seed upsert not run vs Postgres (T13); first_tasks descriptions authored |
| T9 | done | inline; icon Workflow (nearest to D1) |
| T10 | done | useClipboard needs ToastProvider above; AC13 colours manual |
| T11 | done | gatherInput (README/manifests/locks/ranked files/chains) private in service.ts; deadline via setTimeout + run.expired; logger passed to repository |
| T12 | done | existing ToastProvider reused; error banner by ApiError.code |
| T13 | done | 9/9 it tests, Docker, not self-skipped |
| T14 | done (concerns) | skip-verify (macOS 12); first run on CI; uses agent-browser `eval` (no sibling flow does), in-page clipboard stub, deep link via location.hash |
