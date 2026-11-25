# mcp — @devdigest/mcp

DevDigest MCP server over stdio; talks to the DevDigest HTTP API only.
Human docs: `README.md` (source of truth).

## Where things live
- `src/domain/`            errors (`DomainError` + codes) and findings view shaping (`toRunView`, `fitBudget`)
- `src/app/ports.ts`       outbound ports (`DevDigestApi`, `RunStore`, `Sleeper`, `Clock`)
- `src/app/resolve.ts`     repo / PR / agent name resolution
- `src/app/use-cases/`     one use case per tool; `index.ts` holds the `UseCases` type
- `src/adapters/http/`     API client (zod-parsed) and `ApiError`
- `src/adapters/memory/`   in-process `RunRegistry`
- `src/adapters/mcp/`      `definitions.ts` (schemas, descriptions), `register.ts`, `result.ts`, `tools/`
- `src/compose.ts`         composition root (`createServer`); `src/index.ts` stdio entry

## Conventions (non-default)
- Adding a tool = a use case in `app/use-cases/` + an adapter in `adapters/mcp/tools/` + a def in
  `definitions.ts` + a line in `compose.ts` (and `register.ts`).
- Uses npm (`package-lock.json`), not pnpm.
- stdout is protocol-only; log to stderr (`console.error`).
- No DB: the API is the only way to DevDigest data.
- `@devdigest/shared` resolves to `../server/src/vendor/shared`; `zod` is force-aliased to this
  package's `node_modules` (one zod instance). Keep both aliases.
- `npm run arch:check` must stay clean; there is no baseline file.
- Keep `tools/list` + instructions within the 1 500-token start budget (currently ~785).

## Read when
- Changing rings or imports -> README.md §Architecture and `.dependency-cruiser.cjs`.
- Adding or changing a tool -> README.md §Tools and §Errors.
- Before any edit here -> INSIGHTS.md.
