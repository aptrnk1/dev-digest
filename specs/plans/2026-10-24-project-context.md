# Plan: Project Context — Markdown-документи репо як контекст агентів

Spec: `specs/2026-10-24-project-context.md` · Modules: server, client, reviewer-core, e2e · Execution mode: multi-agent · Status: Approved

## Goal
Користувач бачить усі `*.md`/`*.mdx` клонованого репо на сторінці Project Context. Він прикріплює їх до агентів і скілів (зі сторінки та з вкладок Context) і бачить токени. Кожен запуск рев'ю сам читає прикріплені документи з `origin/<base>` у бюджеті 8 000 токенів, а траса показує вставлений блок.
Not doing: Edit/New/Folder/Upload, кільце Coverage, футер «Indexed…», індексацію/ембедінги документів (`code_chunks.source='spec'`), `specs_detail` у трасі, рядок «Skills loaded» у D4, інші пункти сайдбару з D1–D4, комбінацію `g …`, зміни MCP, окремий snapshot документів, fetch базової гілки під час запуску.

## Architecture
Новий модуль `server/src/modules/context/` (routes → compose → service → ports → repository + `fs-scanner.ts` як outbound-адаптер ФС + `domain.ts` з правилом злиття). Маршрути `/repos/:id/context*`, `/agents/:id/context`, `/skills/:id/context` живуть у цьому модулі, а не в agents/skills: урок лишається самодостатнім модулем (root CLAUDE.md). Маршрути викликають `container.projectContext` (lazy-геттер + `overrides`, як `container.blast`), тож route-тести не потребують БД. Запуск: `run-executor` один раз на агента викликає `container.runContext.resolveForRun(...)` (`run-context.service.ts`: злиття → перевірка клону → `GitClient.hasRef` → `showFile(origin/<base>)` → бюджет). Отримані `specs: {path, content}[]` він передає в `reviewPullRequest`, а `specsRead` записує в трасу. reviewer-core отримує нову форму `specs`, мітку `spec:<path>` і хелпери `wrapSpec`/`renderSpecsBlock`. Сервер рахує ними `tokens` (AC11) і бюджет (AC60) по точному тексту промпту. Клієнт: хуки в `src/lib/hooks/context.ts`, сторінка `/repos/[repoId]/context`, спільна панель `src/components/context-docs/` (рядки, reorder, фільтр, шухляда прев'ю) і тонкі вкладки Context в AgentEditor/SkillEditor. UI траси вже рендерить «Specs read» і `PromptBlock` (copy + expand): змінюються лише підпис і обробка порожнього значення.

## Cross-task decisions
- **Contracts** (`contracts/platform.ts`, обидві копії `vendor/shared`, однаковий текст):
  - `SpecFile` = наявні `path`, `content?`, `size?`, `updated_at?` + `folder: string`, `category: z.enum(['specs','insights','docs'])`, `tokens: z.number().int().nullable()`, `status: z.enum(['ok','too_large'])`.
  - `SpecFileList` = `{ docs: SpecFile[], truncated: boolean }`.
  - `ContextDocUsage` = `{ agents: {id: string, name: string}[], skills: {id: string, name: string}[] }`.
  - `ContextAttachmentStatus` = `z.enum(['ok','too_large','missing'])`.
  - `ContextAttachments` = `{ repo_id: uuid, attached: {path, status, tokens: int|null}[], inherited: {path, skill_id: uuid, skill_name, status, tokens: int|null}[] }`.
  - `ContextAttachmentsInput` = `{ paths: z.array(z.string().min(1)).max(50) }`. Понад 50 відхиляє zod (422). Формат шляху й повтори перевіряє сервіс (422).
  - `GitClient.hasRef(repo: RepoRef, ref: string): Promise<boolean>` в обох `adapters.ts`: без fetch, `false` на будь-яку помилку. Клієнтська копія `adapters.ts` уже відстає від серверної, тому додається лише цей метод.
- **Data**: нова таблиця `context_attachments` у `server/src/db/schema/context.ts`: `id` uuid pk, `workspace_id` → workspaces cascade, `repo_id` → repos cascade, `agent_id` uuid null → agents cascade, `skill_id` uuid null → skills cascade, `path` text, `order` int, `created_at`. CHECK `context_attachments_owner_ck`: рівно один з agent_id/skill_id. Унікальні індекси `(agent_id, repo_id, path)` і `(skill_id, repo_id, path)`, індекс `(repo_id, path)` для usage. Міграція через `pnpm db:generate`.
- **reviewer-core API** (`src/index.ts`): `interface ProjectSpec { path: string; content: string }`; `ReviewInput.specs?: ProjectSpec[]`, `PromptParts.specs?: ProjectSpec[]`; `specLabel(path): string` → `spec:` + path, де `"`/`<`/`>` замінено на `_`; `wrapSpec(spec): string` = `wrapUntrusted(specLabel(path), content)`; `renderSpecsBlock(specs): string | undefined` = `wrapSpec` кожного через `\n\n`, тобто рівно `assembly.specs`.
- **Interfaces (server, `modules/context/`)**:
  - `GET /repos/:id/context` → `SpecFileList`; `GET /repos/:id/context/file?path=` → `SpecFile` (з `content`); `GET /repos/:id/context/usage?path=` → `ContextDocUsage`.
  - `GET|PUT /agents/:id/context?repo_id=` і `GET|PUT /skills/:id/context?repo_id=` → `ContextAttachments`; тіло PUT — `ContextAttachmentsInput`. В скіла `inherited` завжди `[]`.
  - `types.ts`: `ContextOwnerRef = { kind: 'agent'|'skill'; id: string }`; `ContextFacade = { list(ws, repoId): Promise<SpecFileList>; file(ws, repoId, path): Promise<SpecFile>; usage(ws, repoId, path): Promise<ContextDocUsage>; getAttachments(ws, owner, repoId): Promise<ContextAttachments>; setAttachments(ws, owner, repoId, paths): Promise<ContextAttachments> }`; `RunContextInput = { repoId; agentId; repo: RepoRef; clonePath: string|null; base: string }`; `ContextLog = { info(msg: string): void }`; `RunProjectContext = { specs: ProjectSpec[]; specsRead: string[] }`; `RunContextFacade = { resolveForRun(input, log): Promise<RunProjectContext> }`.
  - `ports.ts`: `DocSource = { isClone(root): Promise<boolean>; list(root): Promise<ScannedDoc[]>; read(root, path): Promise<DocRead> }`, де `ScannedDoc = {path, size, mtime: string|null}` (відсортовано за path, правила AC1/AC75) і `DocRead = {kind:'ok', content, size} | {kind:'too_large', size} | {kind:'missing'}` (realpath поза клоном або шлях через symlink на теку → `missing`). `AttachmentStore = { findRepo(ws, repoId): Promise<{id, clonePath: string|null} | null>; ownerExists(ws, owner): Promise<boolean>; listOwn(owner, repoId): Promise<string[]>; replace(ws, owner, repoId, paths): Promise<void>; usage(ws, repoId, path): Promise<ContextDocUsage>; loadForRun(agentId, repoId): Promise<RunAttachments> }`. `RunAttachments = { own: string[]; skills: {skillId, skillName, paths: string[]}[] }` (лише скіли з увімкненим зв'язком і увімкненим скілом, у порядку `agent_skills.order`). `BaseRefReader = Pick<GitClient,'hasRef'|'showFile'>`; `TokenCounter = { count(text): number }`.
  - `domain.ts`: `mergeAttachments(r: RunAttachments): MergedDoc[]` (`MergedDoc = { path; via: {skillId, skillName} | null }`, спершу own, потім скіли, перший запис виграє); `class ContextDomainError { code: 'repo_not_found'|'agent_not_found'|'skill_not_found'|'doc_not_found'|'repo_not_cloned'|'invalid_path' }`. HTTP-мапінг (`http-errors.ts`): `*_not_found` → 404, `repo_not_cloned` → `AppError('repo_not_cloned', …, 409)`, `invalid_path` → 422 `validation_error`.
  - `container.projectContext: ContextFacade` (T7) і `container.runContext: RunContextFacade` (T14), обидва з `ContainerOverrides`.
- **Interfaces (client, `src/lib/hooks/context.ts`)**: `useContextFiles(repoId)` → `SpecFileList`, key `['context', repoId]`, залишається в `core.ts` зі зміненим типом; `useContextFile(repoId, path|null)` → `SpecFile`, key `['context', repoId, 'file', path]`; `useContextUsage(repoId, path|null)` → `ContextDocUsage`, key `['context', repoId, 'usage', path]`; `useContextAttachments(owner: ContextOwner, repoId|null)` → `ContextAttachments`, key `['context-attachments', kind, id, repoId]`; `useSetContextAttachments(owner, repoId)`: мутація `string[]` з оптимістичним оновленням, відкатом кешу в `onError` та invalidate attachments + usage; `useToggleDocAttachment(repoId)`: мутація `{owner, path, attach}` = GET поточних → PUT з доданим у кінець або прибраним шляхом (порядок решти зберігається), як `useAttachSkillToAgents`. `ContextOwner = { kind: 'agent'|'skill'; id: string }`.
- **Panel (client, `src/components/context-docs/`)**: `ContextDocsPanel({ owner, repo: {id, full_name} | null, header: (s: PanelSummary) => ReactNode, footer?: (s: PanelSummary) => ReactNode })`; `PanelSummary = { attachedCount, totalDocs, okTokens /* own+inherited зі status ok */, attachedPaths: string[] }`; `ContextPreviewDrawer({ repoId, path, onClose })`.
- **Strings**: тексти UI беруться дослівно з AC. `messages/en/context.json` (T6) містить групи `page.*` (D1, AC13–AC29, AC81), `panel.*` (рядки, фільтр, статуси, порожні/помилкові стани AC20, AC36, AC42, AC44, AC85–AC88, toast AC38), `preview.*` (AC48/AC49), `attach.*` (AC25/AC27). Наявні ключі не видаляються. `agents.json` (T12): вкладка, заголовок AC78, бейдж AC37, футер AC39/AC40/AC77. `skills.json` (T13): вкладка, заголовок AC78, підказка AC46, бейдж, «SERIALIZES AS»/«Nothing attached» (AC47). `runs.json` (T11): `trace.prompt.specs`. ICU plural для лічильників. Ніяких `<word>` у рядках (client INSIGHTS).
- **Constraints** (`context/constants.ts`): `MAX_DOC_BYTES = 1_048_576`, `MAX_DOCS = 500`, `MAX_ATTACHMENTS = 50`, `CONTEXT_TOKEN_BUDGET = 8000`, `EXCLUDED_DIRS = ['node_modules','.git','dist','build','vendor']` + будь-яка тека на `.` крім `.devdigest`, розширення `.md`/`.mdx`. Рядки Live Log дослівно з AC60, AC61, AC63, AC64, AC65, AC79, AC82; підсумковий рядок обирається за пріоритетом NFR7.

## Requirements review
- **Clarified**: режим виконання → multi-agent (відповідь користувача).
- **Clarified** (з коду): `activeKeyFor` уже повертає `context` для `/context`, а `repoSwitchHref` лишається без змін (зі сторінки → PR-список, як в Assumptions спеки) (AC12).
- **Clarified** (з коду): траса вже показує «Specs read» і `PromptBlock` з copy/fullscreen. Змінюються лише підпис `trace.prompt.specs` і приховування порожнього рядка (AC70–AC74).
- **Clarified** (з коду): тест AC11 «точний текст» реалізується так: сервер рахує токени через експортований з reviewer-core `wrapSpec`, а бюджет — через `renderSpecsBlock`. Окремої копії обгортки на сервері немає.
- **Clarified** (з коду): `server/test/prompt-structured.test.ts` і `prompt-callers.test.ts` передають `specs: string[]` і ламаються від зміни форми. Їх оновлює окрема задача T4.
- **Recommendations**: Step 2 нових рекомендацій не дав (no gaps found).
- **Spec updates needed**: —

## Risks
- Legacy-форма не застосовується: спека має `Status: approved` і лише non-blocking Open questions.
- T7 — найбільша задача (сканер + правила шляхів + сервіс + репозиторій + маршрути). Escalate, якщо вона виходить за Owns або потребує зміни портів з T5.
- Assumption: `Markdown` з `@devdigest/ui` (react-markdown без `rehype-raw`, типовий `urlTransform`) не рендерить сирий HTML і нейтралізує `javascript:`. Якщо тест AC30 падає, потрібна зміна `client/src/vendor/ui/primitives/Markdown.tsx` поза Owns → escalate.
- Assumption: перевірка клону під час запуску (`DocSource.isClone(repos.clone_path)`) і git-читання (`clonePathFor(RepoRef)`) дивляться на ту саму теку, як у наявному коді diff-loader.
- Assumption: для AC69 it-тест створює тимчасову теку з `.git` як `clone_path` і `MockGitClient({ refs, files: {'origin/<base>:<path>': …} })`.
- `pnpm db:generate` T2 лише додає таблицю, без drop, тож інтерактивного питання «created or renamed?» не буде (server INSIGHTS 2026-10-19). Якщо воно з'явиться, проганяти через pty.
- `*.it.test.ts` у пісочниці self-skip-аються: `check.sh` повертає exit 3. Проганяти без sandbox і перевіряти, що skipped = 0 (server INSIGHTS 2026-10-22).
- e2e (T16) не запускається на цьому хості (macOS 12, e2e INSIGHTS 2026-10-18) → skip-verify, перевірка на CI.
- Manual check: NFR1 — розробник 10 разів запускає `GET /repos/:id/context` на фікстурному клоні (500 файлів, ≤ 5 MB) і записує p95 ≤ 2 000 мс у PR.
- Manual check: NFR3 — розробник на 5 запусках порівнює час між рядками Live Log «Skills: …» і «Project context: …» (p95 ≤ 500 мс).
- Manual check: NFR4 — перед мержем прохід лише клавіатурою: checkbox-и, grip ArrowUp/ArrowDown, меню «Attach to…», шухляда прев'ю, Esc.

---

## Wave 0 — foundation (sequential)

### T1 [SHARED] Контракти Project Context + `GitClient.hasRef`
Owns: `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts`, `server/src/adapters/git/simple-git.ts`, `server/src/adapters/mocks.ts`, `server/test/contracts.test.ts`
Depends on: —
Skills: zod
Route: agent
Interfaces: провайдить `SpecFile` (розширений), `SpecFileList`, `ContextDocUsage`, `ContextAttachmentStatus`, `ContextAttachments`, `ContextAttachmentsInput`, `GitClient.hasRef` (див. Cross-task decisions); `MockGitClient` отримує опцію `refs?: string[]` (`hasRef` → `refs.includes(ref)`, типово `false`).
Steps:
1. Test: `server/test/contracts.test.ts` — parse/reject кейси нових схем (status/category enum, `tokens: null`, `paths` > 50 → fail) (AC2).
2. Додати схеми в обидві копії `platform.ts` з однаковим текстом; експорт через наявні barrel-и.
3. `hasRef` в обох `adapters.ts`; `SimpleGitClient.hasRef` = `rev-parse --verify --quiet <ref>^{commit}` у try/catch, без fetch; `MockGitClient.hasRef`.
Acceptance:
- AC2 [unit] `SpecFile` містить `path`, `folder`, `category`, `size`, `tokens`, `status`; схеми однакові в обох копіях.
- AC79 [unit] `hasRef` існує в порті, адаптері й моку та ніколи не робить fetch.
Verify: `scripts/check.sh server typecheck test test/contracts.test.ts` · `scripts/check.sh client typecheck` · `scripts/check.sh mcp typecheck`
Escalate if: клієнтський typecheck ламається через дрейф копії `adapters.ts` поза `GitClient`.

### T2 [BE] Таблиця `context_attachments`
Owns: `server/src/db/schema/context.ts`, `server/src/db/migrations/**` (лише згенеровані `pnpm db:generate`)
Depends on: T1
Skills: drizzle-orm-patterns, postgresql-table-design
Route: agent
Steps:
1. Додати таблицю за Cross-task decisions → Data (FK cascade на workspaces/repos/agents/skills, CHECK, два unique-індекси, індекс usage).
2. `cd server && pnpm db:generate`; руками міграцію не редагувати.
Acceptance:
- AC54 [it] FK `on delete cascade` на agents, skills і repos (перевіряє T15).
Verify: `cd server && pnpm db:generate` · `scripts/check.sh server typecheck`
Escalate if: generate просить rename/drop наявних колонок.

### T3 [BE] reviewer-core: `specs` як `{ path, content }[]`
Owns: `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/src/index.ts`, `reviewer-core/test/prompt.test.ts`, `reviewer-core/test/run.test.ts`, `reviewer-core/README.md`
Depends on: T1
Skills: —
Route: agent
Interfaces: провайдить `ProjectSpec`, `specLabel`, `wrapSpec`, `renderSpecsBlock` (див. Cross-task decisions); `ReviewInput.specs`/`PromptParts.specs` змінюють тип.
Steps:
1. Test: `reviewer-core/test/prompt.test.ts` — мітка `spec:<path>` із заміною `"`, `<`, `>` (AC62); кожен документ в окремому `<untrusted>` у user-повідомленні, секція `## Project context` у порядку вхідного масиву, у system немає тексту документа, `INJECTION_GUARD` не змінено (AC59, AC66); `assembly.specs === renderSpecsBlock(specs)`, а при порожньому масиві `null`.
2. Test: `reviewer-core/test/run.test.ts` — під map-reduce кожен per-file виклик LLM містить той самий блок `## Project context` (AC76).
3. Змінити типи й `assemblePrompt`, експортувати хелпери з `index.ts`, оновити §Public API у README.
Acceptance:
- AC59 [unit] документи в порядку входу, кожен в окремому `<untrusted>` у секції `## Project context`.
- AC62 [unit] пари `{path, content}`, `source="spec:<path>"` із санітизацією.
- AC66 [unit] лише user-повідомлення; `INJECTION_GUARD` і grounding не змінено.
- AC76 [unit] блок є в кожному map-виклику.
Verify: `scripts/check.sh reviewer-core typecheck test`
Escalate if: потрібно змінити `INJECTION_GUARD`, `wrapUntrusted` або grounding.

### T4 [BE] Оновити server-тести промпту під нову форму `specs`
Owns: `server/test/prompt-structured.test.ts`, `server/test/prompt-callers.test.ts`
Depends on: T3
Skills: —
Route: inline
Steps:
1. Замінити `specs: ['…']` на `specs: [{ path: 'specs/security-baseline.md', content: '…' }]`. Асерти на секції не змінюються, крім мітки `spec:specs/security-baseline.md`.
Acceptance:
- AC62 [unit] server-тести збірки промпту проходять з `{path, content}` і новою міткою.
Verify: `scripts/check.sh server typecheck test test/prompt-structured.test.ts test/prompt-callers.test.ts`
Escalate if: падають інші server-тести через зміну типу `specs`.

### T5 [BE] Основа модуля context: порти, типи, константи, злиття
Owns: `server/src/modules/context/constants.ts`, `server/src/modules/context/ports.ts`, `server/src/modules/context/types.ts`, `server/src/modules/context/domain.ts`, `server/test/context-domain.test.ts`
Depends on: T1, T3
Skills: onion-architecture
Route: agent
Interfaces: провайдить усе з Cross-task decisions → Interfaces (server) для `ports.ts`, `types.ts`, `domain.ts`, а також Constraints.
Steps:
1. Test: `server/test/context-domain.test.ts` — `mergeAttachments`: спершу own у збереженому порядку, потім кожен скіл у своєму порядку; повтор `path` прибирається, перший запис виграє (і own над скілом, EC6); `via` заповнено лише для скілових (AC57, AC41).
2. Написати файли; `domain.ts` чистий (лише `import type` з `@devdigest/shared`/reviewer-core).
Acceptance:
- AC57 [unit] порядок злиття й дедуплікація.
- AC41 [unit] успадковані = скілові записи без тих, що вже є в own, у порядку злиття.
Verify: `scripts/check.sh server typecheck arch test test/context-domain.test.ts`
Escalate if: портам потрібні типи, яких немає в T1/T3.

### T6 [FE] Хуки Project Context і рядки `context.json`
Owns: `client/src/lib/hooks/context.ts`, `client/src/lib/hooks/context.test.tsx`, `client/src/lib/hooks/core.ts`, `client/src/lib/hooks/index.ts`, `client/src/lib/types.ts`, `client/messages/en/context.json`
Depends on: T1
Skills: react-best-practices, client-testing
Route: agent
Interfaces: провайдить хуки й `ContextOwner` з Cross-task decisions → Interfaces (client); реекспорт нових типів у `lib/types.ts`; повний набір ключів `context.json` (групи `page/panel/preview/attach`). `useReindexContext` та наявні ключі `context.json` не видаляти (майбутній урок).
Steps:
1. Test: `client/src/lib/hooks/context.test.tsx` — query key містить пару (owner, repo): зміна `repoId`/`owner` дає новий запит без даних попередньої пари (AC43). `useSetContextAttachments` при помилці повертає кеш до стану перед мутацією (AC38). `useToggleDocAttachment` додає шлях у кінець і прибирає зі збереженням порядку решти (AC26, AC83).
2. Хуки через `api.get/put`. URL: `/repos/${id}/context`, `/context/file?path=`, `/context/usage?path=`, `/${kind}s/${id}/context?repo_id=` (параметри через `encodeURIComponent`).
3. `context.json`: усі рядки сторінки, панелі, прев'ю й «Attach to…» дослівно з AC, з ICU plural.
Acceptance:
- AC43 [unit] дані й мутації прив'язані до пари (агент/скіл, репо).
- AC38 [unit] відкат кешу при помилці збереження.
- AC26 [unit] додати в кінець; AC83 [unit] прибрати зі збереженням порядку.
Verify: `scripts/check.sh client typecheck test src/lib/hooks/context`
Escalate if: потрібен runtime-імпорт з `@devdigest/shared` (дозволено лише `import type`, client INSIGHTS).

## Wave 1 — parallel (disjoint Owns)

### T7 [P] [BE] Context API: сканер, правила шляхів, сервіс, репозиторій, маршрути
Owns: `server/src/modules/context/paths.ts`, `server/src/modules/context/fs-scanner.ts`, `server/src/modules/context/service.ts`, `server/src/modules/context/repository.ts`, `server/src/modules/context/helpers.ts`, `server/src/modules/context/http-errors.ts`, `server/src/modules/context/routes.ts`, `server/src/modules/context/compose.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/test/context-paths.test.ts`, `server/test/context-fs-scanner.test.ts`, `server/test/context-service.test.ts`, `server/test/context-routes.test.ts`, `server/README.md`
Depends on: T1, T2, T5
Skills: onion-architecture, fastify-best-practices, security
Route: agent
Interfaces: провайдить маршрути з Cross-task decisions; `container.projectContext` + `ContainerOverrides.projectContext`; `createContextFacade(c)` у `compose.ts`; `AttachmentStore` (включно з `loadForRun`) у `repository.ts`; `FsDocSource implements DocSource` у `fs-scanner.ts`; `paths.ts`: `validateDocPath(p): {ok: true} | {ok: false; reason}`, `categoryOf(path)`, `folderOf(path)`. Споживає `wrapSpec` (T3), `container.tokenizer`.
Steps:
1. Test: `server/test/context-paths.test.ts` — 422-правила (абсолютний, `..`, не `.md/.mdx`, виключена тека, крапкова тека крім `.devdigest/`) (AC9); `category` (AC3); `folder` з `/` або `""` (AC2).
2. Test: `server/test/context-fs-scanner.test.ts` (тимчасова тека на реальній ФС) — фільтр розширень і тек, сортування за path (AC1); > 1 MB → `too_large` без читання (AC4); symlink на теку не обходиться, у т.ч. циклічний, а symlink-файл поза клоном відкидається (AC75); `read` повертає `missing` для realpath поза клоном і для шляху через symlink на теку (AC51, AC9); `isClone` = тека існує і є git-деревом (AC6).
3. Test: `server/test/context-service.test.ts` (фейки портів) — `tokens = count(wrapSpec)` (AC11); перші 500 + `truncated` (AC5); file повертає вміст (AC8), а відсутній або > 1 MB дає `doc_not_found` (AC10); статуси `attached` незалежно від межі 500 (AC90); `inherited` без own (AC41); PUT з поганим шляхом, повтором → `invalid_path` без запису (AC52); неіснуючий агент, скіл чи репо → `*_not_found` (AC53); не клоновано → `repo_not_cloned` для list і GET attachments (AC6, AC91).
4. Test: `server/test/context-routes.test.ts` (`buildApp` + override `projectContext`) — 404 для трьох `/repos/:id/context*` (AC7), 409 `repo_not_cloned` (AC6, AC91), 422 на `paths` > 50 і на `invalid_path` (AC52), 404 для GET/PUT attachments (AC53), відповіді проходять response-схеми.
5. Реалізація: PUT = заміна списку однією транзакцією в репозиторії (delete + insert за порядком). Агенти й скіли не оновлюються (AC55). Реєстрація в `modules/index.ts`, геттер у `container.ts`, рядки §API map у `server/README.md`.
Acceptance:
- AC1 [unit] AC2 [unit] AC3 [unit] AC4 [unit] AC5 [unit] — сканування й форма відповіді.
- AC6 [unit] AC7 [unit] AC8 [unit] AC9 [unit] AC10 [unit] AC11 [unit] AC75 [unit] — помилки, правила шляхів, токени.
- AC52 [unit] AC53 [unit] AC91 [unit] — валідація й помилки прикріплень.
- AC50 [it] AC51 [it] AC55 [it] AC56 [it] — реалізовано тут, перевіряє T15.
Verify: `scripts/check.sh server typecheck arch test test/context-paths.test.ts test/context-fs-scanner.test.ts test/context-service.test.ts test/context-routes.test.ts`
Escalate if: потрібна зміна `ports.ts`/`types.ts`/`domain.ts` (T5) або модуля agents/skills.

### T8 [P] [BE] Run resolver: злиття → ref → читання з `origin/<base>` → бюджет
Owns: `server/src/modules/context/run-context.service.ts`, `server/test/context-run.test.ts`
Depends on: T3, T5
Skills: onion-architecture
Route: agent
Interfaces: `class RunContextService { constructor(deps: { store: Pick<AttachmentStore,'loadForRun'>; docs: Pick<DocSource,'isClone'>; git: BaseRefReader; tokenizer: TokenCounter }); resolveForRun(input: RunContextInput, log: ContextLog): Promise<RunProjectContext> }`. Споживає `mergeAttachments` (T5), `renderSpecsBlock` (T3).
Steps:
1. Test: `server/test/context-run.test.ts` (фейки; токенізатор рахує, напр., символи) — порядок AC57; читання `showFile(repo, 'origin/<base>', path)`, ніколи `head_sha` (AC58); тексти в порядку злиття (AC59); бюджет по `renderSpecsBlock` з наступним документом: документи ≈5000/4000/2000 → входять 1-й і 3-й, лог `skipped <path> (budget)`, блок ≤ 8000 (AC60, NFR2); `null`, > 1 MB або помилка → `skipped <path> (missing)` (AC61); п'ять підсумкових випадків NFR7 з рівно одним рядком за пріоритетом: none attached (AC64) → repo not cloned (AC63) → base not fetched без fetch і без `showFile` (AC79) → `{n} doc(s), +{T} tokens — …` (AC65) / all skipped (AC82); зміна store після виклику не впливає на результат (AC67); `specsRead` = вставлені шляхи в порядку, а при нулі документів `specs = []` (AC68).
2. Реалізація без імпорту адаптерів і контейнера (rule service-no-container).
Acceptance:
- AC57 [unit] AC58 [unit] AC59 [unit] AC60 [unit] AC61 [unit] — збір і читання.
- AC63 [unit] AC64 [unit] AC65 [unit] AC79 [unit] AC82 [unit] — підсумкові рядки Live Log.
- AC67 [unit] набір фіксується на старті; AC68 [unit] `specsRead` і блок для траси.
Verify: `scripts/check.sh server typecheck arch test test/context-run.test.ts`
Escalate if: потрібен порт поза `ports.ts` з T5.

### T9 [P] [FE] Сторінка Project Context + пункт сайдбару
Owns: `client/src/app/repos/[repoId]/context/**`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.test.ts`, `client/README.md`
Depends on: T6
Skills: react-best-practices, next-best-practices, client-testing
Route: agent
Interfaces: `page.tsx` (за зразком `conventions/page.tsx`: `AppShell`, `RepoNotFound`, `useActiveRepo`) + `_components/ContextView/` (список, прев'ю, «Used by», «Attach to…»). Споживає хуки T6, `useAgents`, `useSkills`, `Markdown` з `@devdigest/ui`, toast з `src/lib/toast.tsx`.
Steps:
1. design: `specs/designs/2026-10-24-project-context/D1.png` (без New/Folder/Upload/Edit/Coverage/«Indexed…»).
2. Test: `client/src/components/app-shell/helpers.test.ts` — у `NAV` у групі WORKSPACE є пункт `context` з `href: '/repos/:repoId/context'` без `gKey`; `activeKeyFor('/repos/r/context') === 'context'` (AC12).
3. Test: `_components/ContextView/ContextView.test.tsx` — групування за folder і шапка з plural (AC13); вибір `?doc=` / перший `ok` / перший (AC14); клік → GFM-прев'ю (AC15); `too_large` → повідомлення без запиту (AC81, AC20); скелетони (AC16); порожні стани AC17, AC18, AC19; «Showing the first 500 documents.» (AC21); помилки списку й прев'ю з Retry (AC22, AC23); «Used by …» (AC24); меню «Attach to…»: розділи й позначки (AC25), позначити/зняти (AC26, AC83), відкат + toast (AC27); у тулбарі лише Refresh (AC28); Refresh перезапитує з `aria-busy` (AC29); сирий HTML не виконується, `javascript:` не активне (AC30).
4. Додати пункт у `nav.ts` (WORKSPACE, після Pull Requests, іконка `Folder`, якщо вона є в `IconName`) і рядок у §UI route map у `client/README.md`.
Acceptance:
- AC12 [unit] AC13 [unit] AC14 [unit] AC15 [unit] AC16 [unit] AC17 [unit] AC19 [unit] AC20 [unit] AC21 [unit] AC22 [unit] AC23 [unit] AC81 [unit] — список і прев'ю.
- AC18 [unit] стан «не клоновано» (e2e — T16).
- AC24 [unit] AC26 [unit] AC83 [unit] — «Used by» / «Attach to…» (it — T15); AC25 [unit] AC27 [unit].
- AC28 [unit] AC29 [unit] AC30 [unit] — тулбар і безпечний Markdown.
Verify: `scripts/check.sh client typecheck test /context/ app-shell/helpers`
Escalate if: AC30 вимагає змінити `client/src/vendor/ui/primitives/Markdown.tsx`.

### T10 [P] [FE] Спільна панель прикріплень і шухляда прев'ю
Owns: `client/src/components/context-docs/**`
Depends on: T6
Skills: react-best-practices, client-testing
Route: agent
Interfaces: провайдить `ContextDocsPanel`, `PanelSummary`, `ContextPreviewDrawer` (див. Cross-task decisions → Panel), експорт з `src/components/context-docs/index.ts`. Reorder за зразком `agents/[id]/.../SkillsTab` (drag + ArrowUp/ArrowDown, фільтр вимикає reorder).
Steps:
1. design: `specs/designs/2026-10-24-project-context/D2.png`, `D3.png`.
2. Test: `ContextDocsPanel.test.tsx` — порядок own → inherited → решта за path, у рядку grip/checkbox/ім'я/тека/тег/«{n} tok»/Preview (AC32, AC41); позначити → PUT з доданим у кінець (AC33), зняти → PUT без нього (AC84); drag (AC34) і ArrowUp/ArrowDown на grip, без дії на краях (AC35); grip неприкріплених disabled (AC80); фільтр, disabled grip-и, «No documents match» (AC36); відкат + toast (AC38); `too_large` неприкріплений приглушений без checkbox/Preview (AC20); own `missing` і `too_large` з Detach без токенів (AC42, AC89); own `ok` поза 500 — звичайний рядок (AC90); стани 409 (AC44), без документів (AC85), без репо (AC86), помилка + Retry (AC87), скелетони (AC88); Preview відкриває шухляду (AC45); `PanelSummary.okTokens` = own + inherited зі статусом `ok`.
3. Test: `ContextPreviewDrawer.test.tsx` — заголовок `path` + Markdown, Esc/кнопка повертають фокус на Preview (AC48); помилка + Retry (AC49); скелетон (AC16).
4. a11y: checkbox з ім'ям файлу, grip з `aria-label` «Reorder {file}» (NFR4).
Acceptance:
- AC32 [unit] AC33 [unit] AC34 [unit] AC84 [unit] AC35 [unit] AC80 [unit] AC36 [unit] — список і порядок (it для AC33/AC34/AC84 — T15).
- AC38 [unit] AC20 [unit] AC41 [unit] AC42 [unit] AC89 [unit] AC90 [unit] — статуси й успадковані.
- AC44 [unit] AC85 [unit] AC86 [unit] AC87 [unit] AC88 [unit] — стани.
- AC45 [unit] AC48 [unit] AC49 [unit] AC16 [unit] — шухляда прев'ю.
Verify: `scripts/check.sh client typecheck test components/context-docs`
Escalate if: потрібен файл поза `src/components/context-docs/`.

### T11 [P] [FE] Траса: підпис Project context і Specs read
Owns: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx`, `client/messages/en/runs.json`
Depends on: T1
Skills: client-testing
Route: agent:haiku
Steps:
1. design: `specs/designs/2026-10-24-project-context/D4.png`.
2. Test: `RunTraceDrawer.test.tsx` — «Specs read» зі шляхами через пробіл або «none» (AC70); рядок «Project context — attached specs (untrusted)» з токенами `block_tokens.specs` (AC71); expand показує повний текст (AC72); copy пише повний текст у `navigator.clipboard` (AC73); `specs: null`/відсутнє/`""` → рядка немає, без падіння (AC74).
3. `runs.json` `trace.prompt.specs` → «Project context — attached specs (untrusted)»; у `TraceBody` умова показу `pa.specs` — непорожній рядок.
Acceptance:
- AC70 [unit] AC71 [unit] AC72 [unit] AC73 [unit] AC74 [unit]
Verify: `scripts/check.sh client typecheck test RunTraceDrawer`
Escalate if: зміни потрібні в `PromptBlock`.

## Wave 2 — tabs, run wiring, integration

### T12 [P] [FE] Вкладка Context агента
Owns: `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/**`, `client/messages/en/agents.json`
Depends on: T10
Skills: react-best-practices, client-testing
Route: agent
Interfaces: `ContextTab({ agent: Agent })` = `ContextDocsPanel` з `owner {kind:'agent'}`, header і footer; монтується з `key={`${agent.id}:${repoId}`}` (client INSIGHTS 2026-10-19).
Steps:
1. design: `specs/designs/2026-10-24-project-context/D2.png`.
2. Test: `AgentEditor.test.tsx` — вкладка «Context» між Skills і Evals, `?tab=context` (AC31). Test: `ContextTab/ContextTab.test.tsx` — заголовок «Project context · {owner/name}» (AC78); бейдж «{attached} of {total} attached» (own з будь-яким статусом, «3 of 500») (AC37); «≈ {N} tokens / 8,000» + текст про untrusted (AC39); попередження > 8 000 (AC40); підказка для `map-reduce`/`auto` (AC77); зміна агента або репо → рядки нової пари (AC43).
Acceptance:
- AC31 [unit] вкладка й `?tab=context` (e2e — T16).
- AC37 [unit] AC39 [unit] AC40 [unit] AC77 [unit] AC78 [unit] AC43 [unit]
Verify: `scripts/check.sh client typecheck test AgentEditor`
Escalate if: потрібна зміна `ContextDocsPanel`.

### T13 [P] [FE] Вкладка Context скіла
Owns: `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx`, `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`, `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/**`, `client/messages/en/skills.json`
Depends on: T10
Skills: react-best-practices, client-testing
Route: agent
Interfaces: `ContextTab({ skill: Skill })` = `ContextDocsPanel` з `owner {kind:'skill'}`, без футера токенів; `key={`${skill.id}:${repoId}`}`.
Steps:
1. design: `specs/designs/2026-10-24-project-context/D3.png`.
2. Test: `ContextTab/ContextTab.test.tsx` — вкладка між Config і Preview, `?tab=context`, підказка (AC46); «SERIALIZES AS»: `## Project context` + `- <path>` за порядком або «Nothing attached» (AC47); бейдж «{n} attached» (AC37); заголовок «Project context to use · {owner/name}» (AC78); нова пара (скіл, репо) → нові рядки (AC43).
Acceptance:
- AC46 [unit] AC47 [unit] AC37 [unit] AC78 [unit] AC43 [unit]
Verify: `scripts/check.sh client typecheck test SkillEditor`
Escalate if: потрібна зміна `ContextDocsPanel`.

### T14 [P] [BE] Підключити Project context до запуску
Owns: `server/src/modules/context/compose.ts`, `server/src/platform/container.ts`, `server/src/modules/reviews/run-executor.ts`, `server/test/context-run.it.test.ts`
Depends on: T7, T8
Skills: onion-architecture
Route: agent
Interfaces: `createRunContextFacade(c): RunContextFacade` (store = `ContextRepository`, docs = `FsDocSource`, git = `c.git`, tokenizer = `c.tokenizer`); `container.runContext` + `ContainerOverrides.runContext`. `runOneAgent` викликає `resolveForRun({ repoId: pull.repoId, agentId: agent.id, repo: {owner, name}, clonePath: repo.clonePath, base: pull.base }, runLog)` один раз після skills, передає `specs` лише коли непорожні й пише `specs_read: specsRead`.
Steps:
1. Test: `server/test/context-run.it.test.ts` (testcontainers; `MockGitClient({ refs: ['origin/main'], files })`, тимчасовий `clone_path` з `.git`, прикріплення агента + увімкненого скіла) — POST рев'ю (той самий маршрут, що й у MCP `run_agent_on_pr`) → траса має `specs_read` у порядку злиття, `prompt_assembly.specs` = повний блок, `block_tokens.specs` ≤ 8000; агент без прикріплень → `specs_read: []`, `prompt_assembly.specs: null`, рядок `Project context: none attached` (AC68, AC69).
2. Підключення в compose/container/run-executor; `traceFromBuffer` лишається з `specs_read: []`.
Acceptance:
- AC68 [it] траса завершеного запуску з `specs_read`/`prompt_assembly.specs`/`block_tokens.specs` (`[unit]` — T8).
- AC69 [it] той самий шлях для UI-запуску й MCP (маршрут рев'ю).
Verify: `scripts/check.sh server typecheck arch test test/context-` · `scripts/check.sh server it context-run.it.test.ts reviews.it.test.ts`
Escalate if: run-executor потребує імпорту з модуля context поза `container.runContext`.

### T15 [P] [BE] Інтеграційний тест Context API
Owns: `server/test/context.it.test.ts`
Depends on: T7
Skills: —
Route: agent
Steps:
1. Test: `server/test/context.it.test.ts` (testcontainers + тимчасовий клон із `.md`) — PUT замінює список у порядку й повертає `ContextAttachments` (AC50); GET `attached` зі статусами `ok/too_large/missing` (symlink-втеча → `missing`) і `inherited` лише від увімкнених скілів (AC51, AC41); `ok` поза 500 (AC90); додати/прибрати/змінити порядок (AC33, AC84, AC34, AC26, AC83); usage з агентами й скілами (AC56, AC24); видалення агента, скіла й репо видаляє прикріплення (AC54); `version` і `*_versions` не змінюються (AC55); новий інстанс app на тій самій БД → той самий порядок (NFR6).
Acceptance:
- AC50 [it] AC51 [it] AC54 [it] AC55 [it] AC56 [it]
- AC24 [it] AC26 [it] AC83 [it] AC33 [it] AC34 [it] AC84 [it] AC41 [it] AC90 [it] (`[unit]`-частини — T6/T9/T10/T5/T7)
Verify: `scripts/check.sh server it context.it.test.ts`
Escalate if: тест вимагає змін у модулі context (повернути в T7 через fix loop).

## Wave 3 — e2e

### T16 [FE] e2e: стани «не клоновано» на сторінці та у вкладці
Owns: `e2e/specs/10-project-context.flow.json`
Depends on: T9, T12
Skills: —
Route: agent:haiku
Steps:
1. Flow на seed-даних (`acme/payments-api`, `clonePath: null`): сайдбар «Project Context» → текст «Repository isn't cloned yet — sync it to see its documents.» (AC18); `/agents` → Security Reviewer → вкладка Context (`?tab=context`) (AC31) → той самий текст (AC44). Лише локатори `--url`/`--text`/`find`, без `chat`.
Acceptance:
- AC18 [e2e] сторінка в стані «не клоновано» (`[unit]` — T9).
- AC31 [e2e] вкладка Context відкривається (`[unit]` — T12).
- AC44 [e2e] вкладка в стані «не клоновано» (`[unit]` — T10).
Verify: `cd e2e && npm run e2e:hermetic` (skip-verify на цьому хості macOS 12 — e2e/INSIGHTS 2026-10-18; перевірка на CI)
Escalate if: seed-репо виявилось клонованим.

---

## Execution
Run with `/run-plan plan: specs/plans/2026-10-24-project-context.md` — the procedure
(dispatch, merge + gate + commit per wave, review, fix loop, finish) lives in
`.claude/skills/run-plan/references/execute.md` and `review-fix.md`.
Plan-specific notes for the orchestrator (host limits, skip-verify, ordering)
go here:
- Wave 0 іде строго T1 → T2 → T3 → T4 → T5 → T6 у main checkout.
- T16 — skip-verify на цьому хості (macOS 12); e2e проганяється на CI.
- T14 і T15 (`check.sh server it`) — без sandbox; exit 3 (self-skip) не є pass.
- T7 і T14 обидва володіють `compose.ts` і `container.ts`, але в різних хвилях (W1 і W2), тож перетину в межах хвилі немає.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | done | check.sh typecheck needed pnpm 12 `--silent` fix (applied by orchestrator) |
| T2 | done | migration 0015; table not in `schema` object of db/schema.ts (outside Owns) → repositories use db.select/insert, not db.query |
| T3 | done | tests written after code (no red evidence) |
| T4 | done | inline by orchestrator; added spec: label assert |
| T5 | done | RunAttachments/MergedDoc live in types.ts; extra consts INCLUDED_DOT_DIR, DOC_EXTENSIONS |
| T6 | done | some context.json keys (panel.title/skillTitle, grip) are implementer wording — no AC text |
| T7 | done | merged 15e2689; PUT on uncloned → 409 (consistent with AC6); /context/file has no updated_at (DocSource.read has no mtime) — check in Phase 5 |
| T8 | done | merged e0f5dce; arch fail in worktree = symlinked node_modules artifact, PASS in main checkout; missing = null/throw/>1MB |
| T9 | done | merged 06af8fc; no red run for ContextView.test; skeleton via data-testid (no loading string) |
| T10 | done | merged c987f2b; panel needs ToastProvider; header+Filter share top row; Drawer close label hardcoded in kit |
| T11 | done | haiku, main checkout; no red-evidence reported |
| T12 | todo | |
| T13 | todo | |
| T14 | todo | |
| T15 | todo | |
| T16 | todo | |
