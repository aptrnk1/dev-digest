## Mid-wave architecture review — f390fc6..814838c (W1) — APPROVE
critical 0 · major 0 · minor 1 (→ Phase 5 ledger / T11)
- A1 minor `server/src/modules/onboarding/repository.ts:27` — logger optional ctor arg; compose.ts must pass a logger (or explicit no-op), else the "stored tour no longer parses" info log is dropped silently. → T11
Notes for T11: build fs-source only in compose.ts; service.ts must not import fs-source/repository (depcruise does not cover module-local adapters — check by hand). Keep repo-intel import type-only; behaviour via container facade.
Insight candidate (server/INSIGHTS): module-local outbound adapters are invisible to depcruise `modules-no-concrete-adapters`.
