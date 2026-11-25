# Spec: DevDigest MCP server

Статус: Approved · 2026-10-22 · пакети: новий `mcp/` (+ docs, `.mcp.json`; `server` лише читається як API)

## 1. Context
Мета — дати зовнішньому агенту (Claude Code, Cursor тощо) доступ до DevDigest
через MCP: подивитися рев'юерів, запустити рев'ю на PR, прочитати findings і
конвенції репо. Сервер **локальний** (stdio), без власного стану.

Принципи дизайну (обов'язкові для кожного інструмента):
1. **Результат, а не операція.** `run_agent_on_pr` сам створює прогін, чекає й
   повертає findings.
2. **Плоскі аргументи.** Лише прості скаляри (`repo`, `pr`, `agent`), без
   вкладених об'єктів.
3. **Стисла структурована відповідь.** `{verdict, findings[]}` лише з потрібними
   полями, а не сирий дамп API.
4. **Помилка веде далі.** Замість «404» — «агента `x` не знайдено, виклич
   `list_agents`».

Бюджет токенів:
- **Старт:** `instructions` ≤ 4 рядки. Опис інструмента ≤ 3 речення.
  Сумарно `tools/list` + `instructions` ≤ **1 500 токенів** (перевіряє тест).
- **Відповідь:** жодна відповідь не перевищує ~4k токенів. Списки обрізаються з
  підказкою, як звузити запит.

## 2. Architecture
```
Claude ⇄ stdio ⇄ mcp/ (@modelcontextprotocol/sdk) ⇄ HTTP ⇄ server :3001 ⇄ Postgres
```
- Новий пакет `mcp/` (npm або pnpm — як у `reviewer-core`, без workspace).
  Структура: `src/index.ts` (stdio entry), `src/api-client.ts` (типізований
  fetch до API), `src/resolve.ts` (людські ідентифікатори → внутрішні id),
  `src/tools/<tool>.ts`, `src/format.ts` (стискання відповідей).
- **У БД не ходить**, лише через публічний HTTP API (rate-limit, tenancy).
  `DEVDIGEST_API_URL` за замовчуванням `http://localhost:3001`.
- Zod-контракти — через tsconfig `paths` на `server/src/vendor/shared`, без
  копіювання й без workspace-залежності.
- API недоступне → дієва помилка: «DevDigest API не відповідає на <url>;
  запусти `./scripts/dev.sh`».
- Логи лише в stderr. stdout належить протоколу.
- Реєстрація: `.mcp.json` у корені (project scope).

## 3. Identifiers (резолвинг у `resolve.ts`)
- `repo` — рядок `"owner/name"`, матч регістронезалежний за `GET /repos`.
  Невідомо → помилка зі списком відомих репо (≤ 10).
- `pr` — номер PR (integer) у межах repo → внутрішній pull id через
  `GET /repos/:id/pulls`. Невідомо → «PR #N не знайдено в owner/name; можливо,
  потрібно оновити репо в UI».
- `agent` — id **або** ім'я агента (регістронезалежно) за `GET /agents`.
  Невідомо чи неоднозначно → «виклич `list_agents`».

## 4. Tools
Назви в snake_case, без префікса: сервер уже має неймспейс `devdigest` у клієнті
(`mcp__devdigest__*`). Усі інструменти, крім `run_agent_on_pr`, позначені
`readOnlyHint: true`.

| # | Tool | Args | Повертає |
|---|------|------|----------|
| T1 | `list_agents` | — | `[{id, name, description?, model}]` (лише enabled-агенти, якщо є такий прапорець) |
| T2 | `run_agent_on_pr` | `repo`, `pr`, `agent`, `timeout_s?` (default 300, max 600) | як у `get_findings` + `run_id`; за таймаутом `{status:"running", run_id, hint:"call get_findings(run_id) later"}` |
| T3 | `get_findings` | `run_id?` **або** (`repo`, `pr`, `agent?`) | `{run_id, agent, status, verdict, counts_by_severity, findings[]}`; без `agent` — останній run кожного агента |
| T4 | `get_conventions` | `repo`, `category?` | лише **accepted**: `[{category, rule, path, line}]`; порожньо → підказка «запусти extraction у UI: Skills Lab → Conventions» |
| T5 | `get_blast_radius` | `repo`, `pr` | **заглушка:** `{status:"not_implemented", hint:"…"}` з `isError:false`; сигнатура фінальна, реалізація — пізніше (домашка) |

Формат finding (стислий): `{id, severity, file, line, title, suggestion?}`.
Сортування: severity desc, далі file, далі line. Не більше 50 штук; решта
відкидається з `truncated: N` і підказкою відфільтрувати за `severity_min`
(необов'язковий аргумент T2/T3). `rationale` віддається лише з
`detail: "full"` (enum `concise|full`, default `concise`).

`verdict` — з `ReviewRecord.verdict`, якщо він не null. Інакше обчислюється з
severities (`CRITICAL|WARNING|SUGGESTION`): `"request_changes"`, якщо є CRITICAL;
`"comment"`, якщо є інші; `"approve"`, якщо findings немає.

**`run_id` у T3:** API не дає зіставити run → PR, тому MCP тримає in-memory
реєстр run'ів, запущених через T2, і приймає `run_id` разом із `repo`+`pr`
(підказка за таймаутом повертає всі три). Невідомий голий `run_id` → дієва
помилка. Endpoint `GET /runs/:id` у server не додаємо.

**Очікування в T2:** `POST /pulls/:id/review {agentId}` → run id. Далі
опитування статусу (`GET /pulls/:id/runs` або `/runs/:id/trace`, обирає
planner) з backoff 1→5 с до термінального статусу або `timeout_s`. Скасування
MCP-запиту клієнтом зупиняє опитування, але **не** скасовує run.
`failed`/`cancelled` → помилка з причиною і порадою.

## 5. Acceptance criteria
- **AC1** `tools/list` повертає рівно 5 інструментів з описами ≤ 3 речень і
  плоскими input-схемами (без `object`/`array` у properties).
- **AC2** Сумарний розмір `instructions` + `tools/list` ≤ 1 500 токенів
  (оцінка: символи / 4) — unit-тест.
- **AC3** `list_agents` повертає агентів воркспейсу у стислому форматі.
- **AC4** `run_agent_on_pr` з валідними `repo/pr/agent` запускає рев'ю, чекає і
  повертає стислі findings + verdict. За таймаутом повертає `run_id` з
  підказкою.
- **AC5** `get_findings` працює і за `run_id`, і за `repo+pr(+agent)`. Ліміт
  50 + `truncated`.
- **AC6** `get_conventions` повертає лише accepted-конвенції. Порожній
  результат має підказку.
- **AC7** `get_blast_radius` повертає `not_implemented` зі стабільною сигнатурою.
- **AC8** Кожна помилка резолвингу (repo/pr/agent) і недоступність API —
  дієвий текст із наступним кроком, `isError: true`.
- **AC9** Пакет має `README.md`, `CLAUDE.md`, `INSIGHTS.md`; кореневі
  `README.md`/`CLAUDE.md` (Map, Commands) згадують `mcp/`; `.mcp.json`
  підключає сервер.

## 6. Testing
- Unit (vitest): `resolve`, `format` (стискання, ліміт, verdict), кожен tool з
  мокнутим `api-client`.
- Протокольний тест: `InMemoryTransport` з SDK — `tools/list` (AC1, AC2) і
  `tools/call` для кожного інструмента з fake API.
- Без LLM і без Docker. Live smoke проти реального API — ручний крок у README.

## 7. Out of scope
- Реальний blast radius (окремий урок/домашка).
- Streamable HTTP / віддалений доступ, OAuth.
- Resources/prompts MCP (можна додати пізніше: findings як resource, `review_pr`
  як prompt).
- Нові ендпоінти в `server` — якщо чогось бракує, planner фіксує це як
  відкрите питання, а не додає мовчки.
