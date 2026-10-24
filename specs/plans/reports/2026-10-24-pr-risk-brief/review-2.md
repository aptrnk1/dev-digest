# Review round 2 — PR Risk Brief (delta af6862b..8915ccb)

Sources: architecture-reviewer (APPROVE, 0 new), plan-verifier (BLOCKED_UNVERIFIABLE — 59 DONE, env only), /code-review high (10 unverified candidates).

## Carried from review-1
F1–F7 fixed (8915ccb) · F8–F11 deferred · F12 skipped · F13–F14 accepted · F15–F17 env.

## New
| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| N1 | code-review | major | `client/…/BriefCard/BriefCard.tsx:27` | T7 | fix — inProgress alert persists after poll picks up new brief → generate.reset() | fixed |
| N2 | code-review | minor | `server/src/modules/brief/service.ts:120` | T10 | defer — provider throws on schema-invalid output before cost is known; needs adapter change (outside Owns). Comment "billed even if invalid" misleading | deferred |
| N3 | code-review | minor (design) | `client/…/BriefCard/BriefCard.tsx:21` | — | defer / plan change — server-reported `generating` in PrBriefState would replace generated_at polling (contract change) | deferred |
| N4 | code-review | minor | `server/src/modules/brief/service.ts:107` | T10 | skip — retry on any error except llm_not_configured is the plan's decision (D-e, Constraints) | skipped |
| N5 | code-review | minor | `server/src/modules/brief/prompt.ts:127` | T6 | defer — trimBlast all-or-nothing, no "truncated" marker | deferred |
| N6 | code-review | minor | `server/src/modules/brief/facts.ts:146` | T6 | skip — contradicts F4; spec: validate "among changed files" (verifier confirmed) | skipped |
| N7 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:38` | T7 | fix (owner edits) — poll trigger by status vs message by code | fixed |
| N8 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:21` | T7 | fix (owner edits) — reset poll state on prId change | fixed |
| N9 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:92` | T7 | fix (owner edits) — button idle while polling | fixed |
| N10 | code-review | nit | `server/src/modules/brief/prompt.ts:143` | T6 | skip — double render / redundant parse | skipped |
