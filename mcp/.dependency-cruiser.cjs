/**
 * Onion-architecture boundary rules for mcp/src (rings: domain → app → adapters → compose/index).
 * Skill: .claude/skills/onion-architecture/SKILL.md (server-scoped; applied per ring here).
 *   npm run arch:check   — no baseline; every violation fails.
 */
const SDK = ['node_modules/@modelcontextprotocol/', '^@modelcontextprotocol/'];
const ZOD = ['^zod$', 'node_modules/zod/'];
const OUTER = ['^src/adapters/', '^src/compose\\.ts$', '^src/index\\.ts$'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'domain/ imports nothing from app, adapters, compose, index, the MCP SDK or zod.',
      from: { path: '^src/domain/' },
      to: { path: ['^src/app/', ...OUTER, ...SDK, ...ZOD] },
    },
    {
      name: 'core-contracts-type-only',
      severity: 'error',
      comment: 'domain/ and app/ may use @devdigest/shared as `import type` only; parsing belongs to adapters/http.',
      from: { path: '^src/(domain|app)/' },
      to: { path: 'server/src/vendor/shared/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'app-no-infra',
      severity: 'error',
      comment: 'app/ imports nothing from adapters, compose, index, the MCP SDK or zod.',
      from: { path: '^src/app/' },
      to: { path: [...OUTER, ...SDK, ...ZOD] },
    },
    {
      name: 'sdk-only-at-mcp-edge',
      severity: 'error',
      comment: 'Only adapters/mcp, compose.ts and index.ts may import @modelcontextprotocol/*.',
      from: { pathNot: '^src/(adapters/mcp/|compose\\.ts$|index\\.ts$)' },
      to: { path: SDK },
    },
    {
      name: 'adapters-isolated',
      severity: 'error',
      comment: 'An adapter folder does not import another adapter folder (only adapters/mcp -> adapters/http/errors.ts is allowed). No adapter imports compose/index.',
      from: { path: '^src/adapters/(http|memory)/' },
      to: { path: ['^src/adapters/(http|memory|mcp)/', '^src/compose\\.ts$', '^src/index\\.ts$'], pathNot: ['^src/adapters/$1/'] },
    },
    {
      name: 'mcp-adapter-isolated',
      severity: 'error',
      comment: 'adapters/mcp may import only adapters/http/errors.ts from other adapters, and never compose/index.',
      from: { path: '^src/adapters/mcp/' },
      to: { path: ['^src/adapters/(http|memory)/', '^src/compose\\.ts$', '^src/index\\.ts$'], pathNot: ['^src/adapters/http/errors\\.ts$'] },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
