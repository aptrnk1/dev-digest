## T6 fix round 2: DONE
Files: server/src/modules/onboarding/validate.ts, server/test/onboarding-validate.test.ts
Each new test was run red against the old code first, then green after the fix; onboarding-validate and onboarding-input tests, server typecheck and arch pass.
- G1 FIXED validate.ts truncate: drops a trailing high surrogate before the ellipsis; length limit holds.
- G2 FIXED validate.ts sanitizeLabel: whitelist, then plain slice to 40 (no ellipsis).
- G5 FIXED validate.ts valid(): isSecretPath (from input.ts) treated as invalid for nodes, critical_paths, reading_path, first_tasks.files.
- G8 FIXED validate.ts: order comment updated.
