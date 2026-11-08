## T6 fix1 — DONE (saved by orchestrator from hand-back)
- F3 fixed `validate.ts:35`: whitelist `/[^A-Za-z0-9 ._/*@:-]/g` → `_`; test covers ( ) ; & # $ %, quotes, é, 日, allowed chars kept.
- F5 fixed `prompt.ts:50`: `## kind: path` header removed; path only in `source="kind:path"` label of the <untrusted> block; test: path absent once <untrusted> blocks stripped.
- F6 fixed `classify.ts:44`: isTimeout false when error carries HTTP status; 504 retryable + httpError(504); 408 → httpError(408), not retryable (only 429/5xx retried).
- F8 fixed `validate.ts:122`: truncate then dedupe first_tasks; test.
Verify: onboarding validate/classify/input tests, typecheck, arch PASS. Tests not run red first.
