## T11 fix2 — DONE
G4 FIXED service.ts gatherInput: /^readme/i over root files, secret paths filtered, deterministic sort (exact README.md, shortest, lexicographic). Tests: README_EN.md alone; README.md + README.ja.md in both orders (+ readme.MD). Red before (3 failures), green after.
G6 FIXED service.ts: readme + manifests read via one Promise.all; ranked files via Promise.all; pushed in original order. Test with out-of-order delays asserts order readme, manifest, ranked (the test passed on old code too - it guards order, it is not a red test).
Verify: server test onboarding-service.test.ts, typecheck, arch all PASS.
