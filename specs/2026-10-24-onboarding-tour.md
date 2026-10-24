# Spec: Onboarding Tour — згенерований тур по незнайомому репозиторію
Spec ID: SPEC-2026-10-24-onboarding-tour
Status: approved
Supersedes: —
Modules: server, client
Design: `specs/designs/2026-10-24-onboarding-tour/` (D1–D2, індекс у §Дизайн)

## Проблема й користувач
Розробник, який уперше відкриває репозиторій у DevDigest (новачок у команді
або рецензент чужого сервісу), не знає, з чого почати: як влаштовано сервіс,
які файли критичні, як його запустити, що читати першим і за яку задачу
взятися. Зараз він сам гортає дерево файлів і README. DevDigest уже має індекс
репо (repo-intel: ранг файлів, граф імпортів, ланцюги залежностей), клон і
вибір моделі для фічі «Onboarding Tour» у Settings, але немає сторінки, яка
перетворює це на тур. У коді лежать лише заготовки: таблиця `onboarding`,
контракт `Onboarding` і системний промпт `onboarding.system.md`.

## Goals / Non-goals
**Goals**
- Сторінка «Onboarding Tour» активного репо з п'ятьма секціями: Architecture
  overview (текст + діаграма), Critical paths, How to run locally, Guided
  reading path, First tasks.
- Генерація туру на вимогу (кнопка Generate / Regenerate) одним LLM-викликом
  (≤ 2 HTTP-запити до провайдера, AC60) у фоні, зі станом, який UI опитує.
- Кожен шлях до файлу, який повернула модель, перевіряється на наявність у
  клоні. Кожна команда запуску має перевірене джерело серед файлів, які бачила
  модель.
- «Open» відкриває файл на GitHub на коміті, з якого згенеровано тур. Кнопка copy
  копіює команду. «Share link» копіює посилання на сторінку або секцію.
- Seed готового туру для `acme/payments-api` зі змістом D1/D2 (без LLM, REC2),
  щоб e2e перевіряв заповнену сторінку.

**Non-goals**
- MCP-тул для туру (REC3 відхилено). MCP-сервер не змінюється.
- Бейдж «тур застарів» при новому HEAD (REC1 відхилено).
- Позначки прочитання в reading path (REC4 відхилено).
- Scroll-spy і авторозгортання секції кліком у навігації (REC5 відхилено).
  Підсвітка пункту навігації — лише за hash в URL (AC7).
- Показ моделі й вартості генерації (REC6 відхилено).
- Перегляд файлів усередині DevDigest: «Open» веде на GitHub.
- Історія версій туру: на репо зберігається один тур, Regenerate його замінює.
- Задачі з GitHub issues чи TODO-коментарів: First tasks пропонує модель.
- Автоматична генерація після індексації або при першому відкритті сторінки.
- Інші мови туру, крім англійської.
- Зміни reviewer-core, `INJECTION_GUARD` і grounding gate рев'ю.
- Інші пункти сайдбару з D1 (група GLOBAL, Eval Dashboard) не додаються — це майбутні уроки.

## User stories
- **US1** Як новачок у репозиторії, я відкриваю сторінку Onboarding Tour і
  переходжу між п'ятьма секціями, щоб за кілька хвилин зорієнтуватися в
  кодовій базі.
- **US2** Як користувач DevDigest, я запускаю генерацію або перегенерацію туру
  й бачу її стан, щоб отримати актуальний тур без очікування на відкритій
  сторінці.
- **US3** Як новачок, я бачу в турі лише файли, які справді є в репо, і
  відкриваю будь-який із них одним кліком, щоб не витрачати час на вигадані
  моделлю шляхи.
- **US4** Як новачок, я копіюю команди локального запуску по одній і бачу, з
  якого файлу репо взято кожну, щоб запустити сервіс і перевірити команду
  перед виконанням.
- **US5** Як новачок, я читаю файли в рекомендованому порядку з поясненням
  «чому» і вибираю стартову задачу зі списку First tasks, щоб почати робити
  внесок.

## Дизайн
| D# | Файл | Екран / стан |
|----|------|--------------|
| D1 | `specs/designs/2026-10-24-onboarding-tour/D1.png` | Сторінка Onboarding Tour, стан ideal. Сайдбар: пункт «Onboarding Tour» у WORKSPACE між «Pull Requests» і «Project Context». Breadcrumb `acme/payments-api › Onboarding Tour`. Заголовок «Onboarding for payments-api», підзаголовок «Generated from index of 12,450 files · last refreshed 2h ago», кнопки Regenerate і Share link. Ліворуч «ON THIS PAGE» з п'ятьма пунктами. Картки, що згортаються: Architecture overview (текст з code-chip-ами й діаграма client → server.ts → middleware / api/public/* → redis / postgres), Critical paths (4 рядки «шлях — опис» з кнопкою Open), початок How to run locally (3 команди з кнопкою copy). |
| D2 | `specs/designs/2026-10-24-onboarding-tour/D2.png` | Продовження сторінки, стан ideal. How to run locally з 4 нумерованими командами й кнопками copy. Guided reading path: 3 нумеровані файли з рядком «чому». Секцію First tasks не намальовано — її визначає ця спека (AC21). |

## Екрани й стани
Еталонна сторінка для узгодженості: `client/src/app/repos/[repoId]/conventions`
(сторінка в межах репо, фонова задача 202 → polling, порожні стани з CTA,
банер помилки).

| Екран | ideal | empty | loading | partial | error |
|-------|-------|-------|---------|---------|-------|
| Сайдбар і маршрут | D1; AC1, AC2, AC3 | — | — | — | — |
| Шапка сторінки | D1; AC4, AC5, AC42 | `files_indexed = 0` → AC6 | AC25 | індекс не `full` → AC24; тур є, але репо не клоновано (seed) → AC70 | помилка буфера при Share link → AC43 |
| Навігація «On this page» | D1; AC7, AC8, AC9 | — | AC25 | — | — |
| Картка Architecture overview | D1; AC10, AC11, AC12, AC13 | порожній summary → AC22 | AC25 | немає вузлів або діаграма не рендериться → AC14 | — |
| Картка Critical paths | D1; AC15, AC16, AC23 | 0 рядків після перевірки → AC22 | AC25 | частину шляхів відкинуто → AC62 (видно лише перевірені) | — |
| Картка How to run locally | D1, D2; AC17, AC18, AC23 | 0 команд → AC22 | AC25 | частину команд відкинуто → AC63 | помилка буфера → AC19 |
| Картка Guided reading path | D2; AC20, AC23 | 0 кроків → AC22 | AC25 | AC62 | — |
| Картка First tasks (не намальовано) | AC21, AC16 | 0 задач → AC22 | AC25 | задачі без перевірених файлів відкинуто → AC69 | — |
| Сторінка без туру | — | немає активного репо → AC27; репо не клоновано й туру немає → AC28; клоновано, туру немає → AC29 | AC25; генерація триває → AC31 | — | генерація впала → AC36 (текст `{error}` — AC79); помилка першого GET → AC26; помилка GET під час опитування → AC77, AC78; репо не знайдено → AC41 |
| Сторінка з туром під час Regenerate | — | — | AC32, AC33, AC34 | — | Regenerate впав → AC35 (текст `{error}` — AC79); помилка GET під час опитування → AC77, AC78; помилки старту → AC37, AC38, AC39, AC40 |

## Взаємодія модулів
| Дія | Шлях (client → API → сервіс → БД / LLM / GitHub) | Контракт / ендпоінт | Нове чи є |
|-----|------|------|------|
| Відкрити сторінку | новий хук → `api.ts` → `GET /repos/:id/onboarding` → новий модуль onboarding → таблиця `onboarding` | новий `OnboardingTourResponse = { job: OnboardingJob \| null, tour: OnboardingTour \| null }`, де `OnboardingJob = { status: 'running' \| 'done' \| 'failed', error: string \| null, started_at, finished_at \| null }`; `error` — фіксоване повідомлення AC79, ≤ 200 символів | Нове. Таблиця `onboarding` є (заготовка) |
| Generate / Regenerate | хук-мутація → `POST /repos/:id/onboarding/generate` → модуль onboarding: перевірки (репо, клон, запуск, що вже триває, ключ моделі) → 202. Далі у фоні: `GitClient.currentHead` → repo-intel (`getIndexState`, `getTopFilesByRank`, `getCriticalPaths`) → читання файлів клону → один виклик `completeStructured` через модель фічі `onboarding` (Settings → Feature Models) → перевірка шляхів і команд → запис у `onboarding` | відповідь 202 `{ job: OnboardingJob }`. Помилки: 404, 409 `repo_not_cloned`, 409 `onboarding_in_progress`, 422 `llm_not_configured` | Нове. Фасад repo-intel, `resolveFeatureModel('onboarding')`, `GitClient`, `wrapUntrusted` уже є |
| Polling стану | хук: `GET /repos/:id/onboarding` кожні 2 с, поки `job.status = 'running'`; помилка окремого GET не зупиняє опитування (AC77, AC78) | `OnboardingTourResponse` | Нове |
| Open файл | клієнт формує URL `https://github.com/{owner}/{name}/blob/{commit_sha}/{path}` з `Repo` і туру | — (без запиту до API) | Нове |
| Copy команди / Share link | Clipboard API браузера | — | Нове |

`OnboardingTour` — типізований контракт:
- `commit_sha`, `generated_at`, `files_indexed`, `index_status`
  (`full` | `partial` | `degraded` | `failed` | `none`);
- `architecture: { summary, diagram: { nodes: {id, label, kind, path \| null}[], edges: {from, to}[] } }`,
  де `kind` ∈ `external` | `entry` | `module` | `middleware` | `datastore`;
- `critical_paths: {path, description}[]`;
- `run_steps: {command, source_path}[]`;
- `reading_path: {path, why}[]`;
- `first_tasks: {title, description, size: 'S' | 'M', files: string[]}[]`.

Він замінює заготовки `Onboarding`, `OnboardingSection` і `OnboardingLink` в
**обох копіях** `vendor/shared` (`server/src/vendor/shared/contracts/knowledge.ts`
і `client/src/vendor/shared/contracts/knowledge.ts`). Це урок L05, який заповнює
ці заготовки, а не видалення мертвого коду.

Фонова генерація має один wall-clock дедлайн 180 с на весь запуск (AC54,
AC74), він менший за поріг завислого запуску 10 хв (AC48, AC50). На
провайдера йде ≤ 2 HTTP-запити, включно з транспортними повторами (AC60).
Результат запуску, який уже не є поточним, відкидається (AC75).

Таблиці: наявна `onboarding` (PK `repo_id`, каскадне видалення з репо;
зараз `json` — `notNull`, `generated_at` — `defaultNow().notNull()`,
`server/src/db/schema/context.ts:129-130`). Колонки туру `json` і
`generated_at` стають nullable, а в `generated_at` прибирається значення за
замовчуванням: на першому запуску рядок має стан `running`, але туру ще
немає. `generated_at` записується лише при успішному завершенні (AC52). До
цієї ж таблиці додаються колонки стану генерації: статус, помилка (≤ 200
символів, AC79), час старту й завершення, а також дані, за якими відрізняють
поточний запуск від застарілого (AC75). Міграцію генерують зі схеми
(`pnpm db:generate`), руками не редагують. Системний промпт
`server/src/prompts/onboarding.system.md` переписується під нову структуру.

Вплив на інших споживачів:
- `server/test/contracts.test.ts` парсить `Onboarding`, тож тест треба
  оновити під новий контракт.
- Сайдбар (`client/src/vendor/ui/nav.ts`) отримує пункт «Onboarding Tour».
  Визначення активного пункту в app-shell змінюється так, щоб `/onboarding`
  («Add repository») більше не підсвічував цей пункт (AC2). Перемикання репо
  зі сторінки туру лишає користувача на ній (AC3).
- Settings → Feature Models: вибір моделі «Onboarding Tour» уже є і тепер
  реально використовується.
- MCP: без змін.
- Seed (`pnpm db:seed`, той самий скрипт, що наповнює `acme/payments-api` і
  PR #482) отримує рядок `onboarding` для `acme/payments-api`: тур зі
  змістом D1/D2 і `job.status = 'done'`, валідний за `OnboardingTour` (AC71,
  AC72). Seed-репо не клоноване (`clone_path: null`), тож e2e бачить стан
  AC70 (тур показано, Regenerate заблоковано), а не AC28.
- Новий e2e-флоу для сторінки туру на seed-даних (AC73). LLM не
  викликається.
- Наявні e2e-флоу (`e2e/specs/06-onboarding.flow.json` — це «Add
  repository») не зачіпаються.

## Acceptance criteria (EARS)

Пари event → unwanted: для Generate/Regenerate — AC30 → AC35–AC40; для copy —
AC18 → AC19; для Share link — AC42 → AC43; для опитування (AC33, AC34) — AC77,
AC78; для завершення генерації (AC52) — AC53, AC54, AC75, AC76. Клік у навігації (AC8), згортання
(AC11) і Open (AC16) — локальні дії браузера без запиту до API, тож окремого
unwanted для них немає.

### Навігація й шапка (D1)
- **AC1** (ubiquitous, US1) UI повинен (shall) показувати в сайдбарі в групі WORKSPACE пункт «Onboarding Tour» між «Pull Requests» і «Project Context» (D1), без клавіатурної комбінації. Пункт веде на `/repos/:repoId/tour` активного репо й підсвічений як активний на цьому маршруті. `[unit]` `[e2e]`
- **AC2** (ubiquitous, US1) UI не повинен (shall not) підсвічувати пункт «Onboarding Tour» на маршруті `/onboarding` (екран «Add repository»). `[unit]`
- **AC3** (event, US1) КОЛИ користувач перемикає активне репо, перебуваючи на `/repos/:repoId/tour`, UI повинен (shall) перейти на `/repos/<id нового репо>/tour`. `[unit]`
- **AC4** (ubiquitous, US1) Сторінка повинна (shall) показувати breadcrumb `{owner/name} › Onboarding Tour` і заголовок «Onboarding for {name}», де `{name}` — назва репо моноширинним шрифтом кольору accent (D1). Коли тур є, праворуч від заголовка показано кнопки «Regenerate» і «Share link». `[unit]` `[e2e]`
- **AC5** (state, US1) ПОКИ тур є і `files_indexed` > 0, підзаголовок повинен (shall) мати вигляд «Generated from index of {N} files · last refreshed {ago}». N — `files_indexed` з роздільником тисяч (`12,450`). `{ago}` рахується від `generated_at`: «just now» (< 1 хв), «{n}m ago» (< 60 хв), «{n}h ago» (< 24 год), інакше «{n}d ago». `[unit]` `[e2e]` (e2e перевіряє лише «Generated from index of 12,450 files» і наявність «last refreshed»)
- **AC6** (unwanted, US1) ЯКЩО `files_indexed` туру = 0, ТОДІ підзаголовок повинен (shall) мати вигляд «Generated from repository files · last refreshed {ago}». `[unit]`
- **AC7** (ubiquitous, US1) Сторінка з туром повинна (shall) показувати ліворуч блок «ON THIS PAGE» з п'ятьма посиланнями в порядку: «Architecture overview» → `#architecture`, «Critical paths» → `#critical-paths`, «How to run locally» → `#run-locally`, «Guided reading path» → `#reading-path`, «First tasks» → `#first-tasks`. Підсвічено пункт, чий якір збігається з hash в URL, а без hash — перший пункт. `[unit]` `[e2e]`
- **AC8** (event, US1) КОЛИ користувач клацає пункт «ON THIS PAGE», UI повинен (shall) прокрутити сторінку до відповідної секції й записати її якір у hash URL. `[unit]` `[e2e]`
- **AC9** (event, US1) КОЛИ сторінку відкрито з hash, що збігається з якорем секції, UI повинен (shall) прокрутити до цієї секції одразу після того, як тур відрендерено. `[unit]` `[e2e]`
- **AC10** (ubiquitous, US1) Кожна з п'яти секцій повинна (shall) бути карткою з іконкою, заголовком і кнопкою-перемикачем (chevron) з `aria-expanded`. Після завантаження сторінки всі картки розгорнуті. `[unit]` `[e2e]`
- **AC11** (event, US1) КОЛИ користувач натискає перемикач картки, UI повинен (shall) сховати або показати тіло картки, лишивши заголовок видимим, і оновити `aria-expanded`. `[unit]` `[e2e]`
- **AC42** (event, US1) КОЛИ користувач натискає «Share link», UI повинен (shall) скопіювати в буфер обміну повний URL поточної сторінки разом із hash (якщо він є) і показати toast «Link copied». `[unit]` `[e2e]` (e2e перевіряє toast; вміст буфера — компонентний тест)
- **AC43** (unwanted, US1) ЯКЩО запис у буфер обміну не вдався (для Share link або copy команди), ТОДІ UI повинен (shall) показати toast «Couldn't copy to clipboard». `[unit]`

### Секції туру
- **AC12** (ubiquitous, US3) Картка Architecture overview повинна (shall) показувати `architecture.summary` як звичайний текст з двома правилами форматування:
  - кожен фрагмент у зворотних лапках (`` `src/server.ts` ``) показано як code-chip (D1);
  - кожен фрагмент між парою `**` (`**payments-api**`) показано жирним (D1: «payments-api» на початку summary), без самих `**`.
  Вміст code-chip показується буквально (зокрема `**` всередині нього). Непарні `**` чи зворотні лапки показуються як звичайні символи. Інша Markdown-розмітка і HTML не інтерпретуються. `[unit]`
- **AC13** (ubiquitous, US3) Картка Architecture overview повинна (shall) показувати під текстом діаграму `flowchart LR`, побудовану з `diagram.nodes` і `diagram.edges`. Колір рамки вузла залежить від `kind`: `external` — нейтральний, `entry` і `module` — accent (синій), `middleware` — warning (бурштиновий), `datastore` — success (зелений), як на D1. `[unit]` `[manual]` (розробник звіряє кольори з D1 на тестовому турі перед мержем)
- **AC14** (unwanted, US3) ЯКЩО `diagram.nodes` порожній або діаграму не вдалося відрендерити, ТОДІ картка повинна (shall) показати summary і замість діаграми текст «Diagram unavailable». `[unit]`
- **AC15** (ubiquitous, US3) Картка Critical paths повинна (shall) показувати кожен елемент `critical_paths` рядком: іконка файлу, `path` моноширинним шрифтом, «— {description}» і кнопка «Open» з доступною назвою «Open {path}» (D1). `[unit]` `[e2e]`
- **AC16** (event, US3) КОЛИ користувач натискає «Open» біля файлу (Critical paths або First tasks), UI повинен (shall) відкрити в новій вкладці `https://github.com/{owner}/{name}/blob/{commit_sha}/{path}` (кожен сегмент `path` URL-кодовано), з `rel="noopener noreferrer"`. `[unit]` `[e2e]` (e2e перевіряє атрибут `href` посилання Open для `src/server.ts` на seed-турі, без переходу на GitHub)
- **AC17** (ubiquitous, US4) Картка How to run locally повинна (shall) показувати над командами текст «Generated from repo files — review before running.». Далі йдуть нумеровані рядки (1…n): номер, `command` моноширинним шрифтом, під ним «from {source_path}», і кнопка copy з доступною назвою «Copy command {n}» (D1, D2). `[unit]` `[e2e]`
- **AC18** (event, US4) КОЛИ користувач натискає copy у рядку команди, UI повинен (shall) скопіювати в буфер обміну повний текст `command` цього рядка й показати toast «Copied». `[unit]` `[e2e]` (e2e перевіряє toast; вміст буфера — компонентний тест)
- **AC19** (unwanted, US4) ЯКЩО копіювання команди в буфер не вдалося, ТОДІ UI повинен (shall) поводитися за AC43. `[unit]`
- **AC20** (ubiquitous, US5) Картка Guided reading path повинна (shall) показувати елементи `reading_path` у збереженому порядку: номер у колі, `path` моноширинним шрифтом і під ним рядок `why` (D2). Кнопки Open у цій картці немає. `[unit]` `[e2e]`
- **AC21** (ubiquitous, US5) Картка First tasks повинна (shall) показувати кожну задачу блоком у стилі рядків Critical paths: `title`, бейдж розміру з текстом «S» або «M», `description` і під ними по рядку на кожен файл з `files` (іконка, `path` моноширинним шрифтом, кнопка «Open» за AC16). `[unit]` `[e2e]`
- **AC22** (unwanted, US3) ЯКЩО секція туру не має жодного елемента (для Architecture overview — порожній `summary`), ТОДІ її картка повинна (shall) показати текст «Not enough grounded information for this section.». `[unit]`
- **AC23** (ubiquitous, US3) UI повинен (shall) обрізати `path`, що не вміщається в рядок, посередині символом «…» і показувати повний шлях в атрибуті `title`. Команди, довші за ширину рядка, переносяться без горизонтальної прокрутки, а copy копіює повний текст. `[unit]`
- **AC24** (state, US1) ПОКИ `index_status` показаного туру не `full`, сторінка повинна (shall) показувати під підзаголовком банер «Index is partial — critical paths may be less accurate.». `[unit]`

### Стани сторінки
- **AC25** (state, US1) ПОКИ перший `GET /repos/:id/onboarding` триває, UI повинен (shall) показувати скелетони шапки, блоку «ON THIS PAGE» і п'яти карток. `[unit]`
- **AC26** (unwanted, US1) ЯКЩО перший `GET /repos/:id/onboarding` після відкриття сторінки завершився помилкою (жодного стану туру ще не показано), ТОДІ UI повинен (shall) показати стан помилки «Couldn't load the onboarding tour» з кнопкою Retry, що повторює запит. `[unit]`
- **AC27** (unwanted, US1) ЯКЩО у воркспейсі немає активного репо, ТОДІ сторінка повинна (shall) показати порожній стан «Add a repository to generate its onboarding tour.» з посиланням на `/onboarding`. `[unit]`
- **AC28** (unwanted, US2) ЯКЩО в активного репо `clone_path` порожній і туру немає, ТОДІ сторінка повинна (shall) показати порожній стан «Repository isn't cloned yet — sync it to generate an onboarding tour.» без кнопки генерації. `[unit]` (не `[e2e]`: seed-репо має тур, тож цей стан на seed-даних недосяжний)
- **AC29** (state, US2) ПОКИ репо клоноване, туру немає, а `job` дорівнює `null`, сторінка повинна (shall) показувати порожній стан із заголовком «No onboarding tour yet», текстом «Generate a tour of this repository: architecture, critical paths, how to run it, a reading path and first tasks.» і кнопкою «Generate tour». `[unit]`
- **AC30** (event, US2) КОЛИ користувач натискає «Generate tour», «Regenerate» або «Try again», UI повинен (shall) надіслати `POST /repos/:id/onboarding/generate`. Поки запит триває, ця кнопка disabled з `aria-busy="true"`. `[unit]`
- **AC31** (state, US2) ПОКИ `job.status = 'running'` і туру немає, сторінка повинна (shall) показувати стан «Generating onboarding tour…» з текстом «This usually takes up to 2 minutes. You can leave the page — generation continues.» в області `aria-live="polite"`. `[unit]`
- **AC32** (state, US2) ПОКИ `job.status = 'running'` і попередній тур є, сторінка повинна (shall) показувати попередній тур і над ним банер «Regenerating… The current tour stays until the new one is ready.». Кнопка «Regenerate» при цьому disabled з `aria-busy="true"`. `[unit]`
- **AC33** (state, US2) ПОКИ `job.status = 'running'`, UI повинен (shall) повторювати `GET /repos/:id/onboarding` кожні 2 с і припиняти після `done` або `failed`. `[unit]`
- **AC34** (event, US2) КОЛИ опитування отримує `job.status = 'done'`, UI повинен (shall) показати новий тур без перезавантаження сторінки. `[unit]`
- **AC35** (unwanted, US2) ЯКЩО `job.status = 'failed'` і попередній тур є, ТОДІ сторінка повинна (shall) показувати попередній тур і банер з `role="alert"` «Couldn't regenerate the tour: {error}» з кнопкою «Try again», де `{error}` — `job.error` (фіксоване повідомлення AC79, ≤ 200 символів). `[unit]`
- **AC36** (unwanted, US2) ЯКЩО `job.status = 'failed'` і туру немає, ТОДІ сторінка повинна (shall) показати стан помилки «Couldn't generate the tour: {error}» з кнопкою «Try again», де `{error}` — `job.error` (фіксоване повідомлення AC79, ≤ 200 символів). `[unit]`
- **AC37** (unwanted, US2) ЯКЩО `POST …/generate` відповів 422 `llm_not_configured`, ТОДІ UI повинен (shall) показати банер з `role="alert"` «No API key for the Onboarding Tour model. Add one in Settings → API Keys.» з посиланням на `/settings/api-keys`. `[unit]`
- **AC38** (unwanted, US2) ЯКЩО `POST …/generate` відповів 409 `repo_not_cloned`, ТОДІ UI повинен (shall) показати банер з `role="alert"` «Repository isn't cloned yet — sync it to generate an onboarding tour.». `[unit]`
- **AC39** (unwanted, US2) ЯКЩО `POST …/generate` відповів 409 `onboarding_in_progress`, ТОДІ UI повинен (shall) перейти в стан AC31 або AC32 і почати опитування за AC33, не показуючи помилки. `[unit]`
- **AC40** (unwanted, US2) ЯКЩО `POST …/generate` завершився будь-якою іншою помилкою, ТОДІ UI повинен (shall) показати банер з `role="alert"` «Couldn't start generation: {message}». `[unit]`
- **AC41** (unwanted, US1) ЯКЩО `:repoId` з URL немає у воркспейсі, ТОДІ сторінка повинна (shall) показати наявний стан «repo not found» застосунку. `[unit]`

### API
- **AC44** (event, US2) КОЛИ клієнт викликає `GET /repos/:id/onboarding`, API повинен (shall) відповісти 200 тілом `OnboardingTourResponse`. `tour` — останній успішний тур репо або `null`, `job` — стан останньої генерації або `null`, якщо її ще не запускали. `[unit]` `[it]`
- **AC45** (unwanted, US2) ЯКЩО репо з `:id` немає у воркспейсі, ТОДІ API повинен (shall) відповісти 404 на `GET /repos/:id/onboarding` і `POST /repos/:id/onboarding/generate`. Для не-uuid `:id` відповідь — 422 `validation_error`. `[unit]`
- **AC46** (event, US2) КОЛИ клієнт викликає `POST /repos/:id/onboarding/generate` для клонованого репо, у якого немає активної генерації і для моделі фічі `onboarding` є ключ, API повинен (shall) записати `job.status = 'running'`, відповісти 202 `{ job }` і продовжити генерацію у фоні. `[unit]` `[it]`
- **AC47** (unwanted, US2) ЯКЩО `clone_path` репо порожній або тека клону відсутня чи не є git-репозиторієм, ТОДІ API повинен (shall) відповісти на POST 409 `repo_not_cloned` і не створювати запуск. `[unit]`
- **AC48** (unwanted, US2) ЯКЩО для репо вже є генерація зі статусом `running`, не старша за 10 хв, ТОДІ API повинен (shall) відповісти на POST 409 `onboarding_in_progress` і не запускати другу генерацію. `[unit]` `[it]`
- **AC49** (unwanted, US2) ЯКЩО для провайдера моделі фічі `onboarding` немає ключа в `SecretsProvider`, ТОДІ API повинен (shall) відповісти на POST 422 `llm_not_configured` і не створювати запуск. `[unit]`
- **AC50** (unwanted, US2) ЯКЩО генерація має статус `running` довше за 10 хв (сервер зупинився посеред запуску), ТОДІ API повинен (shall) віддавати її в GET як `failed` з `error` «Generation did not finish (the server stopped mid-run)» (фіксоване повідомлення AC79) і приймати новий POST. Поріг 10 хв більший за дедлайн генерації 180 с (AC74), тож запуск, що ще триває на живому сервері, під нього не потрапляє. `[unit]` `[it]`
- **AC51** (ubiquitous, US2) Система повинна (shall) генерувати тур моделлю, вибраною для фічі «Onboarding Tour» у Settings → Feature Models, а без вибору — моделлю за замовчуванням з реєстру фіч. `[unit]`
- **AC52** (event, US2) КОЛИ генерація успішно завершилась, система повинна (shall) замінити збережений тур репо новим і записати `job.status = 'done'`. `generated_at` — час завершення, `commit_sha` — HEAD клону на старті, `files_indexed` і `index_status` — стан індексу repo-intel на старті (`none`, якщо індексу немає). `[it]`
- **AC53** (unwanted, US2) ЯКЩО в межах ≤ 2 HTTP-запитів AC60 генерація не отримала відповіді, що пройшла схему (помилка провайдера, мережева помилка або відповідь не пройшла схему), ТОДІ система повинна (shall) записати `job.status = 'failed'` з фіксованим повідомленням AC79 у `job.error`, а збережений тур лишити без змін. `[unit]` `[it]`
- **AC54** (unwanted, US2) ЯКЩО генерація не завершилась за 180 с від запису `job.status = 'running'` (один wall-clock дедлайн на весь запуск: читання клону, усі HTTP-запити до провайдера разом із повтором і перевірка відповіді), ТОДІ система повинна (shall) перервати HTTP-запит до провайдера, що триває, не надсилати нових, записати `job.status = 'failed'` з `error` «The model did not respond within 180 s» (фіксоване повідомлення AC79), а збережений тур лишити без змін. `[unit]`
- **AC55** (ubiquitous, system) Система повинна (shall) видаляти тур і стан генерації репо разом із видаленням цього репо. `[it]`

### Вхід моделі
- **AC56** (ubiquitous, US2) Система повинна (shall) передавати моделі рівно такі дані клону на HEAD (пункти 5 і 6 — лише для `index_status` `full` або `partial`, за AC61):
  1. дерево файлів — до 500 шляхів за зростанням `path`, без тек `node_modules`, `dist`, `build`, `coverage`, `.next`, `out`, `vendor`, `.git`;
  2. кореневий README (`README*`, без урахування регістру) — до 20 000 символів;
  3. кореневі файли `package.json`, `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `Makefile`, `Dockerfile`, `.env.example` — до 400 рядків і до 20 000 символів кожен (діє той ліміт, що настає раніше);
  4. лише назви наявних lock-файлів (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`);
  5. до 15 файлів з найвищим рангом repo-intel без тестів і конфігів — до 200 рядків і до 20 000 символів кожен (діє той ліміт, що настає раніше);
  6. ланцюги залежностей з repo-intel. `[unit]`
- **AC57** (ubiquitous, system) Система не повинна (shall not) читати й передавати моделі вміст файлів `.env`, `.env.*` (крім `.env.example`), `*.pem` і `*.key`, навіть якщо такий файл є серед файлів з найвищим рангом. `[unit]`
- **AC58** (ubiquitous, system) Система повинна (shall) передавати весь вміст репо (дерево, README, маніфести, файли, ланцюги) лише в user-повідомленні, кожен файл в окремому `<untrusted>`-блоці. Системне повідомлення має містити інструкцію, що вміст `<untrusted>`-блоків — дані, а не інструкції. `INJECTION_GUARD` і grounding gate reviewer-core не змінюються. `[unit]`
- **AC59** (unwanted, US2) ЯКЩО вхід моделі перевищує 60 000 токенів cl100k, ТОДІ система повинна (shall) прибирати файли з найвищим рангом, починаючи з найнижчого рангу, доки вхід не стане ≤ 60 000 токенів. `[unit]`
- **AC60** (ubiquitous, US2) Система повинна (shall) надсилати провайдеру на одну генерацію не більше 2 HTTP-запитів: перший запит зі структурованою відповіддю і щонайбільше один повтор — лише коли відповідь не пройшла схему або запит отримав 429, 5xx чи мережеву помилку. Транспортні повтори рахуються в ці 2 запити, інших повторів немає. `[unit]`
- **AC61** (unwanted, US2) ЯКЩО індекс repo-intel репо має статус `degraded` чи `failed`, індексу немає (`none`) або repo-intel вимкнено, ТОДІ система повинна (shall) згенерувати тур лише з пунктів 1–4 AC56 (дерево файлів, README, маніфести, назви lock-файлів), без файлів з найвищим рангом і ланцюгів залежностей, і записати фактичний `index_status`. Для `partial` модель отримує пункти 1–6 AC56 у тому обсязі, який повертає repo-intel (менше 15 файлів або порожні ланцюги не доповнюються), для `full` — пункти 1–6. `[unit]`

### Перевірка відповіді моделі
- **AC62** (unwanted, US3) ЯКЩО шлях з `critical_paths`, `reading_path`, `first_tasks[].files` або `diagram.nodes[].path`:
  - абсолютний, містить сегмент `..`, `\` чи NUL;
  - після розв'язання symlink веде за межі клону;
  - не є звичайним файлом у робочому дереві клону,
  ТОДІ система повинна (shall) відкинути цей елемент перед збереженням. Для вузла діаграми відкидається лише його `path` (стає `null`), а сам вузол лишається. `[unit]`
- **AC63** (unwanted, US4) ЯКЩО `source_path` команди запуску не входить до файлів, чий вміст передано моделі за AC56 (README, маніфести, файли з найвищим рангом після обрізання за AC59 і AC76; шляхи з дерева файлів і назви lock-файлів не рахуються), ТОДІ система повинна (shall) відкинути цю команду перед збереженням. `[unit]`
- **AC64** (ubiquitous, US4) Система повинна (shall) перед збереженням застосовувати ліміти:
  - не більше 8 елементів `critical_paths`, 10 `run_steps`, 8 `reading_path` і 5 `first_tasks`; зайві елементи з кінця відкидаються;
  - `description` і `why` обрізаються до 140 символів, `title` — до 80, `summary` — до 800, з «…» в кінці обрізаного тексту;
  - команда довша за 500 символів відкидається.
  Якщо елементів менше за рекомендований мінімум (3 для critical paths, reading path і first tasks), їх зберігають як є. `[unit]`
- **AC65** (ubiquitous, US3) Система повинна (shall) прибирати повтори одного `path` у межах `critical_paths`, у межах `reading_path` і в межах `files` однієї задачі. Лишається перший запис. `[unit]`
- **AC66** (ubiquitous, US3) Система повинна (shall) зберігати діаграму так:
  - не більше 12 вузлів і 20 ребер;
  - ребра, що посилаються на неіснуючий вузол, відкидаються;
  - `label` вузла обрізається до 40 символів, а кожен символ поза набором `A–Z a–z 0–9 пробіл . _ / * @ : -` замінюється на `_`;
  - `id` вузлів генерує сервер (`n1`…`n12`), а не модель. `[unit]`
- **AC67** (ubiquitous, system) UI повинен (shall) рендерити весь текст туру (summary, описи, why, title, команди, мітки вузлів) як текст. Сирий HTML не виконується, посилань, крім кнопок Open з AC16, немає, а діаграма рендериться mermaid з `securityLevel: "strict"`. Єдине форматування — code-chip і жирний текст у summary за AC12, вміст яких теж вставляється як текст. `[unit]`
- **AC68** (ubiquitous, US4) UI не повинен (shall not) виконувати команди з How to run locally. Єдина дія з ними — копіювання в буфер обміну (AC18). `[unit]`
- **AC69** (unwanted, US5) ЯКЩО після перевірки за AC62 у задачі First tasks не лишилося жодного файлу, ТОДІ система повинна (shall) відкинути цю задачу. У кожній збереженій задачі 1–3 файли: зайві відкидаються з кінця. `[unit]`

### Тур без клону і seed (REC2)
- **AC70** (state, US1) ПОКИ тур є, а `clone_path` активного репо порожній, сторінка повинна (shall) показувати збережений тур. Кнопка «Regenerate» при цьому disabled з підказкою «Repository isn't cloned yet — sync it to regenerate the tour.», доступною через `title` і `aria-describedby`. «Share link», copy і Open працюють як звичайно. `[unit]` `[e2e]`
- **AC71** (ubiquitous, system) Seed повинен (shall) створювати для репо `acme/payments-api` один збережений тур зі `job.status = 'done'`, який проходить zod-схему `OnboardingTour`, з таким змістом:
  - `commit_sha` — фіксований 40-символьний hex-SHA, заданий seed-ом; `files_indexed` = 12 450; `index_status` = `full`; `generated_at` = час запуску seed мінус 2 год;
  - `architecture.summary` — текст з D1 (за AC12 «payments-api» показано жирним): «**payments-api** is a Node + TypeScript service fronting Stripe. Requests enter through `src/server.ts`, pass middleware (auth, rate-limit), and route to `src/api/*`. Persistence is Postgres via a thin `db` client; Redis backs sessions and the new rate-limit buckets.»;
  - `architecture.diagram`:
    - вузли: `client` (`external`), `server.ts` (`entry`, `src/server.ts`), `middleware` (`middleware`), `api/public/*` (`module`), `redis` (`datastore`), `postgres` (`datastore`);
    - ребра: client → server.ts, server.ts → middleware, middleware → api/public/*, middleware → redis, api/public/* → postgres;
  - `critical_paths` — 4 рядки з D1:
    - `src/server.ts` — «App bootstrap + middleware chain»;
    - `src/api/public/index.ts` — «Public router — unauthenticated surface»;
    - `src/middleware/auth.ts` — «Token validation, used by 14 routes»;
    - `src/lib/redis.ts` — «Shared Redis singleton — reuse this»;
  - `run_steps` — 4 команди з D2 із джерелами:
    - `pnpm install` (`package.json`);
    - `cp .env.example .env # add OPENAI + STRIPE keys` (`.env.example`);
    - `docker compose up -d postgres redis` (`docker-compose.yml`);
    - `pnpm dev # http://localhost:3000` (`package.json`);
  - `reading_path` — 3 кроки з D2:
    - `src/server.ts` — «See the whole request lifecycle in one file»;
    - `src/api/public/index.ts` — «Understand the public contract before touching it»;
    - `src/middleware/auth.ts` — «Auth touches almost everything downstream»;
  - `first_tasks` — 3 задачі:
    - «Cover expired tokens in auth middleware» (S, `src/middleware/auth.ts`);
    - «Reuse the shared Redis client for rate-limit buckets» (M, `src/lib/redis.ts`);
    - «Document the public router endpoints» (S, `src/api/public/index.ts`);
    кожна з описом в одне речення ≤ 140 символів. `[unit]` `[it]`
- **AC72** (event, system) КОЛИ seed запускається повторно на БД, де seed-тур уже є, система повинна (shall) лишити для `acme/payments-api` рівно один тур зі змістом AC71. `[it]`
- **AC73** (event, US1) КОЛИ користувач відкриває `/repos/<id acme/payments-api>/tour` на seed-даних, UI повинен (shall) показати п'ять карток із вмістом AC71: summary й діаграма, 4 рядки Critical paths, 4 команди, 3 кроки reading path і 3 задачі First tasks, без банера часткового індексу. `[e2e]`

### Дедлайн, застарілі запуски, ліміти входу, помилки (ревʼю)
- **AC74** (ubiquitous, system) Система повинна (shall) переводити кожну генерацію в `done` або `failed` не пізніше ніж через 180 с після запису `job.status = 'running'` (AC54), тобто раніше за поріг завислого запуску 10 хв (AC48, AC50). `[unit]`
- **AC75** (unwanted, US2) ЯКЩО генерація завершилась, але вона вже не є поточним запуском репо (визнана завислою за AC50 або замінена новим запуском), ТОДІ система повинна (shall) відкинути її результат і не змінювати тур і `job`. `[unit]` `[it]`
- **AC76** (unwanted, US2) ЯКЩО після прибирання всіх файлів з найвищим рангом за AC59 вхід моделі все ще перевищує 60 000 токенів cl100k, ТОДІ система повинна (shall) прибирати решту входу в такому порядку, перевіряючи розмір після кожного кроку:
  1. ланцюги залежностей — повністю;
  2. дерево файлів — повністю.
  Якщо після цього вхід усе ще > 60 000 токенів, система повинна (shall) не надсилати жодного HTTP-запиту провайдеру і записати `job.status = 'failed'` з `error` «Repository context is too large for the model (over 60,000 tokens)», а збережений тур лишити без змін. `[unit]`
- **AC77** (unwanted, US2) ЯКЩО `GET /repos/:id/onboarding` під час опитування (AC33) або фонового оновлення завершився помилкою після того, як сторінка вже показала тур або стан генерації, ТОДІ UI повинен (shall) лишити показаним останній отриманий стан (тур, AC31 або AC32) і продовжити запити кожні 2 с, не переходячи в стан помилки AC26. `[unit]`
- **AC78** (unwanted, US2) ЯКЩО повторний GET завершився помилкою за AC77, ТОДІ UI повинен (shall) показати над карткою або станом генерації неблокуюче повідомлення «Connection lost — retrying…» в області `aria-live="polite"` і сховати його після наступного успішного GET. `[unit]`
- **AC79** (ubiquitous, system) Система повинна (shall) записувати в `job.error` лише одне з фіксованих повідомлень (≤ 200 символів), відповідно до класу помилки:
  - дедлайн AC54 — «The model did not respond within 180 s»;
  - відповідь не пройшла схему (AC53) — «The model returned a tour that doesn't match the expected format»;
  - провайдер відповів HTTP-помилкою (AC53) — «The model provider returned an error (HTTP {status})», де `{status}` — тризначний код;
  - мережева помилка без HTTP-статусу (AC53) — «Couldn't reach the model provider»;
  - завеликий вхід (AC76) — «Repository context is too large for the model (over 60,000 tokens)»;
  - завислий запуск (AC50) — «Generation did not finish (the server stopped mid-run)»;
  - будь-яка інша помилка — «Generation failed unexpectedly».
  `job.error` ніколи не містить сирого тексту помилки провайдера чи zod, заголовків запиту, ключа API або вмісту промпту. `[unit]`
- **AC80** (ubiquitous, system) Система повинна (shall) писати повний сирий текст помилки (провайдера, zod, мережі) лише в серверний лог, без ключа API і без вмісту промпту; у відповідь API і UI він не потрапляє. `[unit]`

## Edge cases
- **EC1** Модель вигадала шлях, якого немає в клоні → елемент відкинуто, у UI видно лише наявні файли (AC62).
- **EC2** Модель повернула шлях з `..`, абсолютний шлях або symlink за межі клону → елемент відкинуто (AC62).
- **EC3** Команда з джерелом, якого модель не бачила → команду відкинуто (AC63).
- **EC4** Після перевірки секція порожня → «Not enough grounded information for this section.» (AC22).
- **EC5** Не-JS репо або репо без індексу → тур з дерева, README й маніфестів, банер про частковий індекс (AC61, AC24, AC6).
- **EC6** Репо не клоновано (зокрема seed-репо) → порожній стан без кнопки генерації; прямий POST дає 409 (AC28, AC47, AC38).
- **EC7** Повторне натискання Generate або дві вкладки браузера → 409 `onboarding_in_progress`, UI просто опитує стан (AC48, AC39).
- **EC8** Сервер перезапустився посеред генерації → через 10 хв запуск вважається `failed`, можна перегенерувати; старий тур на місці (AC50, NFR6).
- **EC9** Regenerate впав → старий тур лишається, банер з Try again (AC35, AC53).
- **EC10** Немає ключа для моделі фічі → 422 і посилання на Settings (AC49, AC37).
- **EC11** Модель не відповідає → `failed` через 180 с (AC54).
- **EC12** Великий репо (README > 20 000 символів, > 500 файлів у дереві, вхід > 60 000 токенів) → вхід обрізається за лімітами (AC56, AC59).
- **EC13** У репо є `.env` із секретами → вміст не читається й не потрапляє в промпт (AC57).
- **EC14** Модель повернула понад 8 / 10 / 8 / 5 елементів або задовгі тексти → обрізання за лімітами (AC64).
- **EC15** Мітка вузла діаграми містить синтаксис mermaid або HTML (`"]`, `<script>`) → символи замінено, діаграма рендериться в strict-режимі (AC66, AC67).
- **EC16** Діаграма не парситься або порожня → «Diagram unavailable» (AC14).
- **EC17** Дуже довгі шляхи й команди → обрізання посередині з tooltip, перенесення команд, copy копіює повний текст (AC23).
- **EC18** Користувач пішов зі сторінки під час генерації → генерація триває, після повернення видно поточний стан (AC31, AC33, AC44).
- **EC19** Репо видалено → тур видалено (AC55).
- **EC20** Буфер обміну недоступний (немає дозволу, не-secure контекст) → toast «Couldn't copy to clipboard» (AC43).
- **EC21** Посилання з hash секції відкрито напряму → прокрутка до секції (AC9).
- **EC22** Перемикання репо на сторінці туру → сторінка туру нового репо (AC3).
- **EC23** Задача First tasks без жодного наявного файлу → задачу відкинуто (AC69).
- **EC24** Тур збережено, але репо не клоноване (seed-репо або клон видалено після генерації) → тур показано, Regenerate disabled з підказкою, прямий POST дає 409 `repo_not_cloned` (AC70, AC47).
- **EC25** Seed запущено двічі → для seed-репо лишається один тур (AC72).
- **EC26** Запуск визнано завислим (або стартував новий), а старий запуск згодом завершився → його результат відкинуто, тур і `job` поточного запуску не змінюються (AC75, AC74).
- **EC27** Мережа чи API тимчасово недоступні під час опитування → показаний стан лишається, опитування триває кожні 2 с, повідомлення «Connection lost — retrying…» зникає після успішного GET (AC77, AC78).
- **EC28** Вхід > 60 000 токенів навіть без файлів з найвищим рангом (величезні маніфести) → прибрано ланцюги, потім дерево; якщо не досить — `failed` без виклику моделі (AC76).
- **EC29** Мінізований маніфест чи файл в один рядок на сотні тисяч символів → обрізано до 20 000 символів (AC56).
- **EC30** Помилка провайдера містить довгий текст, заголовки чи фрагменти промпту → у `job.error` і UI лише фіксоване повідомлення ≤ 200 символів, сирий текст лише в лозі (AC79, AC80).

## Non-functional requirements
- **NFR1** Час генерації: ≤ 120 с від POST до `done` (p95) для репо з ≥ 5 000 проіндексованих файлів на моделі за замовчуванням — перевірка: `[manual]` розробник запускає 5 генерацій на клоні DevDigest і записує час у PR.
- **NFR2** Ліміт входу: вхід моделі ≤ 60 000 токенів cl100k на генерацію — перевірка: `[unit]` тест AC59 на фікстурі з 15 файлами по 200 рядків і README 20 000 символів.
- **NFR3** Вартість: ≤ 2 HTTP-запити до провайдера на одну генерацію, включно з транспортними повторами (AC60), і жодного запиту при відкритті сторінки — перевірка: `[unit]` лічильник HTTP-запитів мок-провайдера, зокрема зі змодельованими 429 / 5xx на обох запитах (AC60), і `[unit]` GET без звернення до провайдера.
- **NFR4** Латентність API: `GET /repos/:id/onboarding` ≤ 300 мс (p95, 10 запитів, збережений тур) — перевірка: `[manual]` розробник запускає запит 10 разів локально й записує p95 у PR.
- **NFR5** a11y (WCAG 2.2 AA):
  - перемикачі карток мають `aria-expanded`;
  - кнопки copy мають назву «Copy command {n}», Open — «Open {path}»;
  - пункти «ON THIS PAGE» досяжні з клавіатури;
  - стан генерації оголошується через `aria-live`, банери помилок мають `role="alert"`;
  - бейдж розміру задачі містить текст, а не лише колір.
  Перевірка: `[unit]` запити за role/name у компонентних тестах і `[manual]` прохід лише клавіатурою перед мержем.
- **NFR6** Стійкість: тур і стан генерації зберігаються лише в Postgres. Після перезапуску сервера GET повертає той самий тур, а `running`, старший за 10 хв, — як `failed` — перевірка: `[it]` запис туру → новий інстанс app на тій самій БД → GET.
- **NFR7** i18n: усі нові рядки UI лежать у наявному файлі-заготовці L05 `client/messages/en/onboarding.json` (namespace `onboarding`; ключі заготовки, чий текст розходиться зі спекою, — зокрема `generate.body` про інші п'ять секцій — замінюються текстом зі спеки), пункт сайдбару — у `shell.json`. Число файлів подано через ICU plural, у компонентах немає вбудованого тексту, у повідомленнях немає `<word>` — перевірка: `[unit]` тести рендерять через next-intl-обгортку з `messages/en`.
- **NFR8** Спостережуваність: кожна невдала генерація пише в серверний лог рівно один рядок з `repoId`, фіксованим повідомленням AC79 (тим самим, що лежить у `job.error`) і сирим текстом помилки (AC80), без ключа API й вмісту промпту — перевірка: `[unit]` тести AC53, AC54 і AC76 з мок-логером.

## Inputs and provenance
| Вхід | Джерело (trusted / user / repo-GitHub / LLM / secrets) | Валідація |
|------|---------|-----------|
| Дерево файлів, README, маніфести, файли з найвищим рангом | repo-GitHub (клон, HEAD) | ліміти AC56, AC59 і AC76 (рядки й ≤ 20 000 символів на файл), склад за `index_status` AC61, виключення секретних файлів AC57, обгортка `<untrusted>` AC58 |
| Ланцюги залежностей, ранг, `files_indexed`, `index_status` | trusted (repo-intel, обчислено сервером з untrusted коду) | лише шляхи з індексу; у промпті — всередині `<untrusted>` |
| Відповідь моделі (summary, діаграма, шляхи, описи, команди, задачі) | LLM | zod-схема структурованої відповіді, перевірка шляхів AC62, джерел команд AC63, ліміти AC64–AC66, AC69 |
| `:id` репо | user | uuid (422), належність воркспейсу (404) |
| `owner`, `name` репо для URL Open | trusted (БД, з GitHub при додаванні репо) | URL-кодування сегментів `path` (AC16) |
| Системний промпт `onboarding.system.md` | trusted | — |
| Seed-тур `acme/payments-api` | trusted (seed-скрипт у репо DevDigest) | zod-схема `OnboardingTour` (AC71); рендериться за тими самими правилами UI (AC67) |
| Ключ провайдера моделі | secrets | лише через `SecretsProvider`; не потрапляє в промпт, лог, БД чи UI |

## Untrusted inputs
- Файли клону (README, маніфести, код, `.env.example`) → prompt → окремі `<untrusted>`-блоки в user-повідомленні з інструкцією в системному повідомленні, що це дані (AC58). Обсяг обмежено лімітами AC56, AC59 і AC76, ≤ 2 HTTP-запитами (AC60) і дедлайном 180 с на генерацію (AC54, AC74) (OWASP LLM10), секретні файли не читаються (AC57, LLM02).
- Помилки провайдера й zod → `job.error` і UI лише як фіксоване повідомлення ≤ 200 символів (AC79); сирий текст — лише в серверному лозі без ключа й промпту (AC80); LLM02, LLM07.
- Шляхи з відповіді моделі → БД і UI (кнопка Open → URL GitHub) → перевірка safe path і наявності в клоні (AC62, AC65, AC69), URL-кодування (AC16); LLM09.
- Команди з відповіді моделі → UI (буфер обміну) → лише з перевіреним джерелом (AC63), без виконання (AC68), з приміткою «review before running» (AC17); LLM05 і LLM06.
- Тексти моделі (summary, description, why, title) → UI → як текст, без HTML і Markdown, крім code-chip-ів і жирного `**…**` у summary (AC12, AC67).
- Діаграма моделі → mermaid у браузері → структура замість сирого mermaid, `id` генерує сервер, мітки обмежено набором символів (AC66), рендер у strict-режимі (AC67).
- Вивід моделі не ініціює жодної дії (запис у репо, коментар, запуск команд): лише збереження туру після перевірок (LLM06).

## Assumptions
- Статус для `llm_not_configured` — 422, як у наявному модулі intent (`server/src/modules/intent/routes.ts:13`). В інтерв'ю (Q11) згадувався 409; суть рішення (код помилки й посилання на Settings) не змінюється.
- Репозиторії DevDigest розміщені на GitHub (`owner/name` з URL при додаванні), тож формат посилання Open `https://github.com/{owner}/{name}/blob/{sha}/{path}` спирається на загальні знання. researcher-ом не перевірено.
- Перевірка шляхів іде по робочому дереву клону, бо на старті генерації воно відповідає HEAD (`commit_sha`), і DevDigest його не змінює. Sync репо під час генерації може дати розбіжність, тож шлях, видалений саме в цей момент, може пройти перевірку.
- Інтервал опитування 2 с, дедлайн генерації 180 с і поріг «завислого» запуску 10 хв (як `EXTRACT_STALE_MS` у conventions) — рішення spec-creator.
- 180 с — wall-clock дедлайн на всю генерацію, а не на один HTTP-запит (ревʼю M1). Зараз LLM-адаптер обгортає кожну спробу `completeStructured` у `withRetry` з таймаутом на спробу (`server/src/adapters/llm/openai.ts:96-110`), `withRetry` за замовчуванням робить 3 повтори (`server/src/platform/resilience.ts:47`), а `maxRetries` за замовчуванням 2 (`openai.ts:90`). Тому за читання «180 с на виклик» найгірший випадок ~24 хв перевищив би поріг 10 хв. Рішення: транспортні повтори рахуються в ліміт ≤ 2 HTTP-запитів (AC60), а не вимикаються.
- Склад входу за `index_status` (ревʼю M4, рішення spec-creator): `partial` отримує файли з найвищим рангом і ланцюги, бо repo-intel повертає їх і для часткового індексу (`server/src/modules/repo-intel/service.ts:639-656`); `degraded`, `failed`, `none` і вимкнений repo-intel — лише дерево, README, маніфести (AC61).
- Порядок обрізання за AC76 (ланцюги → дерево → `failed`) — рішення spec-creator (ревʼю M3): README і маніфести лишаються, бо лише вони дають перевірені джерела команд (AC63).
- Фіксовані тексти `job.error` (AC79) — рішення spec-creator (ревʼю m17).
- Жирний `**…**` у summary (AC12) — рішення користувача: «як на макеті» D1.
- Оновлення стану `job` застарілим запуском блокується за AC75; спосіб, яким сервер відрізняє поточний запуск, вирішує план.
- Заготовки `Onboarding`, `OnboardingSection` і `OnboardingLink` замінюються на `OnboardingTour` (відповідь на Q3). Це урок L05, для якого вони існують.
- У Guided reading path немає кнопки Open, бо її немає на D2.
- Відповідність `kind` → колір (AC13) виведено з D1: client — нейтральний, server.ts і api/public/* — синій, middleware — бурштиновий, redis/postgres — зелений.
- Маршрут `/repos/:repoId/tour` обрано, щоб не плутати сторінку з `/onboarding` («Add repository»; `client/CLAUDE.md` → Gotchas).
- Share link копіює `localhost`-URL: у local-first студії посилання працює лише на тій самій машині або в іншого користувача з тим самим репо в DevDigest.
- Мова туру англійська. Плейсхолдер `{{language}}` промпту отримує `English`.
- Секцію First tasks визначено без макета (відповідь на Q6): 3–5 задач, `title` ≤ 80 символів, 1–2 речення опису, 1–3 файли, розмір `S` або `M`.
- e2e (REC2 прийнято): флоу на seed-турі `acme/payments-api` перевіряє:
  - пункт сайдбару, шапку, навігацію «On this page» і deep link;
  - згортання карток;
  - вміст п'яти секцій;
  - `href` кнопки Open (без переходу на GitHub);
  - toast-и copy і Share link;
  - disabled Regenerate для неклонованого репо (AC1, AC4, AC5, AC7–AC11, AC15–AC18, AC20, AC21, AC42, AC70, AC73).
  Вміст буфера обміну, стани генерації (AC29–AC40) і порожній стан AC28 перевіряються компонентними та server-тестами з мок-провайдером, бо на seed-даних вони недосяжні без LLM. e2e-перевірки запускаються на CI або на macOS ≥ 13 (`e2e/INSIGHTS.md`).
- Seed-тур — trusted дані, написані руками за D1/D2. Його шляхи не перевіряються за AC62, бо seed-репо не має клону. Перевірка AC62 діє лише для туру, згенерованого моделлю.
- Для seed-туру `index_status = full`, тож банер AC24 на seed-даних не показується. Його перевіряє лише компонентний тест.
- Якщо тур є, але клону немає, тур показується, а не ховається за порожнім станом AC28. Збережений тур лишається корисним, а заблокована лише перегенерація (AC70).

## Open questions
—

## Traceability
| US | AC | EC | NFR | Verification |
|----|----|----|-----|--------------|
| US1 | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC24, AC25, AC26, AC27, AC41, AC42, AC43, AC70, AC71 (system), AC72 (system), AC73 | EC5, EC20, EC21, EC22, EC24, EC25 | NFR4, NFR5, NFR7 | AC1 [unit][e2e]; AC2, AC3, AC6 [unit]; AC4, AC5, AC7–AC11 [unit][e2e]; AC24–AC27 [unit]; AC41, AC43 [unit]; AC42 [unit][e2e]; AC70 [unit][e2e]; AC71 [unit][it]; AC72 [it]; AC73 [e2e] (усі e2e — на seed-турі, CI / macOS ≥ 13) |
| US2 | AC28, AC29, AC30, AC31, AC32, AC33, AC34, AC35, AC36, AC37, AC38, AC39, AC40, AC44, AC45, AC46, AC47, AC48, AC49, AC50, AC51, AC52, AC53, AC54, AC55 (system), AC56, AC57 (system), AC58 (system), AC59, AC60, AC61, AC74 (system), AC75, AC76, AC77, AC78, AC79 (system), AC80 (system) | EC5, EC6, EC7, EC8, EC9, EC10, EC11, EC12, EC13, EC18, EC19, EC26, EC27, EC28, EC29, EC30 | NFR1, NFR2, NFR3, NFR6, NFR8 | AC28 [unit]; AC29–AC40 [unit]; AC44 [unit][it]; AC45 [unit]; AC46 [unit][it]; AC47 [unit]; AC48 [unit][it]; AC49 [unit]; AC50 [unit][it]; AC51 [unit]; AC52 [it]; AC53 [unit][it]; AC54 [unit]; AC55 [it]; AC56–AC61 [unit]; AC74 [unit]; AC75 [unit][it]; AC76–AC80 [unit] |
| US3 | AC12, AC13, AC14, AC15, AC16, AC22, AC23, AC62, AC65, AC66, AC67 (system) | EC1, EC2, EC4, EC15, EC16, EC17 | NFR5 | AC12 [unit]; AC13 [unit][manual]; AC14 [unit]; AC15, AC16 [unit][e2e]; AC22, AC23 [unit]; AC62, AC65–AC67 [unit] |
| US4 | AC17, AC18, AC19, AC63, AC64, AC68 | EC3, EC14, EC17, EC20 | NFR5 | AC17, AC18 [unit][e2e]; AC19 [unit]; AC63, AC64, AC68 [unit] |
| US5 | AC20, AC21, AC69 | EC23 | NFR5 | AC20, AC21 [unit][e2e]; AC69 [unit] |
