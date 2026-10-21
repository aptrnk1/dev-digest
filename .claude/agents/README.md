# Агенти проєкту DevDigest

У проєкті є два різні види агентів:

1. **Сабагенти Claude Code** (`.claude/agents/*.md`). Це помічники для
   розробки самого репозиторію: дослідження, планування, імплементація,
   тести, архітектурне ревю, перевірка виконання плану, документація.
2. **Рев'ю-агенти продукту** (`docs/agent-prompts/*.md`). Це агенти, які
   DevDigest запускає під час рев'ю PR. Вони живуть у БД (`agents.system_prompt`),
   а файли в `docs/agent-prompts/` є їхніми оригіналами для читання.

> Позначка «Джерела» означає, що агент явно спирається на зовнішній стандарт
> або публікацію, або повторює відомий патерн. Самі файли агентів посилань не
> містять. Там, де агент збудований лише на внутрішніх документах репо, так і
> написано.

---

## 1. Сабагенти Claude Code

Формат файлів (frontmatter `name`, `description`, `tools`, `disallowedTools`,
`skills`, `model`, `maxTurns`, `color`, `hooks`) відповідає документації Claude Code:
[Create custom subagents](https://code.claude.com/docs/en/sub-agents).

Типовий конвеєр: `researcher` (за потреби) → `planner` пише план →
людина ставить `Status: Approved` → оркестратор запускає по одному
`implementer` на задачу, хвиля за хвилею (за потреби паралельно з ним
`test-writer` дописує тести) → `plan-verifier` перевіряє, що кожен пункт
плану реально є в коді → `architecture-reviewer` перевіряє структуру змін →
`doc-writer` оновлює документацію → `/pr-self-review` перед PR.

| Агент | Модель | Доступ | Призначення |
|---|---|---|---|
| [`researcher`](./researcher.md) | sonnet | тільки читання + веб | відповідає на конкретне питання з доказами |
| [`planner`](./planner.md) | opus | пише лише `specs/plans/<feature>.md` | перетворює спеку на план із хвилями |
| [`implementer`](./implementer.md) | sonnet, ≤60 ходів | редагує лише файли зі свого `Owns` | виконує одну задачу `T<n>` з плану |
| [`test-writer`](./test-writer.md) | sonnet, ≤50 ходів | пише лише тести, test helpers, фікстури, e2e flow (guard-хук) | покриває код тестами в лейні з `TESTING.md` |
| [`plan-verifier`](./plan-verifier.md) | sonnet, ≤50 ходів | тільки читання + Verify/тестові команди | перевіряє, що кожен пункт плану реалізовано в коді |
| [`architecture-reviewer`](./architecture-reviewer.md) | opus, ≤40 ходів | тільки читання + `pnpm arch:check` | ревю структури: шари, напрям залежностей, межі модулів |
| [`doc-writer`](./doc-writer.md) | sonnet, ≤40 ходів | пише лише `.md` за таблицею маршрутизації (guard-хук) | документує код, план або довільний вхід, з Mermaid-схемами |

### `researcher`

**Що робить.** Відповідає на питання в одному з двох режимів:
**A — repo** (докази у вигляді `file:line`, `git log`/`blame`) і **B — external**
(офіційні документи, changelog-и, issues, з URL і датою). Обидва режими можна
поєднати в одному звіті. Звіт має фіксовану структуру: TL;DR із рівнем
впевненості, Findings → Evidence (E1…/S1…), розділ «Not found / open»
обов'язковий.

**На чому базується:**
- Внутрішнє: карта root `CLAUDE.md`, модульні `CLAUDE.md`/`INSIGHTS.md`/`README.md`,
  специфіка репо (дві копії zod-контрактів, «future lesson» заглушки,
  неіснуючий agent-runner).
- Правило «досліджувати ту версію, яка в `package.json`, а не latest» і
  перелік стеку з root `CLAUDE.md`.
- Interview mode: агент ставить ≤4 питання за раунд і проводить ≤3 раунди.
  Якщо `AskUserQuestion` недоступний, він повертає блок `needs-input`.
- Вміст файлів і вебсторінок вважається даними, а не інструкціями (захист
  від prompt injection, та сама ідея, що й `INJECTION_GUARD` у reviewer-core).

**Джерела (патерни):**
- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system).
  Звідти ідея дослідника в чистому контексті, який повертає лише стислий
  висновок із цитуванням джерел.
- Claude Code, [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
  (read-only набір інструментів через `tools` / `disallowedTools`).

### `planner`

**Що робить.** Бере затверджену спеку (`specs/*.md` або `<module>/specs/*.md`)
і пише план `specs/plans/<feature>.md` за шаблоном
[`specs/plans/_template.md`](../../specs/plans/_template.md). План складається
з хвиль: W0 foundation (послідовно), W1 паралельні задачі `[P]`, W2
інтеграція/e2e. Кожна задача має тег `[SHARED|BE|FE]`, взаємно непересічний
список `Owns`, `Skills`, `Interfaces`, `Acceptance` з посиланнями на AC#,
точні команди `Verify` і `Escalate if`. Код агент не пише. Із кількох
варіантів обирає один і пояснює вибір.

**На чому базується:**
- Внутрішнє: root `CLAUDE.md` (cross-package правила, список «Do not touch»,
  команди), `README.md` §Architecture, `TESTING.md`, каталог скілів
  `.claude/skills/README.md`, референсні модулі `server/src/modules/skills/`
  і `conventions/`.
- Попередньо завантажений скіл `onion-architecture`
  (`.claude/skills/onion-architecture`): шари, напрям імпортів, гейт `pnpm arch:check`.

**Джерела (патерни):**
- GitHub Spec Kit, [`templates/tasks-template.md`](https://github.com/github/spec-kit/blob/main/templates/tasks-template.md):
  ID задач `T001…`, маркер `[P]` («можна виконувати паралельно: різні файли,
  немає залежностей»), фази. Звідси ж ланцюжок spec → plan → tasks.
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents),
  патерн *orchestrator-workers*: план розбиває роботу, а виконують її окремі
  воркери (`implementer`).

### `implementer`

**Що робить.** Виконує рівно одну задачу `T<n>` з плану. Спершу за тегом
задачі завантажує відповідний набір скілів (BE: `onion-architecture`,
`fastify-best-practices`, `drizzle-orm-patterns`, `zod`; FE: `next-best-practices`,
`react-best-practices`, `react-testing-library`, `zod`; SHARED: `zod` + схемні
скіли). Далі працює test-first (red → green → refactor), запускає `Verify`
і гейт пакета. Повертає статус `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`.
Редагує тільки файли зі свого `Owns`. Git не чіпає. В `INSIGHTS.md` не пише,
а лише пропонує кандидатів, які оркестратор записує через `engineering-insights`.
Тому кілька екземплярів можуть працювати паралельно.

**На чому базується:**
- Внутрішнє: план від `planner`, `TESTING.md` (тестові «лейни»:
  `src/adapters/mocks.ts`, `*.it.test.ts`, vitest + jsdom, e2e flow JSON),
  модульні `CLAUDE.md`/`INSIGHTS.md`, правила root `CLAUDE.md` (pnpm чи npm,
  `SecretsProvider`, заборона руками редагувати міграції та послаблювати
  `INJECTION_GUARD`).
- Попередньо завантажений скіл `typescript-expert`.

**Джерела (патерни):**
- obra/superpowers, [`subagent-driven-development/implementer-prompt.md`](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/implementer-prompt.md):
  той самий набір статусів звіту `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`
  і підхід «один свіжий сабагент на одну задачу».
- Kent Beck, *Test-Driven Development: By Example* (Addison-Wesley, 2002), цикл
  red → green → refactor.
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents),
  роль *worker* у патерні orchestrator-workers.

### `test-writer`

**Що робить.** Пише тести, і тільки тести, для FE (`client/`, `e2e/`) і BE
(`server/`, `reviewer-core/`). Ціль задається одним із трьох способів:
`target:` (файли, модуль, фіча), `target: AC#…` зі спеки або `plan` + `task`.
Без цілі агент повертає `NEEDS_CONTEXT`. Лейн обирає за
[`TESTING.md`](../../TESTING.md): client (vitest + jsdom), server-unit
(`src/adapters/mocks.ts`, `app.inject`), server-integration (`*.it.test.ts`,
Postgres через testcontainers), reviewer-core, e2e (`e2e/specs/*.flow.json`).
Спершу складає список поведінок (happy path + edge, який реально важить,
«типологічно, а не вичерпно»), потім пише тести і запускає лейн із typecheck
**двічі**, щоб виловити flaky. Заборонено: тавтології (асерт значення, яке сам
замокав), implementation details, великі снапшоти, реальна мережа/LLM/час,
нові залежності, послаблення чи `.skip`/`.only` існуючих тестів. Підозрілий
баг у прод-коді не виправляє, а лишає тест, що його показує, і описує баг у
звіті. Звіт: `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`, лейн,
Tests added, Verify (run 1 / run 2), обов'язковий **Red-evidence** (тест падав
до реалізації або яку конкретну регресію він ловить і як це показано),
Skipped on purpose, Suspected production bugs, Insight candidates.

**На чому базується:**
- Внутрішнє: [`TESTING.md`](../../TESTING.md) (лейни і хелпери), модульні
  `CLAUDE.md`/`INSIGHTS.md` (repo-специфіка: лише `import type` з shared,
  `aria-pressed` замість стилів, у jsdom `File` без `arrayBuffer`, без MSW і
  `user-event`), `e2e/README.md` для flow JSON.
- Попередньо завантажений скіл `typescript-expert`. Решту скілів вантажить
  ліниво за лейном: client — `react-testing-library`, `react-best-practices`,
  `next-best-practices`, `zod`; server-unit — `fastify-best-practices`,
  `onion-architecture`, `zod`; server-integration — те саме + `drizzle-orm-patterns`;
  reviewer-core — `zod`; `security`, якщо тестується auth, user input, файли
  чи секрети.
- Guard-хук `PreToolUse` у frontmatter (matcher `Write|Edit|MultiEdit`) →
  [`../hooks/test-writer-guard.sh`](../hooks/test-writer-guard.sh), див.
  «Guard-хуки» нижче.

**Джерела (патерни):**
- Claude Code, [Create custom subagents](https://code.claude.com/docs/en/sub-agents):
  поле `hooks` у frontmatter сабагента і обмеження інструментів.
- Claude Code, [Best practices](https://code.claude.com/docs/en/best-practices):
  ідея «show evidence», тобто агент доводить результат запуском, а не словами.
  Звідси секції Verify і Red-evidence.
- obra/superpowers, [`test-driven-development/SKILL.md`](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md):
  принцип «тест, що одразу проходить, нічого не доводить». Звідси вимога
  Red-evidence.
- Kent C. Dodds, [Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details):
  тестувати поведінку на межі (HTTP-відповідь, текст/роль у DOM, що дійшло до
  порту), а не внутрішній стан.

### `plan-verifier`

**Що робить.** Відповідає на одне питання: чи реально реалізовано кожен пункт
плану `specs/plans/<feature>.md`. Вхід: `plan:` (обов'язково), опційно
`tasks: T1,T2` і `base: <ref>`. Витягує вимоги: AC# зі спеки з шапки плану
(або інлайн-вимоги `R1…` з самого плану), Cross-task decisions, а також Steps,
Acceptance й Interfaces кожної задачі. Будує traceability-матрицю
Req → задача → `file:line` → тест → команда. Перевірка йде в обидва боки:
forward (кожна вимога має код) і backward (кожен змінений файл належить
чиємусь `Owns`, інакше він потрапляє в «Unplanned changes»). Запускає `Verify`
кожної задачі як свіжий доказ. `## Progress` і звіти `implementer` вважає
лише заявами. Статуси пунктів: `DONE | PARTIAL | MISSING | UNVERIFIABLE | DEVIATION`.
Вердикт: `COMPLETE | INCOMPLETE | BLOCKED_UNVERIFIABLE | NEEDS_CONTEXT`
(`NEEDS_CONTEXT`, якщо план не передано, його немає або задачі немає в плані).
`UNVERIFIABLE` (немає Docker, e2e-стеку, ключа) ніколи не стає `DONE`. Стиль і
архітектуру не оцінює, це зона `architecture-reviewer`. Нічого не виправляє.

**На чому базується:**
- Внутрішнє: шаблон плану [`specs/plans/_template.md`](../../specs/plans/_template.md),
  root `CLAUDE.md` (команди гейтів, список «Do not touch»: ручна правка
  міграцій чи послаблений `INJECTION_GUARD` = `DEVIATION`), модульні
  `CLAUDE.md`/`INSIGHTS.md`.
- Попередньо завантажений скіл `onion-architecture`: карта, де в `server/`
  шукати реалізацію пункту (route → compose → service → ports → repository).
  Інші скіли вантажить ліниво за тегом задачі (як у `implementer`), тільки як
  карту «де це має лежати», а не як чекліст практик.

**Джерела (патерни):**
- obra/superpowers, [`verification-before-completion/SKILL.md`](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md):
  жодних заяв про завершення без свіжого доказу (команди, запущені зараз) і
  перевірка вимог рядок за рядком.
- GitHub Spec Kit, [`templates/commands/analyze.md`](https://github.com/github/spec-kit/blob/main/templates/commands/analyze.md):
  таблиця покриття вимог задачами; вимога без жодного покриття має найвищу
  серйозність (у нас `MISSING` на AC/R блокує вердикт).
- Wikipedia, [Traceability matrix](https://en.wikipedia.org/wiki/Traceability_matrix):
  матриця вимога ↔ реалізація ↔ тест із прямим і зворотним трасуванням.
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents),
  патерн *evaluator-optimizer*: окремий оцінювач перевіряє результат воркерів,
  а прогалини повертаються на доопрацювання (`reopen: T<n>`).

### `architecture-reviewer`

**Що робить.** Read-only ревю **лише структури**: розташування коду за
шарами, напрям залежностей, межі модулів, composition/DI, транзакції, мапінг
помилок, крос-пакетні правила. Скоуп: `scope: diff <base>..HEAD` (за
замовчуванням `main` плюс незакомічені зміни), `scope: paths …` або
`module: <path>`; опційно `plan` + `task` для контексту. Ground truth для
напряму імпортів — `cd server && pnpm arch:check` (dependency-cruiser): кожне
нове порушення = `critical`, а baselined legacy з
`.dependency-cruiser-known-violations.json` = `info`. Далі вручну проходить
правила `onion-architecture`, яких depcruise не бачить (Container лише в
`compose.ts`, мапінг на межах, Unit of Work для запису в кілька таблиць, коди
помилок, інваріанти в `domain.ts`). Для `client/` перевіряє правила
`client/CLAUDE.md` (fetch лише в `src/lib/api.ts`, хуки в `src/lib/hooks/`,
рядки в `messages/en/*.json`). Кожен finding має `file:line` і дослівну
цитату, інакше відкидається. Перед звітом агент сам перевіряє кожен
critical/major (self-refutation). Стиль, перформанс і security поза скоупом.
Нуль findings — валідний результат. Вердикт:
`APPROVE | APPROVE_WITH_CONCERNS | REQUEST_CHANGES | NEEDS_CONTEXT`.

**На чому базується:**
- Внутрішнє: шкала severity `critical/major/minor/nit/info` з
  [`pr-self-review/references/severity.md`](../skills/pr-self-review/references/severity.md)
  і правило «verbatim quote + `file:line`» з
  [`reviewer-prompt.md`](../skills/pr-self-review/references/reviewer-prompt.md)
  (посилання, а не копія), `server/.dependency-cruiser.cjs`, правила root
  `CLAUDE.md` (дві копії `vendor/shared`, `SecretsProvider`, міграції,
  `INJECTION_GUARD`).
- Попередньо завантажені скіли `onion-architecture` і `typescript-expert`.
  Ліниво за змінами: `fastify-best-practices` (routes/platform),
  `drizzle-orm-patterns` (repository/UoW), `postgresql-table-design` (schema),
  `zod` (`vendor/shared`), `next-best-practices` + `react-best-practices`
  (`client/`). Усі лише в архітектурному розрізі. Скіла
  `frontend-ui-architecture` у `.claude/skills/` немає, тому FE-ревю
  спирається на ці два скіли і `client/CLAUDE.md`.

**Джерела (патерни):**
- Claude Code, [Create custom subagents](https://code.claude.com/docs/en/sub-agents):
  read-only агент через `disallowedTools: Write, Edit`.
- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents),
  патерн *evaluator-optimizer*: рецензент оцінює результат і повертає
  зауваження, а не виправляє сам.
- obra/superpowers, [`requesting-code-review/code-reviewer.md`](https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/code-reviewer.md):
  findings із `file:line`, градація серйозності і фінальний вердикт.
- Власний скіл `pr-self-review`: шкала severity, дослівна цитата і крок
  верифікатора (у нас це self-refutation).

### `doc-writer`

**Що робить.** Пише й оновлює Markdown-документацію з Mermaid-схемами там, де
схема відповідає на питання швидше за текст. Три режими: **(a) код**
(`feature:` / `paths:`) — документує те, що вже є; **(b) план**
(`plan: specs/plans/<f>.md`) — документує лише реалізоване, решта йде в
розділ «Planned» із номером задачі; **(c) довільний вхід** (нотатки, дизайн,
підсумок чату) — твердження про код перевіряються, неперевірені йдуть в
«Open questions». Спершу обирає Diátaxis-тип (tutorial, how-to, reference,
explanation; один файл = один тип), потім місце за таблицею маршрутизації:
`<module>/README.md`, `<module>/docs/<topic>.md`, root `README.md` або
`docs/<topic>.md`, `specs/…` для вже реалізованого, ADR (формат Nygard)
лише на явний запит, цей README для сабагентів. Оновлення краще за створення
нового файлу. Кожне твердження звіряє з кодом (`path:line`); якщо код і
документ розходяться, перемагає код. Mermaid-правила: одна схема = одне
питання, кожен вузол — реальний модуль/роут/таблиця, підпис `Source:` під
схемою, ≤~20 вузлів, не змішувати рівні C4. Звіт:
`DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`, Files (з
Diátaxis-типом), Claims verified, Left out, Open questions, Suggestions
(кандидати в `INSIGHTS.md`, «read when» для `CLAUDE.md`, застарілі документи).

**На чому базується:**
- Внутрішнє: структура модулів із root `CLAUDE.md` (`README.md` як source of
  truth, `docs/`, `specs/`), конвенції спек [`specs/conventions.md`](../../specs/conventions.md),
  стиль діаграми в root `README.md` §Architecture, команди з root `CLAUDE.md`.
- Попередньо завантажений скіл `mermaid-diagram`. Ліниво за темою:
  `onion-architecture` (серверні потоки), `postgresql-table-design` +
  `drizzle-orm-patterns` (ER-схеми), `zod` + `fastify-best-practices` (API),
  `next-best-practices` + `react-best-practices` (клієнт). Скіли потрібні,
  щоб правильно назвати шари й потоки, а не щоб оцінювати код.
- Guard-хук `PreToolUse` → [`../hooks/doc-writer-guard.sh`](../hooks/doc-writer-guard.sh),
  див. «Guard-хуки» нижче.

**Джерела (патерни):**
- [Diátaxis](https://diataxis.fr/): чотири типи документів і правило «один
  файл = один тип».
- [C4 model](https://c4model.com/): рівні діаграм (context, containers,
  components), які не можна змішувати в одній схемі.
- [arc42](https://arc42.org/overview): розділи архітектурного документа, зокрема
  пояснення «чому» поруч зі структурою.
- [adr.github.io](https://adr.github.io/): формат ADR Майкла Найгарда (Status,
  Context, Decision, Consequences).
- Google, [Developer documentation style guide — highlights](https://developers.google.com/style/highlights):
  друга особа, теперішній час, активний стан, короткі речення, заголовки
  sentence case.
- wshobson/agents, [`docs-architect.md`](https://github.com/wshobson/agents/blob/main/plugins/code-documentation/agents/docs-architect.md):
  «explain the why» і приклади з реального коду замість вигаданих `foo/bar`.
- Власний скіл `mermaid-diagram` (`.claude/skills/mermaid-diagram`): вибір
  типу діаграми і синтаксис.

### Guard-хуки і обмеження

Агенти, які пишуть файли (`test-writer`, `doc-writer`), мають у frontmatter
хук `PreToolUse` з matcher `Write|Edit|MultiEdit`. Скрипт читає з stdin
`tool_input.file_path`, приводить його до шляху відносно репо (з урахуванням
регістру на macOS) і завершується з `exit 0` (дозволено) або `exit 2`
(заблоковано, причина в stderr показується агенту). Шляхи поза проєктом і з
`..` блокуються в обох скриптах.

- [`test-writer-guard.sh`](../hooks/test-writer-guard.sh) дозволяє лише
  `*.test.ts`, `*.test.tsx` (зокрема `*.it.test.ts`), `server/test/**`,
  `reviewer-core/test/**`, `client/src/**/__fixtures__/**` і `e2e/specs/**`.
  Також знімає префікс worktree `.claude/worktrees/<name>/`.
  `client/src/test/setup.ts` не в allowlist.
- [`doc-writer-guard.sh`](../hooks/doc-writer-guard.sh) дозволяє лише `*.md` і
  блокує `**/CLAUDE.md`, `**/INSIGHTS.md`, `specs/plans/**`,
  `docs/agent-prompts/**`, `docs/features/**`, `e2e/specs/**` і `.claude/**`
  (крім `.claude/agents/README.md`).
- JSON парситься через `jq`. На машині без `jq` `test-writer-guard.sh`
  переходить на `python3`, а потім на `sed`; `doc-writer-guard.sh` одразу на
  `sed`.

Застереження:
- Хуки у frontmatter сабагента ще не підтверджені живим прогоном (задача T6
  плану [`claude-subagents-v2`](../../specs/plans/claude-subagents-v2.md)).
  Якщо вони не спрацюють, обмеження лишається тільки правилом у промпті.
- Хук не бачить запис через Bash (`sed -i`, `cat >`, `tee`). Від цього
  захищає лише заборона в промпті.
- «Bash лише read-only» у `plan-verifier` і `architecture-reviewer` теж
  тримається тільки на промпті: поле `tools` не вміє обмежувати окремі
  команди Bash (як і в `researcher`).

---

## 2. Рев'ю-агенти продукту (`docs/agent-prompts/`)

Їх запускає reviewer-core: `assemblePrompt` у `reviewer-core/src/prompt.ts`
дописує до кожного промпта `INJECTION_GUARD`, а відповідь проходить строгу
JSON-схему `Review` і grounding-гейт. Правила написання промптів (рубрика
severity, семантика verdict, дисципліна findings) описані в
[`docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md). Там же
пояснено, що джерелом істини під час виконання є БД.

| Агент | Фокус | Джерела |
|---|---|---|
| [`general-reviewer`](../../docs/agent-prompts/general-reviewer.md) | коректність, edge cases, контракти, підтримуваність для стеку Fastify/Drizzle/zod | внутрішнє: стек репо; зовнішніх джерел немає |
| [`security-reviewer`](../../docs/agent-prompts/security-reviewer.md) | вразливості, які реально можна експлуатувати, трасування source → sink | [OWASP Top 10:2021](https://owasp.org/Top10/2021/) (категорії A01–A10 перелічено дослівно) · Simon Willison, [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) (розділ «Lethal trifecta» і `kind: "lethal_trifecta"`) |
| [`performance-reviewer`](../../docs/agent-prompts/performance-reviewer.md) | N+1, індекси, пул з'єднань (~10), pgvector, p-queue, зовнішні API, event loop | внутрішнє: стек репо; зовнішніх джерел немає |
| [`test-quality-reviewer`](../../docs/agent-prompts/test-quality-reviewer.md) | чи впадуть тести, якщо код зламати | навмисно мінімальний: чеклісти приходять як підключені скіли з `docs/skills/` |
| [`api-contract-reviewer`](../../docs/agent-prompts/api-contract-reviewer.md) | breaking зміни запитів і відповідей, порушення схеми, дрейф контрактів | внутрішнє: дві копії zod-контрактів; правила репо приходять як скіли (наприклад, `api-contract-breaking-change`) |

Гайд про вибір моделі для агентів:
[`docs/agent-prompts/choosing-a-model.md`](../../docs/agent-prompts/choosing-a-model.md).

---

## Додавання нового агента

- Сабагент Claude Code: створіть `.claude/agents/<name>.md` із frontmatter за
  [документацією](https://code.claude.com/docs/en/sub-agents) і додайте рядок
  у таблицю розділу 1. Якщо агент пише файли, а дозволені шляхи треба
  жорстко обмежити, додайте guard-скрипт у `.claude/hooks/` за зразком
  існуючих.
- Рев'ю-агент: прочитайте `docs/agent-prompts/README.md` (чекліст «before
  shipping a prompt»), додайте файл у `docs/agent-prompts/`, запушіть його в
  агента через `PUT /agents/:id` і додайте рядок у таблицю розділу 2.
