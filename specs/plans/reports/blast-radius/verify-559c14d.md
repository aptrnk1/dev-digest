# Final verify @ 559c14d
## server unit
 Test Files  28 passed (28)
      Tests  313 passed (313)
✔ no dependency violations found (194 modules, 623 dependencies cruised)
‼ 36 known violations ignored. Run with --no-ignore-known to see them.
exit 0
## server it
 Test Files  11 passed (11)
      Tests  53 passed (53)
exit 0
## client
 Test Files  36 passed (36)
      Tests  136 passed (136)
exit 0
## mcp
✔ no dependency violations found (39 modules, 115 dependencies cruised)
 Test Files  18 passed (18)
      Tests  115 passed (115)
exit 0
## e2e: skipped — macOS 12 host (e2e/INSIGHTS 2026-10-18)

## after fix A1 (b4b50ae)
- `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm arch:check` · exit 0 · 314 passed, no new violations
- `cd server && pnpm exec vitest run blast.it.test.ts` (sandbox off) · exit 0 · 4 passed, 0 skipped
