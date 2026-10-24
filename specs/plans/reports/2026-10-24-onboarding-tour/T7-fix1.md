## T7 fix1 — DONE (saved by orchestrator from hand-back)
- F4 fixed `fs-source.ts` readCapped: realpath(file) must equal resolve(realRoot, path); any symlinked component → null. Tests: `config/settings.txt -> ../.env` null, symlinked dir null, real paths read. (Not run red first.)
- F9 fixed: open + read maxChars*4-byte prefix; small files unchanged; 200k multibyte file capped (test).
- F10 DISPUTED — spec `specs/2026-10-24-onboarding-tour.md:226` "до 500 шляхів за зростанням path" = first 500 in global order; dir-by-dir walk can't guarantee it (`a-b` < `a/b`). Orchestrator: dispute accepted (spec quote).
Verify: server test onboarding-fs-source, typecheck, arch PASS.
