# specs/

Специфікації фіч для Spec Driven Development: спека → рев'ю спеки → план →
імплементація.

## Що де лежить

| Місце | Що там |
|---|---|
| `specs/*.md` (цей каталог) | Спеки фіч, які зачіпають **кілька модулів** (наприклад, `server` + `client`). |
| `<module>/specs/*.md` | Спеки, що повністю живуть в одному модулі: `server/`, `client/`, `reviewer-core/`, `mcp/`. |
| `specs/plans/*.md` | Плани імплементації (пише `implementation-planner`), не спеки. |
| `e2e/specs/*.flow.json` | Це e2e-флоу, а не спеки, попри назву теки. |
| `specs/_template.md` | Шаблон спеки — єдине джерело формату. |
| `specs/designs/<YYYY-MM-DD>-<slug>/` | Макети до спеки (`D1.png`, `D2.png`…), збережені з чату `scripts/save-designs.mjs`. Індекс — розділ `## Дизайн` спеки. |

## Формат

- Файл: `YYYY-MM-DD-<slug>.md` (дата створення + назва фічі в kebab-case).
- `Spec ID: SPEC-YYYY-MM-DD-<slug>` — збігається з іменем файлу.
- Розділи — у [`_template.md`](./_template.md): user stories `US1…`,
  екрани й стани, взаємодія модулів, acceptance criteria за EARS українською
  з ID `AC1…` і мітками верифікації `[unit|it|e2e|manual]`, edge cases
  `EC1…`, вимірювані `NFR1…`, входи й довіра, assumptions, open questions,
  traceability-матриця. На `AC#` посилаються плани (`implementation-planner`)
  і перевірка (`plan-verifier`).
- ID не перенумеровуються після approve; видалений пункт → `(removed)`.
- **Дизайни** юзер скидає в чат (скріншот або файл); оркестратор зберігає їх
  у `specs/designs/<YYYY-MM-DD>-<slug>/D<n>.png` командою
  `node scripts/save-designs.mjs <dir>` (бере зображення з транскрипту сесії),
  тож spec-creator, рев'юери, планер і implementer читають самі файли.
  Розділ `## Дизайн` — індекс `D# → файл → екран/стан`; AC посилаються на
  `D#`. Доповнення макетів до draft — нові файли продовжують нумерацію в тій
  самій теці; новий макет для approved-спеки — нова draft зі `Supersedes:` і
  власною текою (у її індексі можна посилатися на файли старої).
- Статуси: `draft` → `approved` → `implemented`; замінена спека отримує
  `superseded by <Spec ID>`, нова — `Supersedes: <посилання>`.
  `approved` і `implemented` ставить людина, і лише коли в Open questions
  немає blocking-питань.

Спеки, створені до цього формату (`conventions.md`, `smart-diff.md` тощо),
лишаються як є.

## Запуск одним викликом

Спеку (`spec-creator` ⇄ `spec-reviewer` → `Status: approved`) і план
(`implementation-planner`) запускають вручну. Далі `/run-plan plan: <path>`
(`.claude/skills/run-plan/`): `scripts/plan-lint.mjs` → **gate** (людина
затверджує план) → хвилі `implementer` на гілці `feature/<slug>` з комітом
на хвилю → фінальне рев'ю (`plan-verifier` + `architecture-reviewer` +
`/code-review`) → цикл виправлень (≤3 кола, з ескалацією) → інсайти,
документація, підготовка PR. Продовжує з `## Progress` плану та `flow.md`.

## Хто пише й перевіряє

```
spec-creator ──(needs-research)──▶ researcher ×N (паралельно)
     │  ◀──(needs-input: питання + REC)──▶ людина
     ▼
draft ──▶ spec-reviewer ──▶ правки (spec-creator, draft:) ──▶ approved
     ──▶ implementation-planner ──▶ implementer …
```

- `spec-creator` — аналізує запит, дизайни й код, за потреби запускає
  `researcher`-ів, ставить питання й пропозиції, потім пише `draft`.
  Guard-хук дозволяє йому писати лише спеки в цьому каталозі та в
  `<module>/specs/`.
- `spec-reviewer` — read-only рев'ю draft: неоднозначність, покриття станів,
  довіра, твердження про код, верифікація, traceability.
- Скіли: `ears-requirements`, `ux-states-review`, `llm-trust-boundaries`.
