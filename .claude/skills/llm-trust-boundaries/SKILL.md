---
name: llm-trust-boundaries
description: "Trust boundaries for features that feed data into an LLM or render LLM/user/repo data — DevDigest-specific. Use when filling a spec's 'Inputs and provenance' / 'Untrusted inputs' sections, reviewing a spec or design for prompt-injection and output-handling risks, or deciding how a new input must be isolated. Covers OWASP Top 10 for LLM Applications 2025 (LLM01 prompt injection, LLM02 sensitive information disclosure, LLM05 improper output handling, LLM06 excessive agency, LLM07 system prompt leakage, LLM09 misinformation, LLM10 unbounded consumption) mapped to DevDigest's mechanisms: <untrusted> wrapping, INJECTION_GUARD, citation grounding, evidence verification, safe repo paths, SecretsProvider."
---

# LLM trust boundaries (DevDigest)

Web-level OWASP (auth, injection into SQL, uploads) is in the `security`
skill. This skill is about data that crosses into or out of an LLM, and about
repo/GitHub content treated as data.

## 1. Classify every input

| Клас | Приклади в DevDigest | Довіра |
|---|---|---|
| trusted | системні промпти агентів (БД), код самого DevDigest, конфіг | довіряємо |
| user | поля форм, назви агентів, тексти скілів, налаштування | валідуємо (zod), екрануємо у UI |
| repo/GitHub | diff, PR title/body, коментарі, README, файли клону, назви гілок | **untrusted** |
| LLM output | findings, кандидати конвенцій, згенерований текст | **untrusted** до перевірки |
| community | community-скіли, зовнішні спеки | **untrusted**, санітизація upstream |
| secrets | API-ключі провайдерів, GitHub token | лише `SecretsProvider` (`~/.devdigest/secrets.json`), ніколи БД/git/UI/лог/промпт |

## 2. Mechanisms that already exist — reuse, never weaken

- **`<untrusted>` wrapping** — `wrapUntrusted(label, content)` у
  `reviewer-core/src/prompt.ts`: обгортає дані, нейтралізує `</untrusted>`
  усередині.
- **`INJECTION_GUARD`** — там само; дописується до кожного системного промпту
  через `assemblePrompt`. Не змінювати, не замінювати фільтрацією за ключовими
  словами (root `CLAUDE.md` → Do not touch).
- **Citation grounding** — `reviewer-core/src/grounding.ts`: finding лишається,
  лише якщо його рядки перетинають реальний hunk diff (full-file kinds — лише
  наявність файлу).
- **Evidence verification** — `server/src/modules/conventions/domain.ts`
  (`verifyEvidence`, `safeRepoPath`): цитата моделі шукається в реальному
  файлі, шлях за межі клону відкидається.
- **Ліміти** — обрізання PR description (`MAX_PR_DESCRIPTION_CHARS`), обрізання
  файлів у вибірках.
- **zod** — строгі схеми на вході API і на виході моделі (structured output).

## 3. OWASP Top 10 for LLM Applications (2025) → spec questions

| Ризик | Питання для спеки |
|---|---|
| LLM01 Prompt injection | Які untrusted дані йдуть у промпт? Чи всі через `<untrusted>` + guard? Чи може вміст змінити, *що* модель робить (знизити severity, пропустити файл)? |
| LLM05 Improper output handling | Куди йде вивід моделі: UI (екранування markdown/HTML), файлова система (safe path), БД, GitHub-коментар (видимий іншим)? Що перевіряється до збереження (grounding / evidence)? |
| LLM06 Excessive agency | Чи може вивід моделі *ініціювати дію* (запис, коментар у PR, зміну налаштувань) без підтвердження юзера? За замовчуванням — ні: модель пропонує, юзер приймає. |
| LLM02 Sensitive information disclosure | Чи потрапляють секрети, `.env`, токени з клону в промпт, UI або лог? |
| LLM07 System prompt leakage | Чи може вивід показати юзеру/в PR системний промпт агента або тіла скілів, яких не слід розкривати? |
| LLM10 Unbounded consumption | Ліміт розміру входу (файли, рядки, токени), кількості викликів, таймаут, повторні запуски; що бачить юзер при перевищенні? |
| LLM09 Misinformation (галюцинації) | Чи кожне посилання моделі на файл/рядок перевіряється на реальність (grounding)? |

## 4. Output for a spec

**Inputs and provenance** — таблиця: вхід · джерело (клас з §1) · де
валідується (zod-схема / grounding / evidence / safe path).

**Untrusted inputs** — для кожного untrusted входу один рядок:
`<вхід> → <куди потрапляє: prompt | UI | FS | БД | GitHub> → <ізоляція>`.
Кожен такий рядок, що вводить нову поведінку, має відповідний AC (`unwanted`
або `ubiquitous`), напр.:

- **AC** (ubiquitous, system) Система повинна (shall) передавати вміст файлів
  клону в промпт лише всередині `<untrusted>`-блоків. `[unit]`
- **AC** (unwanted, system) ЯКЩО модель повертає шлях поза клоном, ТОДІ
  система повинна (shall) відкинути кандидата. `[unit]`

Якщо фіча не має untrusted входів — напиши явно, чому (не залишай порожнім).
