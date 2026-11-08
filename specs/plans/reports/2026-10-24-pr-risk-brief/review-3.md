# Review round 3 — PR Risk Brief (delta 8915ccb..dac309b, BriefCard only)

Sources: /code-review high on BriefCard.tsx + test (9 unverified candidates). Arch / verifier not re-run: change is component-internal, no AC/interface touched (round-2 verdicts stand: arch APPROVE, verifier BLOCKED_UNVERIFIABLE env-only).

## Carried
review-1: F1–F7 fixed · F8–F11 deferred · F12 skipped · F13–F14 accepted · F15–F17 env.
review-2: N1, N7, N8, N9 fixed (dac309b) · N2, N3, N5 deferred · N4, N6, N10 skipped.

## New
| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| R1 | code-review | major | `client/…/BriefCard/BriefCard.tsx:68` | T7 | fix — ErrorState replaces cached brief on a failed background refetch → `isError && !data` | fixed |
| R2 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:49` | — | skip — global mutation toast is project convention (`providers.tsx`: "Mutations always toast"); same in IntentCard | skipped |
| R3 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:48` | — | defer → N3 — busy state lost on tab switch; needs server-side `generating` | deferred |
| R4 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:44` | — | defer → N3 — 100 s poll end silently clears alert | deferred |
| R5 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:53` | — | defer → N3 — stale `from` closure | deferred |
| R6 | code-review | minor (test) | `client/…/BriefCard/BriefCard.test.tsx:154` | T7 | fix (owner edits) — poll test lacks an unchanged response | fixed |
| R7 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:94` | T7 | defer — hand-built empty state vs `EmptyState` primitive | deferred |
| R8 | code-review | minor | `client/…/BriefCard/BriefCard.tsx:125` | T7 | defer — Outdated hint only in `title` (same pattern as IntentCard stale badge) | deferred |
| R9 | code-review | nit | `client/…/BriefCard/BriefCard.tsx:117` | — | skip — hard-coded ", " list join | skipped |
| R10 | code-review | nit | `client/…/BriefCard/BriefCard.test.tsx:127` | — | skip — redundant assertion | skipped |

Exit: no open critical/major · verifier BLOCKED_UNVERIFIABLE (env only: F15–F17) · last gate green (verify-fix3.md). Delta of round 3 (3-line guard + test) checked by orchestrator diff.
