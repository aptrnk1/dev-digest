---
name: ears-requirements
description: "Writing and reviewing acceptance criteria in EARS (Easy Approach to Requirements Syntax), in Ukrainian, for DevDigest specs. Use when writing a spec's Acceptance criteria / NFRs, reviewing requirements for ambiguity or testability, assigning verification hints (unit / it / e2e / manual) or building a traceability matrix (US → AC → verification). Covers the 5 EARS patterns and their combinations, ISO/IEC/IEEE 29148 quality attributes, a list of weak words, and good/bad examples on DevDigest features."
---

# EARS requirements for DevDigest specs

A requirement is good when two engineers who read it independently would build
the same thing, and a tester can say pass/fail without asking anyone.

## 1. Patterns

| Тип | Шаблон | Коли |
|---|---|---|
| `ubiquitous` | Система повинна (shall) <відповідь>. | діє завжди, без тригера |
| `event` | КОЛИ <тригер>, система повинна (shall) <відповідь>. | реакція на одну подію |
| `state` | ПОКИ <стан>, система повинна (shall) <відповідь>. | поведінка протягом стану |
| `unwanted` | ЯКЩО <небажана умова>, ТОДІ система повинна (shall) <відповідь>. | помилки, збої, зловживання |
| `optional` | ДЕ <опцію ввімкнено / є фіча>, система повинна (shall) <відповідь>. | налаштування, фіча-прапорці |

**Комбінації** (тип = `complex`) — порядок ключів фіксований:
`ДЕ … ПОКИ … КОЛИ … система повинна (shall) …`.
Приклад: «ПОКИ триває extraction, КОЛИ юзер натискає Re-scan, API повинен
(shall) відповісти 409 `extract_in_progress`.»

**Суб'єкт.** «Система» можна звузити до того, кого видно ззовні:
`UI`, `API`, `MCP-сервер`, `reviewer-core`. Не можна — клас, файл, функцію.

## 2. Quality attributes (ISO/IEC/IEEE 29148)

Кожен AC має бути:
- **singular** — одна поведінка. «… і показати toast, і записати лог» → два AC;
- **unambiguous** — одне прочитання (див. слабкі слова нижче);
- **verifiable** — є спостережуваний результат і спосіб перевірки;
- **feasible** — не суперечить `CLAUDE.md` (do-not-touch, секрети, міграції);
- **necessary** — прибери AC, і щось важливе стане неперевіреним;
- **implementation-free** — описує поведінку, а не код;
- **consistent** — не суперечить іншим AC/NFR (перевір пари з однаковим тригером).

## 3. Weak words → replace

| Слабке | Чим замінити |
|---|---|
| швидко, миттєво, без затримок | `≤ N мс/с` на якому обсязі (p95) |
| зручно, інтуїтивно, красиво | конкретна дія/стан: «фокус переходить на …», «кнопка disabled з підказкою …» |
| коректно, правильно, належним чином | який саме результат: статус, текст, дані |
| за потреби, якщо можливо, бажано | умова `ДЕ`/`ЯКЩО` або перенести в Open questions |
| тощо, і т.д., наприклад, і/або | повний перелік |
| підтримувати X | що саме юзер може зробити з X |
| великий, багато, довгий | число: `> 500 файлів`, `> 200 символів` |
| обробити помилку | `unwanted`-AC: що бачить юзер, що лишається в БД |
| має бути безпечно | конкретна ізоляція (див. `llm-trust-boundaries`) |

## 4. Verification hints

Кожен AC отримує одну або кілька міток — як його перевірить `test-writer`
(лейни з `TESTING.md`):

- `[unit]` — чиста логіка, server-unit через `app.inject` з mocks, client
  component test, reviewer-core engine test;
- `[it]` — потрібен реальний Postgres (`*.it.test.ts`): транзакції, міграції,
  конкурентність, 409 через стан БД;
- `[e2e]` — видимий у браузері сценарій на seed-даних; **ніколи** не перевіряє
  вивід LLM (e2e детерміновані, без LLM);
- `[manual]` — лише якщо автоматизувати неможливо (візуал, реальний LLM);
  вкажи, хто і як перевіряє.

Поведінка, що залежить від відповіді LLM, перевіряється `[unit]`/`[it]` з
мок-провайдером, а не `[e2e]`.

## 5. NFR

Формат: `**NFR<n>** <атрибут>: <вимога з числом> — перевірка: <як>`.
Атрибути для DevDigest: латентність UI/API, час фонової задачі, ліміти
(розмір diff, кількість файлів, токени), вартість LLM-виклику, a11y (WCAG 2.2
AA), i18n (усі рядки в `messages/en/*.json`), стійкість (що при перезапуску
сервера посеред задачі), спостережуваність (що логуються помилки).

NFR без числа або без способу перевірки — це побажання; переформулюй або в
Open questions.

## 6. Traceability

Матриця в кінці спеки:

| US | AC | Edge cases | Verification |
|---|---|---|---|
| US1 | AC1, AC2 | EC1 | AC1 [unit], AC2 [e2e] |

Правила: кожна US має ≥1 AC; кожен AC посилається на US (або позначений
`(system)` для наскрізних вимог — безпека, NFR-похідні); кожен Edge case →
AC або Open question; кожен AC має verification-мітку.

## 7. Examples

Див. `examples.md`.

## 8. Review checklist (for a spec reviewer)

- [ ] Кожен AC: ID, тип, ключові слова типу, одна поведінка, суб'єкт ззовні.
- [ ] Жодного слабкого слова з §3.
- [ ] Для кожного `event` є відповідний `unwanted` (що буде, коли тригер
      провалюється), або явне пояснення, чому не потрібен.
- [ ] Немає двох AC з однаковим тригером і різною відповіддю.
- [ ] Числа узгоджені між AC, NFR і Edge cases.
- [ ] Traceability повна (§6).
