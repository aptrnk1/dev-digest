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

Типовий конвеєр: `spec-creator` аналізує запит і дизайни (за потреби
запускає кількох `researcher` паралельно), питає й пише draft-спеку →
`spec-reviewer` перевіряє її → людина ставить спеці `Status: approved` →
`researcher` (за потреби) → `implementation-planner`
перевіряє вимоги, питає про незрозуміле й про режим виконання та пише план →
людина ставить `Status: Approved` → оркестратор запускає по одному
`implementer` на задачу, хвиля за хвилею (у режимі single-agent усі задачі
виконує один агент послідовно) → фінальне коло паралельно: `plan-verifier`
перевіряє, що кожен пункт плану реально є в коді (і тест AC лежить у лейні
з його мітки), `architecture-reviewer` перевіряє структуру змін,
`/code-review high` шукає баги в логіці → правки → delta-коло →
`doc-writer` оновлює документацію → `/pr-self-review` перед PR.

**Виконання плану однією командою.** Спеку й план запускають вручну
(`spec-creator`, `spec-reviewer`, `implementation-planner`). `/run-plan plan: <path>`
(скіл `.claude/skills/run-plan/`) бере готовий план: передає питання
агентів користувачу (AskUserQuestion) і продовжує того самого агента через
`SendMessage`, зупиняється лише на gate затвердження плану, виконує хвилі на
гілці `feature/<slug>` з комітом на хвилю, а після фінального рев'ю веде
реєстр знахідок `reports/<feature>/review-<n>.md` і цикл виправлень (≤3 кола:
critical/major — обов'язково, minor — попутно, nit — ні; implementer у режимі
`fixes:` може відповісти `DISPUTED` з доказами; ескалація, якщо знахідка не
закривається). Перед gate план перевіряє `scripts/plan-lint.mjs`.
`test-writer` у `/run-plan` не використовується (економія токенів): відсутні
тести дописує `implementer` задачі; агент лишається для ручного запуску.

**Економія токенів без втрати перевірок.** Правила для оркестратора
зібрані в `.claude/skills/run-plan/references/execute.md`:
- `implementer` пише повний звіт у файл `specs/plans/reports/<feature>/T<n>.md`,
  а оркестратору повертає короткий, до 15 рядків;
- з плану і spec implementer читає тільки свою задачу та AC, на які вона
  посилається;
- задача з полем `Route: inline | agent:haiku | agent` виконується найдешевшим
  способом: дрібну правку оркестратор робить сам, механічну задачу виконує
  `haiku`;
- worktree готує `scripts/worktree-bootstrap.sh`;
- виправлення після рев'ю повертаються через `SendMessage` до того самого
  implementer;
- друге коло `architecture-reviewer` і `plan-verifier` працює в delta-режимі
  (`previous` + `since`), а verifier повторно використовує
  `verify-<sha>.md`, якщо пакет відтоді не змінювався;
- усі перевірки йдуть через `scripts/check.sh`: рядок на успішний крок,
  лише уривок помилок, успіхи кешуються за хешем дерева (спільно для
  worktree), тож повторний прогін на тому самому коді нічого не коштує;
- implementer ганяє лише Verify своєї задачі (у циклі red/green — один
  тестовий файл); повний gate пакета запускає оркестратор раз після merge;
- implementer вантажить лише скіли з поля `Skills:` задачі (planner обирає
  1–3), без preload `typescript-expert`.

| Агент | Модель | Доступ | Призначення |
|---|---|---|---|
| [`researcher`](./researcher.md) | sonnet | тільки читання + веб | відповідає на конкретне питання з доказами |
| [`spec-creator`](./spec-creator.md) | opus, ≤40 ходів | пише лише спеки `specs/` і `<module>/specs/`, редагує лише draft (guard-хук); без Bash | аналізує запит, дизайни й код, питає, пише draft-спеку з EARS-критеріями |
| [`spec-reviewer`](./spec-reviewer.md) | opus, ≤30 ходів | тільки читання | рев'ю draft-спеки: неоднозначність, покриття, довіра, traceability |
| [`implementation-planner`](./implementation-planner.md) | opus | пише лише `specs/plans/<feature>.md` (guard-хук) | перевіряє вимоги й перетворює їх на implementation-план із хвилями; спеки не пише |
| [`implementer`](./implementer.md) | sonnet, ≤60 ходів | редагує лише файли зі свого `Owns` | виконує одну задачу `T<n>` з плану |
| [`test-writer`](./test-writer.md) | sonnet, ≤50 ходів | пише лише тести, test helpers, фікстури, e2e flow (guard-хук) | покриває код тестами в лейні з `TESTING.md` |
| [`plan-verifier`](./plan-verifier.md) | sonnet, ≤50 ходів | тільки читання + Verify/тестові команди | перевіряє, що кожен пункт плану реалізовано в коді |
| [`architecture-reviewer`](./architecture-reviewer.md) | sonnet, ≤40 ходів | тільки читання + `pnpm arch:check` | ревю структури: шари, напрям залежностей, межі модулів |
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

### `spec-creator`

**Що робить.** Перетворює запит на фічу (і, якщо є, дизайни — скриншоти, які
юзер скидає в чат; оркестратор зберігає їх у `specs/designs/<date>-<slug>/D<n>.png`
через `scripts/save-designs.mjs`, і агент читає файли) на draft-спеку за шаблоном
[`specs/_template.md`](../../specs/_template.md). Це крок перед
`implementation-planner`. Порядок роботи:

1. Читає контекст лише модулів, яких стосується фіча: їхні `CLAUDE.md` і
   `INSIGHTS.md`; root `INSIGHTS.md` — лише коли модулів ≥2;
   `e2e/INSIGHTS.md` — лише коли є критерії з міткою `[e2e]`.
2. Якщо бракує фактів, ставить дослідницькі питання `R1 [repo|external] …`.
   У головній сесії (`claude --agent spec-creator`) сам запускає до 4
   `researcher` паралельно (`Agent(researcher)` у `tools`); як сабагент
   повертає блок `needs-research`, а оркестратор запускає дослідників і
   повертає звіти в полі `research:`.
3. Аналізує: матриця «екран × стан», дії, яких немає на макеті, взаємодія
   модулів (client → API → сервіс → БД / LLM / GitHub, обидві копії
   `vendor/shared`, MCP, seed, e2e), довіра до входів, edge cases, NFR,
   UX-покращення, конфлікти з `INSIGHTS.md`.
4. Інтерв'ю до запису файлу: питання й пропозиції (REC1…) з варіантом
   «Recommended»; `AskUserQuestion` або блок `needs-input`, продовження —
   через `answers:`. До 3 раундів (`depth: quick` — 1).
5. Пише спеку українською: `US1…`, EARS-критерії
   `**AC<n>** (<тип>, US<n>) … [unit|it|e2e|manual]`, `EC1…`, `NFR1…` з
   числом і перевіркою, Assumptions, Open questions (blocking /
   non-blocking), traceability-матриця. Потім фінальний self-check.

Місце й ім'я: ≥2 модулі → root `specs/`, один → `<module>/specs/`; файл
`YYYY-MM-DD-<slug>.md`, `Spec ID: SPEC-YYYY-MM-DD-<slug>`. Ставить лише
`Status: draft`; `approved`/`implemented` ставить людина.

**На чому базується:**
- Внутрішнє: root `CLAUDE.md`, `README.md` §Architecture, `TESTING.md`
  (лейни для міток верифікації), [`specs/README.md`](../../specs/README.md),
  модульні `CLAUDE.md`/`INSIGHTS.md`.
- Попередньо завантажений скіл `ears-requirements`; ліниво —
  `ux-states-review`, `llm-trust-boundaries`, `onion-architecture`, `zod`,
  `mermaid-diagram`, `security`.
- Guard-хук `PreToolUse` → [`../hooks/spec-creator-guard.sh`](../hooks/spec-creator-guard.sh),
  див. «Guard-хуки» нижче. Bash вимкнено повністю, щоб обмеження запису не
  можна було обійти.

**Джерела (патерни):**
- Alistair Mavin, [EARS — Easy Approach to Requirements Syntax](https://alistairmavin.com/ears/):
  п'ять шаблонів вимог і їх комбінації.
- ISO/IEC/IEEE 29148: атрибути якості вимоги (однозначна, перевірювана,
  одна поведінка, здійсненна).
- GitHub Spec Kit, [`templates/spec-template.md`](https://github.com/github/spec-kit/blob/main/templates/spec-template.md):
  user stories з acceptance-сценаріями, позначки неясностей замість здогадок.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/):
  розділи «Inputs and provenance» / «Untrusted inputs».
- Nielsen Norman Group, [10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
  і [WCAG 2.2](https://www.w3.org/TR/WCAG22/): аналіз дизайнів.
- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):
  паралельні дослідники в чистому контексті.

### `spec-reviewer`

**Що робить.** Read-only рев'ю draft-спеки від `spec-creator` до того, як
людина поставить `approved`. Головне питання до кожного AC/EC/NFR: «чи могли
б два інженери побудувати за цим різне?». Перевіряє: структуру й заголовок,
відповідність спеки макетам із `specs/designs/…` (кожен намальований
елемент і стан покритий AC або non-goal),
форму й якість EARS, покриття станів UI, взаємодію модулів (твердження про
код звіряє з `file:line`, через Grep шукає інших споживачів ендпоінта /
таблиці / контракту), довіру до входів, мітки верифікації проти лейнів
`TESTING.md`, повноту traceability, конфлікти з `CLAUDE.md` і `INSIGHTS.md`
модулів зі `Modules:`. Кожна знахідка має цитату зі спеки й severity
`critical/major/minor/nit`. Вердикт: `APPROVE | APPROVE_WITH_CONCERNS |
REQUEST_CHANGES | NEEDS_CONTEXT`. Правки вносить `spec-creator` (повторний
запуск з `draft:`) або людина.

**На чому базується:**
- Внутрішнє: ті самі джерела, що й `spec-creator`; шкала severity і
  вердикти — як у `architecture-reviewer`.
- Попередньо завантажений скіл `ears-requirements` (§8 — чекліст рев'ю);
  ліниво — `ux-states-review`, `llm-trust-boundaries`.

**Джерела (патерни):**
- ISO/IEC/IEEE 29148 (атрибути якості вимог) і EARS (див. `spec-creator`).
- Ідея рев'юера в чистому контексті, який не писав артефакт, — та сама, що в
  `plan-verifier` і `architecture-reviewer`.

### `implementation-planner`

**Що робить.** Бере вже наявні вимоги: затверджену спеку (`specs/*.md` або
`<module>/specs/*.md`) чи вимоги з делегування (тоді копіює їх у план дослівно
як R1…Rn). Спеки агент не пише, не редагує й не доповнює; guard-хук
`.claude/hooks/implementation-planner-guard.sh` дозволяє запис лише в
`specs/plans/<feature>.md`. Якщо вимог немає, агент зупиняється.

Перед плануванням агент перевіряє вимоги: прогалини, конфлікти, AC, які не
можна перевірити, архітектурні розвилки, суперечності з кодом і правилами
`CLAUDE.md`/`INSIGHTS.md`. Незрозуміле уточнює в користувача, а покращення
пропонує як рекомендації (REC1…), які користувач приймає або відхиляє. У план
потрапляють лише прийняті. Якщо прийнята зміна суперечить тексту спеки,
агент записує «spec update needed» для власника спеки. Усе це фіксується в
розділі `## Requirements review` плану.

Агент завжди питає режим виконання (якщо його не передано як `mode:`):
**multi-agent** (один `implementer` на задачу, хвилі, `[P]` у worktree) або
**single-agent** (один агент виконує всі задачі послідовно в основному
checkout, усі задачі мають `Route: inline`). Режим записується в заголовок
плану як `Execution mode:`.

Сам план за шаблоном [`specs/plans/_template.md`](../../specs/plans/_template.md)
складається з хвиль: W0 foundation (послідовно), W1 паралельні задачі `[P]`, W2
інтеграція/e2e. Кожна задача має тег `[SHARED|BE|FE]`, взаємно непересічний
список `Owns`, `Skills`, `Route`, `Interfaces`, `Acceptance` з посиланнями на
AC#/R#, точні команди `Verify` (через `scripts/check.sh`) і `Escalate if`.
Кожен AC прив'язаний до тесту в лейні з його мітки (`[unit]`, `[it]`,
`[e2e]`); `[manual]` іде в Risks як «Manual check». Спеку без
`Status: approved` або з blocking Open questions агент не планує, а для спек,
які вже пройшли `spec-reviewer`, перевіряє лише те, що видно з коду. Код агент не пише. Із кількох
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

**Що робить.** Виконує рівно одну задачу `T<n>` з плану (`server/`,
`reviewer-core/`, `mcp/`, `client/`, `e2e/`, спільні контракти). Спершу
завантажує рівно ті скіли, що перелічені в `Skills:` задачі. Далі працює
test-first (red → green → refactor; у циклі запускає лише один тестовий файл
через `scripts/check.sh`) і наприкінці один раз запускає `Verify` задачі.
Повний gate пакета — справа оркестратора після merge. Повертає статус `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`.
Редагує тільки файли зі свого `Owns`. Git не чіпає, крім одного коміту в
worktree, коли делегування містить `commit: yes`. В `INSIGHTS.md` не пише,
а лише пропонує кандидатів, які оркестратор записує через `engineering-insights`.
Тому кілька екземплярів можуть працювати паралельно.

**На чому базується:**
- Внутрішнє: план від `implementation-planner`, `TESTING.md` (тестові «лейни»:
  `src/adapters/mocks.ts`, `*.it.test.ts`, vitest + jsdom, e2e flow JSON),
  модульні `CLAUDE.md`/`INSIGHTS.md`, правила root `CLAUDE.md` (pnpm чи npm,
  `SecretsProvider`, заборона руками редагувати міграції та послаблювати
  `INJECTION_GUARD`).
- Попередньо завантажених скілів немає; для клієнтських тестів —
  короткий проєктний скіл `client-testing`.

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
  ліниво за лейном: client — `client-testing` (+ `react-testing-library` для
  нетипового випадку); mcp — `zod` за потреби; server-unit — `fastify-best-practices`,
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

Агенти, які пишуть файли (`test-writer`, `doc-writer`, `spec-creator`), мають у frontmatter
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
- [`spec-creator-guard.sh`](../hooks/spec-creator-guard.sh) дозволяє лише
  `.md` прямо в `specs/` або в `server|client|reviewer-core|mcp/specs/`
  (без підкаталогів, тобто без `specs/plans/**`; `e2e/specs/**`, `README.md`
  і `_template.md` заблоковані). Окрім шляху, дивиться на `tool_name` і на
  рядок `Status:`/`Статус:` у файлі на диску: `Write` — лише ім'я
  `YYYY-MM-DD-<slug>.md` і лише поверх draft; `Edit` — будь-що в draft, а в
  не-draft спеці лише однорядкова заміна рядка Status (позначка superseded).
- JSON парситься через `jq`. На машині без `jq` `test-writer-guard.sh`
  переходить на `python3`, а потім на `sed`; `doc-writer-guard.sh` одразу на
  `sed`; `spec-creator-guard.sh` — на `python3`, а без обох блокує запис.

Застереження:
- Хуки у frontmatter сабагента ще не підтверджені живим прогоном (задача T6
  плану [`claude-subagents-v2`](../../specs/plans/claude-subagents-v2.md)).
  Якщо вони не спрацюють, обмеження лишається тільки правилом у промпті.
- Хук не бачить запис через Bash (`sed -i`, `cat >`, `tee`). Від цього
  захищає лише заборона в промпті.
- «Bash лише read-only» у `plan-verifier` і `architecture-reviewer` теж
  тримається тільки на промпті: поле `tools` не вміє обмежувати окремі
  команди Bash (як і в `researcher`). Тому в `spec-creator` і
  `spec-reviewer` Bash вимкнено зовсім.
- `Agent(researcher)` у `tools` агента `spec-creator` діє лише тоді, коли
  агент запущено як головну сесію (`claude --agent spec-creator`): сабагент
  не може запускати інших сабагентів, тому в цьому випадку він повертає
  блок `needs-research`.

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
