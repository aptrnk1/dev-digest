---
name: ux-states-review
description: "Reviewing UI designs and feature requests for DevDigest specs — finding undrawn states, missing interactions, accessibility gaps and UX improvements, and turning them into a Screens × states matrix and acceptance criteria. Use when a spec has a UI part, when analysing a mockup/screenshot, or when reviewing a spec's UI coverage. Covers the UI-states stack (ideal/empty/loading/partial/error), interaction gaps, Nielsen's 10 heuristics, WCAG 2.2 AA essentials and DevDigest UI conventions (vendor/ui, nav, messages/en)."
---

# UX states review for DevDigest specs

A mockup usually shows one state of one screen with ideal data. The spec has to
cover the rest. Work screen by screen; every gap becomes a question, a proposal
or an AC.

## 1. Screens × states matrix

For every screen / panel / modal in the feature, fill:

| Екран | ideal | empty | loading | partial | error | AC |
|---|---|---|---|---|---|---|

- **ideal** — що на макеті; звідки береться кожне значення (ендпоінт/контракт).
- **empty** — перший запуск, нічого не знайдено, фільтр нічого не дав; є
  CTA, що робити далі.
- **loading** — перше завантаження (skeleton) vs фонове оновлення (дані
  лишаються видимими); довгі операції — прогрес і можливість піти зі сторінки.
- **partial** — частина даних є (LLM повернув частину, один із запитів упав,
  пагінація, обрізаний diff).
- **error** — API недоступний, 4xx з кодом (`409 …`), 5xx, LLM timeout/відмова,
  GitHub rate limit, немає API-ключа (Settings), репо не проіндексовано.

Клітинка без відповіді → Open question або питання в інтерв'ю.

## 2. Edge data

- дуже довгі назви / шляхи / тексти (обрізання + tooltip/повний вигляд);
- 0, 1, багато (> 100) елементів; пагінація або віртуалізація;
- спецсимволи, emoji, RTL, markdown/HTML у даних (екранування!);
- застарілі дані (інша вкладка змінила), видалений об'єкт, на який є посилання;
- різні репо / workspace; перемикання репо на сторінці.

## 3. Interaction gaps

- скасування довгої операції; що при уході зі сторінки посеред неї;
- підтвердження деструктивних дій або Undo (DevDigest частіше використовує Undo);
- подвійний клік / повторний сабміт (кнопка disabled, ідемпотентність);
- disabled-стан завжди з причиною (tooltip);
- успіх: що змінюється на екрані, toast, куди переходить фокус;
- deep link: чи стан (фільтр, вкладка, вибраний елемент) живе в URL;
- клавіатура: шорткати (`g c`-стиль у nav), Esc закриває модалку, Enter сабмітить.

## 4. Nielsen's 10 heuristics (short)

1. Видимість стану системи. 2. Відповідність реальному світу (терміни юзера).
3. Контроль і свобода (Undo, Cancel). 4. Узгодженість зі стандартами (як
інші сторінки DevDigest). 5. Запобігання помилкам. 6. Розпізнавання замість
запам'ятовування. 7. Гнучкість (шорткати, bulk-дії). 8. Мінімалізм.
9. Зрозумілі повідомлення про помилки (що сталося + що робити). 10. Довідка
в контексті.

Використовуй як лінзу для UX-пропозицій (REC), не як чекліст у спеці.

## 5. Accessibility — WCAG 2.2 AA essentials

- кожен інтерактивний елемент досяжний з клавіатури, видимий фокус;
- модалка: focus trap, повернення фокусу, Esc;
- контраст тексту ≥ 4.5:1 (великий ≥ 3:1); стан не передається лише кольором
  (бейджі severity/status мають текст);
- поля мають label; помилки валідації пов'язані з полем;
- динамічні оновлення (прогрес, toast) — `aria-live`;
- target size ≥ 24×24 px.

Ці вимоги йдуть у спеку як NFR (a11y), а особливі випадки — як AC.

## 6. DevDigest conventions (check before proposing new UI)

- Віджети: `client/src/vendor/ui` (README там) — `kit`, `primitives`, `shell`,
  `charts`, `command-palette`, `LiveLogStream`. Спершу переюзати, потім нове.
  Порожні «future lesson» віджети — не мертвий код.
- Навігація: `client/src/vendor/ui/nav.ts` (секції sidebar, шорткати).
- Рядки UI: `client/messages/en/<area>.json` — жодного хардкоду; новий текст
  у спеці = новий ключ.
- Дані: TanStack Query; фонові задачі — polling статусу (як conventions
  extraction: 202 → poll → done/failed).
- Подивись найближчу схожу сторінку в `client/src/app/**` і назви її в спеці
  як еталон узгодженості.

## 7. Output

- Матриця §1 → розділ «Екрани й стани» спеки.
- Кожна заповнена клітинка не-ideal → AC (`state` для loading, `unwanted` для
  error, `event` для взаємодій).
- Кожна знайдена вада/покращення → питання або REC з однорядковим «чому».
