# Review round 2 — Onboarding Tour
Sources: plan-verifier delta (verify-plan-2.md, BLOCKED_UNVERIFIABLE env-only) · architecture-reviewer delta (APPROVE, info only) · /code-review high on fix delta

## Round 1 rows
| id | status |
|---|---|
| F1 AC52 timestamps | fixed |
| F2 AC56 lists | fixed |
| F3 AC66 whitelist | fixed |
| F4 symlink secret read | fixed |
| F5 path outside <untrusted> | fixed |
| F6 classify status vs timeout | fixed |
| F7 tour page repos loading/error | fixed |
| F8 dedupe after truncation | fixed |
| F9 bounded read | fixed |
| F10 listTree early stop | disputed-accepted (spec :226 global sort) |
| F11 migration default | deferred |
| F12 fitToBudget perf | deferred |
| F13 container duplication | deferred |
| F14 arch info | skipped |
| E1 AC73 e2e / E2 AC13, NFR1, NFR4, NFR5 | env |

## New rows
| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| G1 | code-review | major | `server/src/modules/onboarding/validate.ts:31` | T6 | fix — truncate by code point (no lone surrogate) → jsonb save would fail | open |
| G2 | code-review | major (AC66) | `server/src/modules/onboarding/validate.ts:36` | T6 | fix — sanitized label must contain only AC66 chars (no '…' after truncation) | open |
| G3 | code-review | major (UI state) | `client/src/app/repos/[repoId]/tour/_components/TourView/TourView.tsx:176` | T12 | fix — not-cloned state wins over failedJob "Try again" when no tour | open |
| G4 | code-review | major (AC56 pt.2) | `server/src/modules/onboarding/service.ts:233` | T11 | fix — README* case-insensitive, deterministic pick | open |
| G5 | code-review | minor | `server/src/modules/onboarding/validate.ts:58` | T6 | fix (owner edits file) — drop model-cited secret paths (isSecretPath) | open |
| G6 | code-review | minor | `server/src/modules/onboarding/service.ts:249` | T11 | fix (owner edits file) — parallel reads keeping order | open |
| G7 | code-review | minor | `client/.../TourView/TourView.tsx:136` | T12 | fix (owner edits file) — dedupe skeleton | open |
| G8 | code-review | nit | `server/src/modules/onboarding/validate.ts:50` | T6 | fix (trivial, same file) — stale comment | open |
| G9 | code-review | minor | `server/src/modules/onboarding/fs-source.ts:33` | T7 | = F10 | disputed-accepted |
| G10 | code-review | minor | `server/src/modules/onboarding/fs-source.ts:71` | T7 | defer — realpath(root) twice / rule split | deferred |
| G11 | code-review | minor | `client/src/app/repos/[repoId]/tour/page.tsx:18` | T12 | defer — needs repo-context.tsx (outside Owns); arch: acceptable | deferred |
| G12 | code-review | nit | `server/src/modules/onboarding/prompt.ts` label() vs reviewer-core specLabel | — | skip | skipped |
