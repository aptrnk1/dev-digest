# Review round 1 — Onboarding Tour
Sources: plan-verifier (verify-plan-1.md, INCOMPLETE) · architecture-reviewer (APPROVE, 1 info) · /code-review high (10 candidates)

| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| F1 | verifier AC52 | major (PARTIAL, red it test) | `server/src/modules/onboarding/service.ts:134,189` | T11 | fix — one now() at completion for generated_at + finished_at | open |
| F2 | verifier AC56/AC63 | critical (DEVIATION) | `server/src/modules/onboarding/constants.ts:47-76` | T4 | fix — exact spec lists + pin with unit test | open |
| F3 | verifier AC66 | critical (DEVIATION) | `server/src/modules/onboarding/validate.ts:35` | T6 | fix — whitelist sanitizer + test | open |
| F4 | code-review | critical (security, AC57) | `server/src/modules/onboarding/fs-source.ts` readCapped / `service.ts:245` | T7 | fix — never read through symlinks (secret via symlink) | open |
| F5 | code-review | major (security, AC58) | `server/src/modules/onboarding/prompt.ts:50` | T6 | fix — file path header inside <untrusted> | open |
| F6 | code-review | major | `server/src/modules/onboarding/classify.ts:44` | T6 | fix — HTTP status before timeout regex; 504/408 retryable + httpError text | open |
| F7 | code-review | major (UI state) | `client/src/app/repos/[repoId]/tour/_components/TourView/TourView.tsx:124` | T12 | fix — loading / error before "Add a repository" empty state | open |
| F8 | code-review | minor | `server/src/modules/onboarding/validate.ts:122` | T6 | fix (owner edits file) — dedupe first_tasks after truncation | open |
| F9 | code-review | minor | `server/src/modules/onboarding/fs-source.ts:69` | T7 | fix (owner edits file) — bounded read in readCapped | open |
| F10 | code-review | minor | `server/src/modules/onboarding/fs-source.ts:33` | T7 | fix if AC56 pt.1 semantics allow; else dispute | open |
| F11 | code-review | minor | `server/src/db/migrations/0016_wise_doctor_spectrum.sql:4` | T2 | defer — no code wrote onboarding rows before this feature (git grep at base) | deferred |
| F12 | code-review | minor | `server/src/modules/onboarding/input.ts:59` | T6 | defer — perf of fitToBudget re-tokenizing | deferred |
| F13 | code-review | minor | `server/src/platform/container.ts:265` | T3 | defer — llmWithLimits/buildLlm duplication | deferred |
| F14 | arch A1 | info | `server/src/platform/container.ts:190` | — | skip | skipped |
| E1 | verifier | env | AC73 e2e (macOS 12) | — | CI | env |
| E2 | verifier | env | AC13, NFR1, NFR4, NFR5 manual | — | developer before merge | env |
Note: architecture-reviewer did not hand-review client fe-arch rules (server/contracts focus).
