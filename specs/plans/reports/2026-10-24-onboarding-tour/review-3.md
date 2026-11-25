# Review round 3 ledger — Onboarding Tour (after fix round 2, 4cb97f8)
Sources: plan-verifier delta (BLOCKED_UNVERIFIABLE env-only; AC36 edge flagged) · architecture-reviewer delta (APPROVE, 0 findings) · /code-review high on validate.ts, service.ts, TourView.tsx (reviewed whole files, not just the delta)

## Round 2 rows
G1, G2, G3, G4, G5, G6, G7, G8 — fixed · G9 disputed-accepted · G10, G11 deferred · G12 skipped · E1/E2 env

## New rows
| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| H1 | code-review (AC35, spec :202) | major | `client/.../TourView/TourView.tsx:244` | T12 | regenerate-failed banner lacks "Try again" | accepted-by-user |
| H2 | code-review (AC78, spec :298) | major | `client/.../TourView/TourView.tsx:163` | T12 | connection-lost banner not shown during first generation (early return) | accepted-by-user |
| H3 | code-review (AC25, spec :192) | major | `client/.../TourView/TourView.tsx:87` | T12 | skeleton must be header + ON THIS PAGE + 5 cards, not 3 bars | accepted-by-user |
| H4 | code-review (AC76, spec :293) | major | `server/src/modules/onboarding/input.ts:75` | T6 | drop chains fully, then tree fully (no per-chain / tree prefix search); also fixes F12 perf | accepted-by-user |
| H5 | code-review | major (grounding) | `server/src/modules/onboarding/service.ts:179` | T11 | commit_sha read from git adapter's own dir, files from repo.clonePath; read HEAD from the same clone | accepted-by-user |
| H6 | verifier | decision | `TourView.tsx:174-176` (AC36 :203) | T12 | no clone + failed job + no tour → not-cloned state vs literal AC36 error + Try again | accepted-by-user: keep not-cloned (spec amendment to AC36 needed) |
| H7 | code-review (AC54 :221) | major | `service.ts:155` | T11 | no AbortSignal for in-flight request | disputed-accepted (plan Risks: "Немає справжнього AbortSignal", accepted at gate) |
| H8 | code-review | minor | `service.ts:220` | T11 | 429 retry without backoff/Retry-After | defer (spec sets ≤2 requests, no backoff rule) |
| H9 | code-review | minor | `TourView.tsx:240` | T12 | nested aria-live regions | fix with H1–H3 (owner edits file) |
| H10 | code-review | minor | `validate.ts:137` | T6 | title/command dedupe beyond AC65 merges distinct tasks | defer |
| H11 | code-review | minor | `service.ts:185` fitToBudget perf | T6 | = F12; H4 accepted → stays deferred | deferred |
Escalation trigger: round 2 fixed 4 major, round-2 review found 5 new major (H1–H5) → ask user.

User decision (2026-10-24): Accept and finish — H1–H5 accepted-by-user (listed in PR summary); H6 keep not-cloned, record as AC36 spec amendment.
