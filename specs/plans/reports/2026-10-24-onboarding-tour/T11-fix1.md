## T11 fix1 — DONE (saved by orchestrator from hand-back)
- F1 fixed `service.ts:132-138`, `:172`: build() returns the tour without generated_at; execute() takes one `completedAt = this.now()` for tour.generated_at and store.complete. Unit test with a +1 ms-per-call clock asserts equality.
Verify: onboarding-service test PASS; server it onboarding PASS (sandbox off, not self-skip; counts re-checked by orchestrator in the gate).
