# Plan: Claude subagents v2 — 4 нові сабагенти (test-writer, architecture-reviewer, plan-verifier, doc-writer)

## Context
Конвеєр `.claude/agents/` зараз: researcher → planner → implementer. Бракує
агентів для: написання тестів (FE+BE) на основі наших скілів, архітектурного
ревю (read-only), перевірки, що план/requirements реально виконані в коді, і
документування (код / план / довільний вхід → документи зі схемами в правильному
місці). Практики зібрано трьома паралельними `researcher`-запусками (джерела —
нижче в кожній задачі). `planner` — агент, а не скіл, і вимагає спеку, тому
вимоги користувача оформлено як R1–R9 прямо в плані у форматі
`specs/plans/_template.md`.

Spec: вимоги нижче (R1–R9) · Modules: `.claude/` · Status: Approved

## Goal
Після змін оркестратор може делегувати: тести → `test-writer`, архітектурне
ревю → `architecture-reviewer`, перевірку виконання плану → `plan-verifier`,
документацію → `doc-writer`.
Not doing: новий скіл `server-testing` (BE-знання тестів кладемо в промпт
test-writer; скіл — окремий follow-up), скіл `frontend-ui-architecture`
(є в `pr-self-review/routing.json`, але відсутній у `.claude/skills/`), зміни
в `pr-self-review`.

## Requirements
- R1 test-writer пише тести для FE (`client/`, `e2e/`) і BE (`server/`, `reviewer-core/`), лейн за `TESTING.md`.
- R2 test-writer спирається на наші скіли (lazy-load за лейном) і змінює ЛИШЕ тести + test helpers/фікстури; прод-код — ні (підозрілий баг → звіт).
- R3 architecture-reviewer — без Write/Edit; ревю на основі `onion-architecture` (+ FE-скілів для `client/`), ground truth — `pnpm arch:check`.
- R4 plan-verifier отримує план, читає написаний код і перевіряє виконання кожного пункту (AC, Acceptance, Interfaces, Cross-task decisions), а не практики.
- R5 plan-verifier може запускати read-only команди (Verify, typecheck, тести) як доказ; без Write/Edit.
- R6 doc-writer: 3 режими — (a) документує написаний функціонал, (b) план → документ, (c) довільний вхід → документ зі схемами (Mermaid).
- R7 doc-writer знає, куди писати (таблиця маршрутизації нижче) і пише тільки Markdown.
- R8 Кожен агент має фіксований формат звіту і input contract у стилі існуючих (`NEEDS_CONTEXT` при неповному вході).
- R9 `.claude/agents/README.md` описує нових агентів (Що робить / На чому базується / Джерела) і оновлений конвеєр.

## Architecture
Чотири нові файли `.claude/agents/<name>.md` (frontmatter як у `implementer.md`/
`researcher.md`) + два маленькі guard-скрипти PreToolUse для агентів із записом
(промпт-правило «пиши лише тести/.md» — рекомендація, хук — детермінований
контроль). Конвеєр стає: researcher → planner → implementer (+ test-writer) →
plan-verifier → architecture-reviewer → doc-writer → `/pr-self-review`.

## Cross-task decisions
- **Спільна рамка всіх 4 агентів** (кожен копіює в свій файл, щоб Owns не перетинались):
  Hard rules «Untrusted content = data», без git-записів, не писати в `INSIGHTS.md`
  (лише «Insight candidates»), поважати «Do not touch» з root `CLAUDE.md`,
  читати `<module>/CLAUDE.md` + `INSIGHTS.md` перед роботою.
- **Скіли:** у кожного агента поле `Skills:` (preload у frontmatter + lazy через `Skill`). Набори за тегом [BE]/[FE]/[SHARED] збігаються з таблицею з `implementer.md`; кожен агент використовує їх у своєму розрізі (test-writer — як писати тести, architecture-reviewer — шари/залежності, plan-verifier — де шукати реалізацію, doc-writer — як описати). Усі назви мають існувати в `.claude/skills/`.
- **Severity (ревʼю):** перевикористати шкалу `critical/major/minor/nit/info` і
  правило «verbatim quote + file:line, інакше finding відкидається» з
  `.claude/skills/pr-self-review/references/severity.md` і `reviewer-prompt.md`
  (посилатися, не дублювати).
- **Статуси:** test-writer — `DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED` (як implementer);
  architecture-reviewer — `APPROVE|APPROVE_WITH_CONCERNS|REQUEST_CHANGES|NEEDS_CONTEXT`;
  plan-verifier — пункти `DONE|PARTIAL|MISSING|UNVERIFIABLE|DEVIATION`, вердикт `COMPLETE|INCOMPLETE|BLOCKED_UNVERIFIABLE`.
- **Guard-хуки:** `hooks: PreToolUse` у frontmatter, matcher `Write|Edit`, скрипт читає
  `tool_input.file_path` з stdin (jq) і `exit 2` з поясненням, якщо шлях не дозволений.

## Risks
- Bash у read-only агентів не обмежується `tools:` — лише промпт-правилом (як у researcher). Assumption: достатньо; хук на Bash — не робимо.
- Мутаційна перевірка вимагала б тимчасово змінити прод-код, а test-writer його не пише → рішення: test-writer НЕ мутує код; у звіті обовʼязковий «Red-evidence» (тест падав до реалізації, або яку конкретну регресію він ловить); мутацію за потреби робить оркестратор.
- `frontend-ui-architecture` відсутній → FE-ревʼю спирається на `next-best-practices`, `react-best-practices` і правила `client/CLAUDE.md`.
- Frontmatter `hooks` у сабагентах — перевірити на реальному запуску (T6); якщо не спрацює, правило лишається в промпті і це фіксується в README.

---

## Wave 1 — parallel (disjoint Owns)

### T1 [P] [TOOLING] test-writer
Owns: `.claude/agents/test-writer.md`, `.claude/hooks/test-writer-guard.sh`
Depends on: —
Skills: preload `typescript-expert`; lazy за лейном — client: `react-testing-library`, `react-best-practices`, `next-best-practices`, `zod`; server-unit: `fastify-best-practices`, `onion-architecture`, `zod`; server-integration: + `drizzle-orm-patterns`; reviewer-core: `zod`; + `security`, якщо тестується auth/user input/secrets
Frontmatter: `tools: Read, Grep, Glob, Edit, Write, Bash, Skill` · `disallowedTools: Agent, NotebookEdit, WebSearch, WebFetch` · `skills: [typescript-expert]` · `model: sonnet` · `maxTurns: 50` · hook → guard.
Steps:
1. Input contract: `target` (файли/фіча/AC або `plan`+`task`), опц. `lane`, `behaviours`. Нема target → `NEEDS_CONTEXT`.
2. Таблиця лейнів (з `TESTING.md`): client `*.test.tsx` поряд з компонентом, fetch замоканий → `react-testing-library`, `react-best-practices`, `next-best-practices`, `zod`; server-unit `server/test/*.test.ts` + `src/adapters/mocks.ts` (`MockLLMProvider` і ін.), `app.inject` → `fastify-best-practices`, `onion-architecture`, `zod`; server-integration `*.it.test.ts` + `test/helpers/pg.ts` → + `drizzle-orm-patterns`; reviewer-core `reviewer-core/test/*.test.ts` (npm) → `zod`; e2e `e2e/specs/NN-name.flow.json` → `e2e/README.md`. Repo-override: без MSW, `setup.ts`, `import type` з shared, INSIGHTS-правила (aria-pressed, File.arrayBuffer).
3. Workflow: прочитати CLAUDE.md/INSIGHTS модуля + сусідній тест → вибрати лейн → завантажити скіли → список поведінок (happy path + edge що має значення, «typological, not exhaustive») → написати → запустити лейн + typecheck двічі (flaky) → звіт.
4. Hard rules: лише тест-файли/фікстури/test helpers; не weaken/skip/.only/видаляти тести; без тавтологій (не асертити значення, які сам замокав; не implementation details; без великих снапшотів); без реальної мережі/LLM/часу/random; DB → `*.it.test.ts`; без нових залежностей; прод-баг → секція «Suspected production bugs».
5. Guard-скрипт: дозволяє `**/*.test.ts(x)`, `**/*.it.test.ts`, `server/test/**`, `reviewer-core/test/**`, `client/src/**/__fixtures__/**`, `e2e/specs/**`; інакше `exit 2`.
6. Звіт: Status · Lane · Skills loaded · Tests added · Verify (команда → pass/fail) · Red-evidence (як доведено, що тест ловить регресію) · Skipped on purpose · Suspected production bugs · Insight candidates.
Acceptance: R1, R2, R8.
Sources (для README): Claude Code sub-agents docs; Claude Code best-practices («show evidence»); obra/superpowers test-driven-development («test passes immediately proves nothing»); Kent C. Dodds «Testing Implementation Details».
Verify: `bash -n .claude/hooks/test-writer-guard.sh` · `echo '{"tool_input":{"file_path":"server/src/x.ts"}}' | .claude/hooks/test-writer-guard.sh; echo $?` → 2, для `server/test/x.test.ts` → 0.

### T2 [P] [TOOLING] architecture-reviewer
Owns: `.claude/agents/architecture-reviewer.md`
Depends on: —
Skills: preload `onion-architecture`, `typescript-expert`; lazy за шляхами змін — `server/src/modules/*/routes.ts`: `fastify-best-practices`; `repository.ts`/UoW: `drizzle-orm-patterns`; `src/db/schema/**`: `postgresql-table-design`; `vendor/shared/**` і zod на межах шарів: `zod`; `client/**`: `next-best-practices`, `react-best-practices`. Кожен скіл використовується лише в архітектурному розрізі (шари, напрям залежностей, межі модулів), не для стилю.
Frontmatter: `tools: Read, Grep, Glob, Bash, Skill` · `disallowedTools: Write, Edit, NotebookEdit, Agent, WebSearch, WebFetch` · `skills: [onion-architecture, typescript-expert]` · `model: opus` · `maxTurns: 40`.
Steps:
1. Input: `scope: diff <base>..HEAD` | `scope: paths <list>` | `module: <name>`; опц. `plan`+`task` для контексту.
2. Workflow: CLAUDE.md/INSIGHTS модулів → `git diff` → `cd server && pnpm arch:check` (fail = автоматичний critical) → пройти 12 правил + review checklist `onion-architecture` по змінених файлах (саме ті правила, які depcruise не ловить: 3,7,8,9,12) → для `client/` lazy-load `next-best-practices`, `react-best-practices` + правила `client/CLAUDE.md` (fetch лише в `api.ts`, hooks у `lib/hooks`, рядки в `messages/`) → cross-package: дві копії `vendor/shared`, `SecretsProvider`, migrations → self-refutation кожного critical/major (перечитати цитату, простежити імпорт) → legacy з `.dependency-cruiser-known-violations.json` = `info`.
3. Out of scope: стиль, перформанс, security (інші скіли/агенти).
4. Звіт: Verdict · arch:check (команда, exit code) · Findings (id, severity, rule id, `file:line`, verbatim quote, чому, напрям фіксу) · Checklist pass/fail · Not verified. Нуль findings — валідно.
Acceptance: R3, R8.
Sources: Claude Code sub-agents docs (read-only tools); Anthropic «Building effective agents» (evaluator-optimizer); obra/superpowers requesting-code-review (file:line, Critical/Important/Minor, вердикт); власний `pr-self-review` (severity, verbatim quote, verifier).
Verify: frontmatter парситься (див. T6).

### T3 [P] [TOOLING] plan-verifier
Owns: `.claude/agents/plan-verifier.md`
Depends on: —
Skills: preload `onion-architecture` (щоб знати, де в server шукати реалізацію пункту: route → service → ports → repository); lazy за тегом задачі як у implementer — [BE]: `fastify-best-practices`, `drizzle-orm-patterns`, `zod`; [FE]: `next-best-practices`, `react-best-practices`, `react-testing-library`; [SHARED]: `zod`, `postgresql-table-design`. Скіли — це карта «де і як має бути реалізовано», а не чекліст практик: порушення практик не репортяться, якщо пункт вимог виконано (це зона architecture-reviewer).
Frontmatter: `tools: Read, Grep, Glob, Bash, Skill` · `disallowedTools: Write, Edit, NotebookEdit, Agent, WebSearch, WebFetch` · `skills: [onion-architecture]` · `model: sonnet` · `maxTurns: 50`.
Steps:
1. Input: `plan: specs/plans/<f>.md`, опц. `tasks: T1,T2`, `base: <ref>`. Читає спеку з шапки плану (з диска — план може бути не закомічений).
2. Workflow: витягнути всі AC#/Constraints/числові ліміти зі спеки + Steps/Acceptance/Interfaces/Cross-task decisions з плану → traceability-матриця Req → task → `file:line` → тест → команда; forward (кожна вимога має код) і backward (кожен змінений файл належить чиємусь `Owns`, інакше «Unplanned changes») → читати реальний код, звіряти точні сигнатури/поля/значення (обидві копії `vendor/shared`) → запустити `Verify` кожної задачі, записати exit code і лічильники; «тести пройшли» ≠ вимога виконана — тест має покривати AC (назва тесту) → `## Progress` і звіти implementer — лише claims.
3. Статуси пунктів і вердикт — з Cross-task decisions; MISSING на AC = блокер; UNVERIFIABLE (Docker/e2e недоступні) ніколи не стає DONE.
4. Hard rules: Bash лише read-only + команди Verify/тестів; нічого не виправляє; не оцінює стиль/архітектуру (це architecture-reviewer).
5. Звіт: Verdict + лічильники · таблиця `Req | Source | Status | Evidence | Test/command` · Commands run · Gaps (очікувано / знайдено / task id для reopen) · Unplanned changes · Not verified.
Acceptance: R4, R5, R8.
Sources: obra/superpowers verification-before-completion («no completion claims without fresh verification evidence», line-by-line checklist); GitHub spec-kit `/analyze` (coverage table, zero-coverage = найвища severity); requirements traceability matrix (forward/backward); Anthropic evaluator-optimizer.
Verify: див. T6.

### T4 [P] [TOOLING] doc-writer
Owns: `.claude/agents/doc-writer.md`, `.claude/hooks/doc-writer-guard.sh`
Depends on: —
Skills: preload `mermaid-diagram`; lazy за темою — server-флоу/шари: `onion-architecture`; ER-діаграми/схема: `postgresql-table-design`, `drizzle-orm-patterns`; API/контракти: `zod`, `fastify-best-practices`; client-флоу: `next-best-practices`, `react-best-practices`. Скіли потрібні, щоб правильно назвати шари й потоки на діаграмах, а не для оцінки коду.
Frontmatter: `tools: Read, Grep, Glob, Bash, Write, Edit, Skill` · `disallowedTools: Agent, NotebookEdit, WebSearch, WebFetch` · `skills: [mermaid-diagram]` · `model: sonnet` · `maxTurns: 40` · hook → guard.
Steps:
1. Режими: (a) `feature`/`paths` — документувати існуючий код; (b) `plan: specs/plans/<f>.md` — план = намір, документується лише те, що є в коді, решта «Planned»; (c) довільний вхід — витягнути твердження, перевірити ті, що стосуються коду, неперевірене → «Open questions». Неясні режим/аудиторія/ціль → `NEEDS_CONTEXT`.
2. Маршрутизація (Diátaxis-тип → шлях):
   | Тип | Куди |
   |---|---|
   | Огляд модуля, setup, API (reference) | `<module>/README.md` — оновлювати секцію на місці (source of truth) |
   | Deep dive / explanation модуля | `<module>/docs/<topic>.md` (kebab-case) + лінк з README |
   | How-to модуля | `<module>/docs/how-to-<task>.md` |
   | Крос-пакетна архітектура/флоу | root `README.md` §Architecture або `docs/<topic>.md` |
   | Спека для вже реалізованого | `specs/<f>.md` або `<module>/specs/<f>.md` (шапка `Статус: … · дата · пакети`, «1. Context»), крім `e2e/specs/` (там лише flow JSON) |
   | ADR (лише з підтвердженням) | `docs/adr/NNNN-title.md` / `<module>/docs/adr/` (Nygard: Status, Context, Decision, Consequences) |
   | Сабагенти | `.claude/agents/README.md` |
   Ніколи: `docs/features/` (sdd), `INSIGHTS.md`, будь-який `CLAUDE.md`, `specs/plans/*`, `docs/agent-prompts/*` — лише пропозиції у звіті.
3. Workflow: CLAUDE.md/INSIGHTS/README модуля + існуючі docs (оновлювати > створювати) → один Diátaxis-тип на файл → кожне твердження звірити з кодом (`path:line`) → діаграми лише де допомагають → self-check (лінки, команди = root CLAUDE.md, Mermaid валідний) → звіт.
4. Mermaid-правила: одна діаграма = одне питання; тип за скілом (flowchart/sequenceDiagram/erDiagram зі схеми Drizzle/stateDiagram-v2); кожен вузол = реальний модуль/роут/таблиця, джерело підписане під діаграмою; ≤~20 вузлів; не змішувати рівні C4; текстовий опис поруч.
5. Hard rules: лише `.md`; не описувати future-lesson/agent-runner як робочі; контракти — обидві копії; без секретів; мова — як у цільовому файлі.
6. Guard-скрипт: дозволяє лише `*.md` поза `**/INSIGHTS.md`, `**/CLAUDE.md`, `specs/plans/**`, `docs/agent-prompts/**`, `docs/features/**`.
7. Звіт: Files (шлях, Diátaxis-тип, created/updated) · Claims verified (`path:line`) · Left out (unverified/planned) · Suggestions (INSIGHTS candidates, «read when» для CLAUDE.md, застарілі docs).
Acceptance: R6, R7, R8.
Sources: Diátaxis; C4 model; arc42; adr.github.io (Nygard ADR); Google developer documentation style guide; wshobson/agents docs-architect («explain the why», приклади з реального коду); власний скіл `mermaid-diagram`.
Verify: `bash -n .claude/hooks/doc-writer-guard.sh` + тести шляхів (`server/docs/x.md` → 0, `server/CLAUDE.md` → 2, `server/src/x.ts` → 2).

## Wave 2 — integration

### T5 [TOOLING] README агентів
Owns: `.claude/agents/README.md`
Depends on: T1–T4
Steps: додати 4 рядки в таблицю (модель, доступ, призначення), 4 розділи «Що робить / На чому базується / Джерела» з URL зі звітів researcher-ів, оновити «Типовий конвеєр».
Acceptance: R9.

### T6 [TOOLING] Smoke-прогони (оркестратор, без нових файлів)
Depends on: T5
Steps (кожен агент на реальному малому таргеті, оцінка звіту руками):
1. `plan-verifier` на `specs/plans/claude-subagents-v2.md` (сам цей план) → очікуємо COMPLETE.
2. `architecture-reviewer` з `module: server/src/modules/skills` → звіт з arch:check і без вигаданих цитат.
3. `test-writer` на одну невкриту чисту функцію в `server/src/modules/*/helpers.ts` → новий тест у `server/test/`, лейн проходить; спроба редагувати прод-файл блокується хуком.
4. `doc-writer` режим (a) для `server/src/modules/skills` → `server/docs/skills-module.md` з Mermaid; спроба писати `server/CLAUDE.md` блокується.
Acceptance: усі R; знахідки → Insight candidates.

---

## Execution
1. Користувач ставить `Status: Approved` у цьому файлі.
2. W1: 4 `implementer` паралельно (`isolation: "worktree"`, спершу закомітити план). Delegation: `plan: specs/plans/claude-subagents-v2.md · task: T<n> · tag [TOOLING]: skip skill loading, Verify = команди задачі`. (Альтернатива при меншій кількості кроків — оркестратор пише 4 файли сам; Owns однаково не перетинаються.)
3. W2: T5 (implementer), потім T6 smoke у головному checkout.
4. Оновити `## Progress`, записати insight candidates через `engineering-insights`.

## Progress
| Task | Status | Notes |
|------|--------|-------|
| T1 | done_with_concerns | test-writer; matcher Write/Edit/MultiEdit, client/src/test/setup.ts not allowlisted |
| T2 | done | architecture-reviewer; default base main, diff incl. uncommitted |
| T3 | done_with_concerns | plan-verifier; added NEEDS_CONTEXT verdict (R8) — mention in README |
| T4 | done_with_concerns | doc-writer; guard stricter (.claude/**, e2e/specs, outside repo), jq absent → sed fallback |
| T5 | done | README; fixed doc-writer language rule (agents README is Ukrainian) |
| T6 | todo | smoke |
