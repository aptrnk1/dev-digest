## Mid-wave architecture review — d43a1dc..f390fc6 (W0) — APPROVE
critical 0 · major 0 · minor 2 (→ Phase 5 ledger)
- A1 minor `server/src/modules/onboarding/domain.ts:6` — OnboardingDomainError standalone (ok, no shared base); keep code→AppError map at the edge (routes.ts / toHttpError), not in the service. → T11
- A2 minor `server/src/modules/onboarding/ports.ts:75` — `ModelHandle.provider(timeoutMs)`: concrete ResolveModel must call `container.llmWithLimits` from compose.ts only (service-no-container); MAX_HTTP_REQUESTS→maxRetries mapping in one place. → T11
Insight candidate: Container-backed per-request factories are wired as closures in compose.ts.
