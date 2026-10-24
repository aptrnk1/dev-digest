# Spec: PR Why + Risk Brief
Spec ID: SPEC-2026-10-24-pr-risk-brief
Status: approved
Supersedes: —
Modules: server, client
Design: `specs/designs/2026-10-24-pr-risk-brief/` (D1–D2, індекс у §Дизайн)

## Проблема й користувач
Рев'юер відкриває PR і мусить сам скласти картину: навіщо цей PR, що він
зачіпає, де ризики і з яких рядків почати читати. Факти для цього в DevDigest
уже є, але розкидані: Intent (L03), Blast radius (L04), статистика diff і
Smart Diff-ролі (L03), прикріплені спеки (Project Context), findings рев'ю.
Зараз рев'юер переглядає їх по черзі й зводить у голові; підсумку з
конкретними ризиками (із файлами) і впорядкованим списком «читай спершу ось
це» немає.

PR Brief зводить ці факти в один блок на вкладці Overview. Модель
викликається рівно один раз на генерацію, отримує лише пораховані факти (без
коду diff) і повертає підсумок, ризики з файлами і Review focus. Бриф
кешується в `pr_brief` і генерується заново лише на запит.

## Goals / Non-goals
**Goals**
- Блок PR Brief на Overview: кнопка Generate brief, поки брифу немає; після
  генерації — підсумок, ризики (назва + файл + severity) і Review focus
  (файл:рядок — причина, у порядку читання).
- Один запит structured output до LLM на генерацію (модель — Settings →
  Feature Models → Risk Brief) по фактах: intent, blast radius, статистика
  diff (по файлах, ролі Smart Diff, числові діапазони hunk-ів без коду), опис
  PR, прикріплені спеки, якорі findings.
- Бриф зберігається в `pr_brief` і після перезавантаження сторінки
  показується без повторної генерації; кнопка оновлення генерує його заново.
- Клік по пункту Review focus відкриває вкладку Files changed на цьому файлі.
- Бриф прямо показує, яких вхідних даних бракувало і чи був intent
  застарілим.
- Посилання моделі на файли й рядки перевіряються сервером проти реального PR.

**Non-goals**
- Банер із вердиктом і PR score останнього рев'ю над підсумком, разом із
  показом вартості/токенів генерації (`$0.014 8.2K→1.3K` на D1) — P3.
- Розгортання ризику з поясненням (`explanation` зберігається, але не
  показується; P3) і окремі іконки за `kind` ризику.
- «Prior PRs touching these files» (P3, з L04).
- Будь-які зміни Files changed, крім переходу до файла: перемикач Smart
  order / Original order, заголовок «REVIEWER-ORDERED DIFF», бейдж
  `summary` і рядок «What this does» біля файла на D2 — поза обсягом (D2 —
  лише ціль переходу).
- Підсвітка конкретного рядка у Files changed (лише перехід до файла).
- MCP-тул для брифу.
- Seed-бриф для PR #482 і e2e-перевірка відрендереного брифу.
- Автоматична генерація брифу (при відкритті PR, після рев'ю чи після push).
- Виведення intent під час генерації брифу (це був би другий LLM-виклик).
- Показ стану «генерація триває» після перемикання вкладки чи
  перезавантаження (GET не повертає ознаку генерації).
- Зміни в `INJECTION_GUARD`, grounding gate рев'ю, у Blast radius чи Intent
  (зокрема `IntentCard` лишає власні risk-чипи intent).

## User stories
- **US1** Як рев'юер, я відкриваю PR і на вкладці Overview бачу блок PR Brief
  з кнопкою Generate brief, поки брифу ще немає, щоб знати, що його можна
  отримати.
- **US2** Як рев'юер, я натискаю Generate brief, чекаю й бачу бриф: короткий
  підсумок (що робить PR і навіщо), ризики і Review focus, а поруч блоки
  Intent і Blast radius, щоб швидко зорієнтуватися в PR.
- **US3** Як рев'юер, я бачу кожен ризик брифу з назвою, файлом, якого він
  стосується, і його severity, щоб знати, куди дивитися уважніше.
- **US4** Як рев'юер, я бачу в Review focus список файл:рядок — чому це
  важливо, і клікаю пункт, щоб потрапити на вкладку Files changed до цього
  файла.
- **US5** Як рев'юер, я перезавантажую сторінку й одразу бачу той самий бриф,
  без повторної генерації (і без нових витрат на LLM).
- **US6** Як рев'юер, я натискаю кнопку оновлення й генерую бриф заново
  (наприклад, після нового push), щоб бриф відповідав поточному стану PR.
- **US7** Як рев'юер, я бачу, яких даних бракувало під час генерації (немає
  intent, blast radius, спек чи рев'ю) і чи був intent застарілим, щоб
  розуміти, наскільки бриф повний.

## Дизайн
| D# | Файл | Екран / стан |
|----|------|--------------|
| D1 | `specs/designs/2026-10-24-pr-risk-brief/D1.png` | Вкладка Overview, PR #482, бриф згенеровано: секція «PR BRIEF» (банер із вердиктом/score — non-goal — і текстом підсумку, кнопка оновлення ↻), блоки Intent і Blast radius поруч, «RISK AREAS» (3 ризики з іконкою і файлом; на макеті всередині картки Intent — спека виносить їх в окремий блок, див. AC13), «REVIEW FOCUS — READ THESE FIRST» з лічильником 4 і пунктами `файл:рядок — причина` |
| D2 | `specs/designs/2026-10-24-pr-risk-brief/D2.png` | Вкладка Files changed (групи Smart Diff Core logic / Wiring / Boilerplate, розгорнуті FileCard-и) — лише ціль переходу з Review focus; інші елементи макета — non-goal |

## Екрани й стани
Еталонна сторінка для узгодженості: `client/src/app/repos/[repoId]/pulls/[number]`
(блок Intent на Overview — патерн «кеш → Outdated → повторна генерація»; на
відміну від нього бриф не генерується автоматично при відкритті).

| Екран | ideal | empty | loading | partial | error |
|-------|-------|-------|---------|---------|-------|
| Overview → блок PR Brief (підсумок) | D1: підсумок, кнопка оновлення (AC12, AC25) | немає брифу: текст і кнопка Generate brief (AC10, AC11) | читання кешу: skeleton (AC9); генерація: кнопка disabled «Generating brief…», попередній бриф видимий (AC21, AC22) | бракує вхідних даних → «Generated without: …» (AC20); intent був застарілим → рядок (AC52); бриф застарів → бейдж «Outdated» (AC23) | GET упав → ErrorState з Retry (AC24); генерація впала → повідомлення під кнопкою, попередній бриф лишається (AC26, AC27, AC33, AC50) |
| Overview → блок ризиків брифу «Risks by file» | D1 (як окремий блок): назва, файл, колір severity (AC13, AC14) | 0 ризиків → `noRisks` (AC15) | разом із блоком PR Brief (AC9) | — | разом із блоком PR Brief |
| Overview → Review focus | D1: пункти `файл:рядок — причина`, лічильник (AC16, AC17) | 0 пунктів → `noFocus` (AC18) | разом із блоком PR Brief (AC9) | — | разом із блоком PR Brief |
| Overview → Intent, Blast radius | D1: існуючі блоки Intent і Blast radius поруч (AC19) | стани існуючих карток, без змін | без змін | без змін | без змін |
| Files changed після кліку з Review focus | D2: групу й FileCard розгорнуто, файл у полі зору, фокус на його заголовку (AC29, AC30) | — (пункт пройшов перевірку AC38, тож файл є в PR) | Smart Diff ще вантажиться → перехід по плоскому списку (AC31), після завантаження — повторно в групах (AC49) | — | файла немає в diff → інфо-рядок (AC32) |

## Взаємодія модулів
| Дія | Шлях (client → API → сервіс → БД / LLM / GitHub) | Контракт / ендпоінт | Нове чи є |
|-----|------|------|------|
| Відкрити Overview | хук брифу → `api.ts` → `GET /pulls/:id/brief` → новий модуль brief → читання `pr_brief` + `head_sha` PR | `PrBriefState { brief: PrBrief \| null, stale: boolean }` | нове (таблиця `pr_brief` є, порожня) |
| Generate brief / оновити | мутація → `api.ts` → `POST /pulls/:id/brief` → модуль brief: збір фактів → один `completeStructured` (модель `risk_brief`) → перевірка посилань і ліміти → upsert `pr_brief` | відповідь `PrBrief`; помилки 404, 409 `brief_in_progress`, 422 `llm_not_configured`, 502 `brief_failed` | нове |
| Збір фактів: intent | модуль brief → `container.intent` — **новий read-only метод фасаду Intent**, що повертає збережений intent і ознаку stale без виведення | `PrIntentState` | нове (метод фасаду); дані є |
| Збір фактів: blast | модуль brief → `container.blast.get` | `BlastRadiusResponse` (`summary`, `changed_symbols`, `downstream[].callers`, `degraded`, `degraded_reason`) | є |
| Збір фактів: статистика diff | модуль brief → файли PR (`path`, `additions`, `deletions`, числові `@@`-діапазони з `patch`) + `container.smartDiff` (ролі) | `PrFile`, `SmartDiff` | є |
| Збір фактів: спеки | модуль brief → Project Context (вкладення увімкнених агентів репо, читання з `origin/<base>`, бюджет 8000 токенів) | — | є механізм для одного агента; об'єднання по агентах — нове |
| Збір фактів: findings | модуль brief → рев'ю PR, правило вибору як у Smart Diff (найновіше рев'ю на агента, без dismissed, лише файли PR) | `FindingRecord` | правило є в Smart Diff; використання — нове |
| Клік по пункту Review focus | UI → URL `?tab=diff&file=<path>&line=<n>` → Files changed розгортає групу/файл, прокручує, ставить фокус | — | нове |

Контракт: `PrBrief` змінюється в **обох** копіях
`server/src/vendor/shared/contracts/brief.ts` і
`client/src/vendor/shared/contracts/brief.ts` (поля — AC1); новий
`PrBriefState` — теж в обох копіях. Нова таблиця/міграція не потрібна.

Відповідність запиту коду: Intent живе в окремому модулі
`server/src/modules/intent` (фасад `container.intent`), а не в
`reviews/repository.ts`; роут Blast radius — `GET /pulls/:id/blast-radius`
(фасад `container.blast`), а не `/pulls/:id/blast`.

Вплив на інших споживачів: `PrBrief` реекспортується клієнтом у
`client/src/lib/types.ts:40` (тип має лишитися сумісним за іменем) і
експортується з обох `vendor/shared/index.ts`; MCP — без змін; seed — без
змін; існуючі e2e-флоу Overview / Files changed (Intent, Blast radius, Smart
Diff) мають лишитися зеленими; картка Intent продовжує самостійно виводити
intent при відкритті (окремий виклик, не частина брифу).

## Acceptance criteria (EARS)
- **AC1** (ubiquitous, system) Контракт `PrBrief` в обох копіях `vendor/shared`
  повинен (shall) містити поля: `summary` (string), `intent` (`Intent` або
  null), `intent_stale` (boolean), `blast` (`{ summary: string,
  caller_files: string[], degraded_reason: BlastDegradedReason | null }` або
  null), `risks` (`Risks`), `review_focus` (масив `{ file: string, line:
  integer, reason: string }`), `history` (`PrHistory`, за замовчуванням
  порожній), `missing_inputs` (масив зі значень `intent`, `blast`, `specs`,
  `review_findings`), `head_sha` (string), `generated_at` (ISO-рядок),
  `model` (string), `cost_usd` (number або null). `[unit]`
- **AC2** (event, US5) КОЛИ клієнт викликає `GET /pulls/:id/brief` для PR зі
  збереженим брифом, API повинен (shall) відповісти 200 з `PrBriefState`, де
  `brief` — збережений бриф, без жодного LLM-виклику. `[it]`
- **AC3** (event, US1) КОЛИ клієнт викликає `GET /pulls/:id/brief` для PR без
  збереженого брифу, API повинен (shall) відповісти 200 з `{ brief: null,
  stale: false }`. `[unit]`
- **AC4** (unwanted, system) ЯКЩО PR з `:id` не існує в робочому просторі,
  ТОДІ API повинен (shall) відповісти 404 на `GET` і `POST /pulls/:id/brief`
  без LLM-виклику. `[unit]`
- **AC5** (unwanted, system) ЯКЩО JSON у `pr_brief` для PR не проходить
  схему `PrBrief`, ТОДІ API повинен (shall) відповісти на `GET` як за
  відсутності брифу (`brief: null`). `[unit]`
- **AC6** (event, US2) КОЛИ клієнт викликає `POST /pulls/:id/brief`, система
  повинна (shall) зробити рівно один запит structured output до
  LLM-провайдера (повтор усередині запиту — не більше 1) з моделлю, яку
  повертає налаштування фічі `risk_brief` робочого простору (override або
  дефолт реєстру). `[unit]`
- **AC7** (event, US2) КОЛИ генерація успішна, API повинен (shall) зберегти
  бриф у `pr_brief` (один рядок на PR, перезапис попереднього) з `head_sha`,
  рівним поточному `head_sha` PR, і повернути 200 з тим самим `PrBrief`. `[it]`
- **AC8** (complex, US6) ПОКИ для PR триває генерація брифу, КОЛИ надходить
  ще один `POST /pulls/:id/brief` для того самого PR, API повинен (shall)
  відповісти 409 `brief_in_progress` без другого LLM-виклику. `[unit]`
- **AC9** (state, US5) ПОКИ `GET /pulls/:id/brief` виконується, UI повинен
  (shall) показувати в блоці PR Brief skeleton замість вмісту. `[unit]`
- **AC10** (state, US1) ПОКИ для PR немає брифу, UI повинен (shall)
  показувати в блоці PR Brief текст `brief.unavailable` («Brief not available
  yet.»), підказку `brief.unavailableHint` («Generate a brief from the PR's
  intent, blast radius, diff stats and attached specs.») і кнопку
  `brief.generate` («Generate brief»). `[unit]` `[e2e]` — e2e на seed-PR
  #482 (у `pr_brief` нічого не сідиться); запускається в CI, бо
  agent-browser не стартує на локальному хості macOS 12.
- **AC11** (event, US1) КОЛИ користувач відкриває вкладку Overview, UI
  повинен (shall) лише читати бриф (`GET`) і не викликати `POST
  /pulls/:id/brief` без натискання кнопки. `[unit]`
- **AC12** (event, US2) КОЛИ генерація завершилася успішно, UI повинен
  (shall) показати в блоці PR Brief текст `summary` без перезавантаження
  сторінки. `[unit]`
- **AC13** (ubiquitous, US3) UI повинен (shall) показувати ризики брифу
  окремим блоком під рядком Intent / Blast radius із заголовком
  `brief.block.risks` («Risks by file»), кожен ризик — рядком із `title` і
  першим елементом `file_refs` моноширинним звичайним текстом (не
  посиланням); risk-чипи всередині картки Intent лишаються без змін. `[unit]`
- **AC14** (ubiquitous, US3) UI повинен (shall) показувати біля кожного
  ризику одну й ту саму іконку незалежно від `kind`, кольором за severity
  (`high` — `--crit`, `medium` — `--warn`, `low` — `--text-secondary`), з
  доступною назвою `brief.severity.<high|medium|low>` («High severity» /
  «Medium severity» / «Low severity»). `[unit]`
- **AC15** (state, US3) ПОКИ в брифі 0 ризиків, UI повинен (shall)
  показувати в блоці «Risks by file» текст `brief.noRisks` («No notable risks
  flagged.»). `[unit]`
- **AC16** (ubiquitous, US4) UI повинен (shall) показувати Review focus під
  заголовком `brief.focus.title` («Review focus — read these first») з
  лічильником кількості пунктів і пунктами в порядку з `review_focus`, кожен
  у форматі `<file>:<line> — <reason>`. `[unit]`
- **AC17** (ubiquitous, US4) UI повинен (shall) робити кожен пункт Review
  focus посиланням, яке активується мишею й клавішею Enter. `[unit]`
- **AC18** (state, US4) ПОКИ в брифі 0 пунктів Review focus, UI повинен
  (shall) показувати текст `brief.noFocus` («No specific lines to start
  with.»). `[unit]`
- **AC19** (ubiquitous, US2) UI повинен (shall) показувати на Overview блоки
  в такому порядку: PR Brief (підсумок), рядок Intent + Blast radius, «Risks
  by file», Review focus, Description. `[unit]` — порядок у DOM;
  розміщення Intent і Blast radius поруч (при ширині контенту < 960 px — один
  під одним) `[manual]` — розробник візуально звіряє з D1 на seed-PR #482 при
  ширині вікна 1440 px і 900 px.
- **AC20** (state, US7) ПОКИ `missing_inputs` брифу не порожній, UI повинен
  (shall) показувати під підсумком рядок `brief.missingInputs` («Generated
  without: {list}»), де {list} — назви з
  `brief.input.<intent|blast|specs|review_findings>` («intent», «blast
  radius», «attached specs», «review findings») через кому. `[unit]`
- **AC21** (state, US2) ПОКИ генерація, запущена з цієї сторінки, триває, UI
  повинен (shall) показувати кнопку генерації/оновлення disabled з текстом
  `brief.generating` («Generating brief…»). `[unit]`
- **AC22** (state, US6) ПОКИ триває повторна генерація, UI повинен (shall)
  лишати видимим попередній бриф. `[unit]`
- **AC23** (state, US6) ПОКИ `stale` дорівнює true (`head_sha` брифу ≠
  поточний `head_sha` PR), UI повинен (shall) показувати біля заголовка блоку
  бейдж `brief.stale` («Outdated») з підказкою `brief.staleHint` («The PR
  changed since this brief was generated.»). `[unit]`
- **AC24** (unwanted, US5) ЯКЩО `GET /pulls/:id/brief` повертає помилку, ТОДІ
  UI повинен (shall) показати в блоці ErrorState з заголовком
  `brief.error.title` («Couldn't load the brief») і кнопкою Retry, що
  повторює запит. `[unit]`
- **AC25** (state, US6) ПОКИ для PR є збережений бриф, UI повинен (shall)
  показувати в заголовку блоку кнопку оновлення з доступною назвою
  `brief.refresh` («Regenerate brief»), яка викликає `POST
  /pulls/:id/brief`. `[unit]`
- **AC26** (unwanted, US2) ЯКЩО для провайдера моделі `risk_brief` немає
  ключа, ТОДІ API повинен (shall) відповісти 422 `llm_not_configured`, а UI —
  показати під кнопкою текст `brief.generateError.notConfigured` («No LLM key
  for the Risk Brief model — add one in Settings → Feature Models.»). `[unit]`
- **AC27** (unwanted, US6) ЯКЩО LLM-запит не вклався в таймаут або не
  повернув валідну за схемою відповідь після 1 повтору, ТОДІ API повинен
  (shall) відповісти 502 `brief_failed`, лишивши рядок `pr_brief` без змін.
  `[unit]` `[it]`
- **AC28** (event, US4) КОЛИ користувач активує пункт Review focus, UI
  повинен (shall) перейти на URL поточного PR з параметрами
  `tab=diff&file=<file>&line=<line>`. `[unit]`
- **AC29** (event, US4) КОЛИ Files changed відкривається з параметром
  `file`, що збігається зі шляхом файла в diff, UI повинен (shall) розгорнути
  групу Smart Diff і FileCard цього файла (навіть якщо вони згорнуті за
  замовчуванням, як Boilerplate) і прокрутити сторінку так, щоб заголовок
  FileCard був у видимій області. `[unit]`
- **AC30** (event, US4) КОЛИ Files changed прокрутив до файла з параметра
  `file`, UI повинен (shall) перемістити фокус клавіатури на заголовок цього
  FileCard. `[unit]`
- **AC31** (state, US4) ПОКИ Smart Diff не завантажився або впав і Files
  changed показує плаский список файлів, UI повинен (shall) виконувати
  перехід AC29–AC30 у цьому списку. `[unit]`
- **AC32** (unwanted, US4) ЯКЩО параметр `file` не збігається з жодним файлом
  diff, ТОДІ UI повинен (shall) показати над diff інфо-рядок
  `brief.fileNotInDiff` («{file} is not in the current diff.») і не змінювати
  стан груп і файлів. `[unit]`
- **AC33** (unwanted, US6) ЯКЩО API відповідає 409 `brief_in_progress`, ТОДІ
  UI повинен (shall) показати під кнопкою `brief.generateError.inProgress`
  («A brief is already being generated for this PR.»). `[unit]`
- **AC34** (ubiquitous, system) Система повинна (shall) передавати моделі лише
  факти: intent (`intent`, `in_scope`, `out_of_scope`, `risk_areas`) і
  ознаку його застарілості; blast radius (`summary`, назви змінених
  символів і викликачів, файли-викликачі з рядками, `degraded_reason`); по кожному зміненому файлу — шлях,
  `additions`, `deletions`, роль Smart Diff і числові діапазони нової
  сторони `+c,d` з `@@`-заголовків; title і опис PR; прикріплені спеки;
  якорі findings (файл, `start_line`, severity, title). `[unit]`
- **AC35** (ubiquitous, system) Система повинна (shall) не включати в промпт
  жодного рядка вмісту `patch` — ні рядків коду diff, ні тексту після
  другого `@@` у заголовку hunk-а. `[unit]`
- **AC36** (unwanted, US7) ЯКЩО для PR немає збереженого intent, ТОДІ система
  повинна (shall) згенерувати бриф з `intent: null`, додати `intent` у
  `missing_inputs` і не виводити intent (жодного додаткового LLM-виклику).
  `[unit]`
- **AC37** (unwanted, US7) ЯКЩО blast radius повертає `degraded: true` і
  водночас 0 `changed_symbols` і 0 викликачів, ТОДІ система повинна (shall)
  згенерувати бриф з `blast: null` і додати `blast` у `missing_inputs`.
  `[unit]`
- **AC38** (unwanted, US4) ЯКЩО пункт Review focus посилається на файл, якого
  немає серед змінених файлів PR, або на рядок поза діапазонами hunk-ів нової
  сторони цього файла, ТОДІ система повинна (shall) відкинути цей пункт перед
  збереженням. `[unit]`
- **AC39** (unwanted, US7) ЯКЩО жоден увімкнений агент не має вкладень
  Project Context для репо або жоден документ не прочитано (відсутній, понад
  бюджет, немає клону чи base-гілки), ТОДІ система повинна (shall) додати
  `specs` у `missing_inputs`. `[unit]`
- **AC40** (unwanted, US7) ЯКЩО для PR немає жодного рев'ю, ТОДІ система
  повинна (shall) додати `review_findings` у `missing_inputs`; рев'ю з 0
  findings вважається наявним (порожній список, без запису в
  `missing_inputs`). `[unit]`
- **AC41** (ubiquitous, US7) Система повинна (shall) передавати в промпт
  список `missing_inputs` і ознаку `intent_stale` з інструкцією назвати
  відсутні й застарілі дані в `summary`. `[unit]`
- **AC42** (ubiquitous, system) Система повинна (shall) брати як спеки
  об'єднання вкладень (власних і через увімкнені скіли) усіх увімкнених
  агентів робочого простору для цього репо, без дублікатів шляхів (лишається
  перше входження), по агентах за `created_at`, усередині агента — у тому
  самому порядку, що й для рев'ю (спершу власні, потім через скіли); читати їх з `origin/<base>` і включати не
  більше 8000 токенів спек (той самий бюджет і правила пропуску, що й для
  рев'ю). `[unit]` `[it]`
- **AC43** (unwanted, US3) ЯКЩО посилання з `file_refs` ризику (формат
  `path`, `path:N` або `path:N-M`) вказує на шлях, якого немає ні серед
  змінених файлів PR, ні серед файлів-викликачів blast radius, ТОДІ система
  повинна (shall) прибрати це посилання. `[unit]`
- **AC44** (unwanted, US3) ЯКЩО після AC43 у ризику не лишилося жодного
  посилання, ТОДІ система повинна (shall) відкинути ризик. `[unit]`
- **AC45** (ubiquitous, system) Система повинна (shall) після відкидання за
  AC38, AC43 і AC44 зберігати перші 6 ризиків і перші 6 пунктів Review focus
  у порядку моделі та обрізати по code point: `summary` до 600, `reason` до
  200, `title` ризику до 120, `explanation` до 500, `kind` до 40 символів.
  `[unit]`
- **AC46** (ubiquitous, system) UI повинен (shall) рендерити `summary`,
  `title`, `reason` і шляхи як звичайний текст (без інтерпретації HTML чи
  Markdown). `[unit]`
- **AC47** (ubiquitous, system) Система повинна (shall) передавати в промпт
  кожне значення, похідне від repo/GitHub чи LLM — title і опис PR, вміст
  спек, тексти intent, `summary` і `degraded_reason` blast radius, назви
  символів і шляхи файлів, ролі Smart Diff, title findings — лише всередині
  `<untrusted>`-блоків і повторювати після них нагадування, що вміст блоків —
  дані, а не інструкції. `[unit]`
- **AC48** (unwanted, system) ЯКЩО відповідь моделі містить поле поза схемою
  або severity поза `high|medium|low`, ТОДІ система повинна (shall) вважати
  відповідь невалідною (повтор, далі AC27). `[unit]`
- **AC49** (event, US4) КОЛИ Smart Diff завантажується вже після переходу з
  параметром `file` і Files changed перемикається з плаского списку на
  групи, UI повинен (shall) один раз повторно виконати AC29–AC30 у
  згрупованому вигляді. `[unit]`
- **AC50** (unwanted, US6) ЯКЩО `POST /pulls/:id/brief` завершується будь-якою
  помилкою, крім 409 і 422 (502, інший статус, мережевий збій), ТОДІ UI
  повинен (shall) показати під кнопкою `brief.generateError.generic` («Could
  not generate the brief. Try again.») і лишити видимим попередній бриф,
  якщо він був. `[unit]`
- **AC51** (unwanted, US7) ЯКЩО збережений intent застарів (`stale: true` за
  станом Intent), ТОДІ система повинна (shall) використати його в фактах і
  зберегти бриф з `intent_stale: true` (інакше `false`). `[unit]`
- **AC52** (state, US7) ПОКИ `intent_stale` брифу дорівнює true, UI повинен
  (shall) показувати під підсумком рядок `brief.intentStale` («Generated from
  an outdated intent — re-derive the intent and regenerate the brief.»);
  якщо водночас показано рядок AC20, рядок AC20 іде першим, цей — одразу під
  ним. `[unit]`
- **AC53** (unwanted, US2) ЯКЩО blast radius має `degraded: true` і ≥1
  changed symbol або ≥1 викликача, ТОДІ система повинна (shall) зберегти
  `blast` у брифі з `degraded_reason` і не додавати `blast` у
  `missing_inputs`. `[unit]`
- **AC54** (ubiquitous, system) Система повинна (shall) брати якорі findings
  за правилом Smart Diff (найновіше рев'ю кожного агента, без dismissed, лише
  на файлах PR), рядок якоря — `start_line`, і передавати не більше 30 із
  них, відсортованих за severity (від найвищої), далі шляхом файла, далі
  рядком. `[unit]`
- **AC55** (ubiquitous, US2) Система повинна (shall) вважати blast radius з
  `degraded: false` наявним навіть за 0 changed symbols і 0 викликачів:
  зберігати `blast` (порожні `caller_files`) і не додавати `blast` у
  `missing_inputs`. `[unit]`

## Edge cases
- **EC1** У PR немає збереженого intent → бриф генерується без intent, рядок
  «Generated without: intent» (AC36, AC20).
- **EC2** Repo-intel вимкнено / індекс не готовий і даних blast немає → бриф
  без blast, `blast` у `missing_inputs` (AC37); degraded із частковими даними
  → blast передається з причиною (AC53); не degraded і 0 викликачів →
  наявний, але порожній blast (AC55).
- **EC3** Немає вкладених спек або їх не вдалося прочитати → `specs` у
  `missing_inputs` (AC39).
- **EC4** PR ще не рев'ювили → `review_findings` у `missing_inputs`; рев'ю з
  0 findings → не missing (AC40).
- **EC5** Модель повертає файл/рядок, якого немає в PR → пункт/посилання
  відкидається (AC38, AC43, AC44).
- **EC6** Усі ризики/пункти відкинуто → порожні стани `noRisks` / `noFocus`
  (AC15, AC18).
- **EC7** Подвійний клік або дві вкладки генерують одночасно → 409 і
  повідомлення (AC8, AC33).
- **EC8** Новий push після генерації → бейдж Outdated, без авто-генерації
  (AC23, AC25).
- **EC9** Перегенерація впала → попередній бриф лишається в БД і на екрані
  (AC27, AC50, AC22).
- **EC10** Немає ключа провайдера → 422 і текст про Settings (AC26).
- **EC11** Файл із Review focus у згорнутій групі Boilerplate або в
  згорнутому FileCard → розгортається (AC29).
- **EC12** Перехід на Files changed за `file`, якого вже немає в diff (PR
  змінився) → інфо-рядок (AC32).
- **EC13** Пошкоджений або старий JSON у `pr_brief` → як «брифу немає»
  (AC5).
- **EC14** Довгий текст від моделі або емодзі на межі обрізання → ліміти по
  code point (AC45).
- **EC15** Великий PR (> 100 файлів) → у промпт іде не більше 100 файлів і
  20 hunk-діапазонів на файл (NFR3).
- **EC16** Перезапуск сервера посеред генерації → рядок `pr_brief` не
  змінено, клієнт отримує мережеву помилку й показує generic-текст (AC50);
  блокування AC8 зникає разом із процесом (NFR5).
- **EC17** Intent застарів (PR змінився після виведення intent) → бриф
  використовує його й показує рядок про застарілий intent (AC51, AC52).
- **EC18** Generate brief натиснуто, поки картка Intent ще виводить intent
  уперше → якщо на момент збору фактів збереженого intent немає, бриф
  фіксує `intent` у `missing_inputs` (AC36); якщо є лише застарілий intent —
  використовує його з `intent_stale: true` (AC51); юзер може оновити бриф
  після появи intent (AC25).
- **EC19** Юзер перемикає вкладку або перезавантажує сторінку під час
  генерації → після повернення кнопка знову активна (GET не знає про
  генерацію); повторне натискання до завершення отримує 409 і текст AC33;
  після завершення GET повертає новий бриф (AC8, AC33, AC2).
- **EC20** Smart Diff довантажився вже після переходу → повторне
  розгортання/прокрутка в групах (AC49).

## Non-functional requirements
- **NFR1** Латентність GET: `GET /pulls/:id/brief` ≤ 300 мс p95 на seed-даних
  (без LLM) — перевірка: `[it]`-тест вимірює 20 запитів до PR #482 із
  збереженим брифом.
- **NFR2** Час генерації: кожна спроба LLM-запиту має таймаут 45 с, не
  більше 1 повтору (≤ 90 с на LLM разом); клієнт не обриває запит раніше
  ніж через 100 с — перевірка: `[unit]` із мок-провайдером, що перевищує
  таймаут, і перевірка налаштувань клієнтського запиту.
- **NFR3** Ліміти входу: у промпт ідуть ≤ 100 змінених файлів, ≤ 20
  hunk-діапазонів на файл, ≤ 30 findings, опис PR ≤ 4000 символів, спеки ≤
  8000 токенів; увесь промпт ≤ 20 000 токенів — перевірка: `[unit]` з
  фікстурою на 300 файлів і 100 findings, промпт рахується токенайзером.
- **NFR4** Вартість: рівно 1 запит structured output на `POST` (повтор
  усередині — ≤ 1); 0 LLM-викликів на `GET` і при відкритті Overview —
  перевірка: `[unit]` лічильник викликів мок-провайдера (AC6, AC11).
- **NFR5** Стійкість: збій чи перезапуск під час генерації не змінює і не
  видаляє збережений бриф — перевірка: `[it]` з провайдером, що кидає
  помилку (AC27).
- **NFR6** a11y (WCAG 2.2 AA): severity передається не лише кольором (AC14);
  пункти Review focus і кнопки доступні з клавіатури (AC17, AC25); фокус
  переходить на файл (AC30) — перевірка: `[unit]` (ролі, доступні назви) +
  `[manual]` розробник проходить флоу лише клавіатурою.
- **NFR7** i18n: усі нові рядки — у `client/messages/en/brief.json` (ключі з
  AC10–AC52), без `<word>` у значеннях, плейсхолдери у форматі ICU `{name}` —
  перевірка: `[unit]` тест рендерить компоненти з next-intl і не бачить сирих
  ключів.

## Inputs and provenance
| Вхід | Джерело (trusted / user / repo-GitHub / LLM / secrets) | Валідація |
|------|---------|-----------|
| `:id` PR | user (URL) | zod uuid у params (422), перевірка робочого простору (404) |
| Title і опис PR | repo-GitHub | обрізання опису до 4000 символів, `<untrusted>` |
| Шляхи файлів, additions/deletions, числові `@@`-діапазони | repo-GitHub | лише числа й шляхи, ліміти NFR3, `<untrusted>` |
| Ролі Smart Diff | trusted-обчислення над repo-шляхами | `SmartDiffRole` enum, `<untrusted>` |
| Вміст спек Project Context | repo-GitHub (файли клону з `origin/<base>`) | правила читання Project Context (розмір, бюджет 8000 токенів), `<untrusted>` |
| Збережений intent | LLM output (L03), похідний від repo-даних | zod `Intent`, `<untrusted>` |
| Blast summary, символи, викликачі, `degraded_reason` | trusted-обчислення над repo-даними (індекс) | zod `BlastRadiusResponse`, `<untrusted>` |
| Findings (title, файл, рядок, severity) | LLM output рев'ю (пройшли grounding рев'ю) | zod, правило вибору AC54, `<untrusted>` |
| Модель для `risk_brief` | user (Settings) | zod `FeatureModelChoice`, дефолт реєстру |
| API-ключ провайдера | secrets | лише `SecretsProvider` (через контейнер), не в промпт/БД/лог/UI |
| Відповідь моделі (summary, risks, review_focus) | LLM output | zod-схема structured output (AC48), перевірка посилань (AC38, AC43, AC44), ліміти (AC45) |
| Параметри `file`, `line` в URL Files changed | user (URL) | порівнюються лише з наявними шляхами diff; невідомий → AC32 |

## Untrusted inputs
- Усі значення з repo/GitHub/LLM (title і опис PR, спеки, intent, blast
  summary і `degraded_reason`, назви символів, шляхи, ролі, title findings) →
  prompt → лише в `<untrusted>`-блоках + нагадування після даних (AC47); код
  diff і текст заголовків hunk-ів у промпт не йдуть (AC35).
- Вивід моделі → БД (`pr_brief`) → лише після zod-схеми, перевірки посилань
  на реальні файли/hunk-и і лімітів (AC38, AC43–AC45, AC48).
- Вивід моделі → UI → рендер як звичайний текст (AC46); file refs ризиків —
  не посилання (AC13); дій (коментар у GitHub, зміна налаштувань) бриф не
  ініціює.
- Параметр `file` з URL → UI → лише порівняння з наявними шляхами diff, не
  використовується як HTML чи запит (AC32).
- Секрети не потрапляють у промпт: модель не бачить коду diff (AC35); ключ
  провайдера лише через `SecretsProvider`.

## Assumptions
- `blast` у брифі — знімок (`summary`, файли-викликачі, `degraded_reason`);
  сам блок Blast radius на Overview і далі читає `GET
  /pulls/:id/blast-radius` наживо.
- `stale` брифу рахується як `brief.head_sha ≠ head_sha PR`; інших ознак
  застарілості (зміна спек, нове рев'ю) немає.
- Блокування AC8 — у пам'яті процесу сервера на PR; при кількох інстансах
  сервера не діє (DevDigest — local-first, один процес).
- `POST /pulls/:id/brief` завжди генерує заново (кеш-хіт за хешем входу, як
  в Intent, не робиться): генерація лише на явну дію користувача.
- Існуючі (зараз ніде не використані) ключі `brief.unavailable`,
  `brief.unavailableHint`, `brief.noRisks`, `brief.block.risks` використовуються;
  значення `unavailableHint` змінюється на текст з AC10, `block.risks` — на
  «Risks by file», щоб не збігатися з «Risk areas» картки Intent
  (`brief.intent.risks`).
- Відхилення від D1: ризики брифу — окремий блок під рядком Intent / Blast
  radius, а не всередині картки Intent (AC13, AC19).
- Таймаут 45 с і ліміти NFR3 обрано за аналогією з Intent (20 с, 1 повтор,
  опис 4000, 100 шляхів) з поправкою на більшу модель (`gpt-4.1` за
  замовчуванням).
- Колір low severity — нейтральний `--text-secondary` (на D1 колір low не
  видно).
- Перехід використовує ту саму заміну URL (`router.replace`), що й
  перемикання вкладок на сторінці PR.

## Open questions
—

## Traceability
| US | AC | EC | NFR | Verification |
|----|----|----|-----|--------------|
| US1 | AC3, AC4, AC10, AC11 | — | NFR4 | AC3 [unit], AC4 [unit], AC10 [unit][e2e], AC11 [unit] |
| US2 | AC1, AC6, AC7, AC12, AC19, AC21, AC26, AC34, AC35, AC42, AC47, AC48, AC53, AC54, AC55 | EC2, EC10, EC15 | NFR2, NFR3, NFR4 | AC1 [unit], AC6 [unit], AC7 [it], AC12 [unit], AC19 [unit][manual], AC21 [unit], AC26 [unit], AC34 [unit], AC35 [unit], AC42 [unit][it], AC47 [unit], AC48 [unit], AC53 [unit], AC54 [unit], AC55 [unit] |
| US3 | AC13, AC14, AC15, AC43, AC44, AC45, AC46 | EC5, EC6, EC14 | NFR6 | AC13 [unit], AC14 [unit], AC15 [unit], AC43 [unit], AC44 [unit], AC45 [unit], AC46 [unit] |
| US4 | AC16, AC17, AC18, AC28, AC29, AC30, AC31, AC32, AC38, AC49 | EC5, EC6, EC11, EC12, EC20 | NFR6, NFR7 | AC16 [unit], AC17 [unit], AC18 [unit], AC28 [unit], AC29 [unit], AC30 [unit], AC31 [unit], AC32 [unit], AC38 [unit], AC49 [unit] |
| US5 | AC2, AC5, AC9, AC24 | EC13 | NFR1 | AC2 [it], AC5 [unit], AC9 [unit], AC24 [unit] |
| US6 | AC8, AC22, AC23, AC25, AC27, AC33, AC50 | EC7, EC8, EC9, EC16, EC19 | NFR5 | AC8 [unit], AC22 [unit], AC23 [unit], AC25 [unit], AC27 [unit][it], AC33 [unit], AC50 [unit] |
| US7 | AC20, AC36, AC37, AC39, AC40, AC41, AC51, AC52 | EC1, EC2, EC3, EC4, EC17, EC18 | — | AC20 [unit], AC36 [unit], AC37 [unit], AC39 [unit], AC40 [unit], AC41 [unit], AC51 [unit], AC52 [unit] |
