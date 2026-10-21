import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';
import {
  API_CONTRACT_BREAKING_CHANGE_SKILL,
  CORNER_CASES_SKILL,
  OVER_MOCKING_SKILL,
  UNCOVERED_BRANCHES_SKILL,
  type SeedSkill,
} from './seed-skills.js';
import { SEED_CONVENTIONS, SEED_CONVENTIONS_FILES_SAMPLED } from './seed-conventions.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/** `@@` hunk for a brand-new file. */
function newFilePatch(lines: string[]): string {
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');
}

/** Added/removed line counts of a hunks-only unified diff. */
function patchStats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

/**
 * PR #482 files — one or more per Smart Diff role. Seeded findings anchor to
 * `src/config.ts:12` (the key line) and `src/api/users.ts:45-52`.
 */
const SEED_PR_FILES: { path: string; patch: string }[] = [
  {
    path: 'src/middleware/ratelimit.ts',
    patch: newFilePatch([
      "import type { FastifyReply, FastifyRequest } from 'fastify';",
      '',
      'interface TokenBucket {',
      '  tokens: number;',
      '  lastRefill: number;',
      '}',
      '',
      'const buckets = new Map<string, TokenBucket>();',
      'const RATE_LIMIT = 100;',
      'const WINDOW_MS = 60_000;',
      '',
      'export async function rateLimit(req: FastifyRequest, reply: FastifyReply) {',
      '  const now = Date.now();',
      '  const bucket = buckets.get(req.ip) ?? { tokens: RATE_LIMIT, lastRefill: now };',
      '  const refill = ((now - bucket.lastRefill) / WINDOW_MS) * RATE_LIMIT;',
      '  bucket.tokens = Math.min(RATE_LIMIT, bucket.tokens + refill);',
      '  bucket.lastRefill = now;',
      '  buckets.set(req.ip, bucket);',
      '',
      '  if (bucket.tokens < 1) {',
      "    return reply.status(429).send({ error: 'Too many requests' });",
      '  }',
      '  bucket.tokens -= 1;',
      '}',
    ]),
  },
  {
    path: 'src/api/public/webhooks.ts',
    patch: [
      '@@ -42,6 +42,8 @@ export async function handleWebhook(req: FastifyRequest) {',
      '   return await processPayment(body.data);',
      ' }',
      ' ',
      '-function validateSignature(header: string) {',
      '-  return true;',
      '+function validateSignature(header: string | undefined): boolean {',
      "+  if (!header) return false;",
      '+  const expected = sign(rawBody, WEBHOOK_SECRET);',
      '+  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));',
      ' }',
    ].join('\n'),
  },
  {
    path: 'src/config.ts',
    patch: [
      '@@ -9,3 +9,5 @@',
      " export const API_PORT = parseInt(process.env.API_PORT || '3001', 10);",
      ' ',
      " export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/payments';",
      "+export const STRIPE_KEY = 'sk_live_EXAMPLE_NOT_A_REAL_KEY';",
      '+export const RATE_LIMIT_ENABLED = true;',
    ].join('\n'),
  },
  {
    path: 'src/api/users.ts',
    patch: [
      '@@ -42,5 +42,11 @@',
      '   return await fetchUserDetails(userId);',
      ' }',
      ' ',
      '-export async function getUserList() {',
      '-  return db.query.users.findMany();',
      '+export async function getUserList() {',
      '+  const users = await db.query.users.findMany();',
      '+  for (const user of users) {',
      '+    const orders = await db.query.orders.findMany({ where: { userId: user.id } });',
      '+    user.orders = orders;',
      '+  }',
      '+  return users;',
      '+}',
    ].join('\n'),
  },
  {
    path: 'src/api/users.test.ts',
    patch: newFilePatch([
      "import { describe, expect, it } from 'vitest';",
      "import { getUserList } from './users.js';",
      '',
      "describe('getUserList', () => {",
      "  it('returns a list of users', async () => {",
      '    const users = await getUserList();',
      '    expect(Array.isArray(users)).toBe(true);',
      '  });',
      '});',
    ]),
  },
  {
    path: 'src/index.ts',
    patch: newFilePatch([
      '// Public entrypoint',
      "export * from './api/index.js';",
      "export { rateLimit } from './middleware/ratelimit.js';",
    ]),
  },
  {
    path: 'README.md',
    patch: newFilePatch([
      '# Payments API',
      '',
      'A rate-limited public API for payment processing.',
      '',
      '## Rate limiting',
      '',
      'Public routes allow 100 requests per minute per client IP.',
    ]),
  },
  {
    path: 'pnpm-lock.yaml',
    patch: newFilePatch(["lockfileVersion: '9.0'", '', 'settings:', '  autoInstallPeers: true']),
  },
];

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the four built-in agents (General + Security +
 * Performance + Test Quality), all on the default openrouter/deepseek-v4-flash
 * provider+model. L02: built-in skills linked to Test Quality (3) and General (1),
 * and one finished conventions extraction (3 candidates) for the demo repo.
 *
 * Course lessons populate the other tables (memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset). Patches use GitHub's `patch` format (hunks only, no
    // `---`/`+++` file headers); additions/deletions are counted from them.
    await db.insert(t.prFiles).values(
      SEED_PR_FILES.map((f) => ({ prId: pr!.id, path: f.path, patch: f.patch, ...patchStats(f.patch) })),
    );

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- PR intent for #482 (Intent Layer) ----
  // Same head_sha as the PR (not stale) and input_hash 'seed' so the first POST re-derives.
  await db
    .insert(t.prIntent)
    .values({
      prId: pr!.id,
      intent: 'Protect the public API from abuse by rate limiting unauthenticated clients.',
      inScope: [
        'Token-bucket rate limiter middleware',
        'Apply the limiter to public webhook endpoints',
        'Rate-limit settings in config',
      ],
      outOfScope: ['Per-user quotas for authenticated clients', 'Distributed limiter state'],
      riskAreas: [
        { label: 'Secrets committed in config changes', kind: 'security' },
        { label: 'N+1 queries under the new limiter', kind: 'performance' },
      ],
      confidence: 'medium',
      basis: 'description',
      sources: [
        { kind: 'description', ref: 'pr-description', truncated: false },
        { kind: 'inferred', ref: 'pr-signals', truncated: false },
      ],
      unresolvedRefs: [{ ref: 'PAY-482', reason: 'Jira — not fetched' }],
      headSha: pr!.headSha,
      inputHash: 'seed',
      model: 'seed',
    })
    .onConflictDoNothing();

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Checks the tests in a PR: uncovered branches, missed corner cases, over-mocking, flakiness.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  const agentIds = new Map<string, string>();
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    const row = existing ?? (await db.insert(t.agents).values(a).returning())[0]!;
    agentIds.set(a.name, row.id);
  }

  // ---- L02 built-in skills + agent links (idempotent by name / link PK) ----
  // Links are only created the first time a skill is seeded, so a user who
  // later unlinks or disables one doesn't get it back on re-seed.
  const seedLinks: Array<{ agent: string; skills: SeedSkill[] }> = [
    {
      agent: 'Test Quality Reviewer',
      skills: [UNCOVERED_BRANCHES_SKILL, CORNER_CASES_SKILL, OVER_MOCKING_SKILL],
    },
    { agent: 'General Reviewer', skills: [API_CONTRACT_BREAKING_CHANGE_SKILL] },
  ];
  for (const { agent, skills } of seedLinks) {
    const agentId = agentIds.get(agent)!;
    for (const [order, sk] of skills.entries()) {
      const [existing] = await db
        .select({ id: t.skills.id })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, sk.name)));
      if (existing) continue;
      const [skill] = await db
        .insert(t.skills)
        .values({ workspaceId, ...sk, source: 'manual', enabled: true, version: 1 })
        .returning();
      await db.insert(t.skillVersions).values({ skillId: skill!.id, version: 1, body: sk.body });
      await db
        .insert(t.agentSkills)
        .values({ agentId, skillId: skill!.id, order, enabled: true })
        .onConflictDoNothing();
    }
  }

  // ---- L02 demo conventions extraction (only when the repo has none yet) ----
  const [scan] = await db
    .select({ id: t.conventionScans.id })
    .from(t.conventionScans)
    .where(eq(t.conventionScans.repoId, repoId))
    .limit(1);
  if (!scan) {
    await db.insert(t.conventionScans).values({
      workspaceId,
      repoId,
      status: 'done',
      filesSampled: SEED_CONVENTIONS_FILES_SAMPLED,
      finishedAt: new Date(),
    });
    await db.insert(t.conventions).values(SEED_CONVENTIONS.map((c) => ({ workspaceId, repoId, ...c })));
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
