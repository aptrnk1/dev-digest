import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
} from '../src/adapters/mocks.js';
import type { BlastRadiusResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const SEEDED_SHA = 'b1a5700000000000000000000000000000000482';

/**
 * Blast radius end to end against real Postgres + the seeded PR #482 and its
 * seeded repo-intel index: stats, grouped callers, endpoint/cron chips, the
 * degraded states (no index row, flag off) and the unknown-PR 404 (R5, R6).
 */
d('Blast radius (Testcontainers pg)', () => {
  let pg: PgFixture;
  let prId: string;
  let repoId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let appOff: Awaited<ReturnType<typeof buildApp>>;

  const build = (env: Record<string, string>) =>
    buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openrouter: new MockLLMProvider('openai', {}) },
      },
    });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
    repoId = pr!.repoId;
    app = await build({ REPO_INTEL_ENABLED: 'true' });
    appOff = await build({ REPO_INTEL_ENABLED: 'false' });
  });
  afterAll(async () => {
    await app?.close();
    await appOff?.close();
    await pg?.stop();
  });

  async function get(a: typeof app, id = prId) {
    return a.inject({ method: 'GET', url: `/pulls/${id}/blast-radius` });
  }

  it('returns the seeded impact map for PR #482', async () => {
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    expect(body.stats).toEqual({ symbols: 3, callers: 5, endpoints: 4, crons: 1 });
    expect(body.degraded).toBe(false);
    expect(body.degraded_reason).toBeNull();
    expect(body.index_sha).toBe(SEEDED_SHA);

    const first = body.downstream[0]!;
    expect(first.symbol).toBe('rateLimit');
    expect(first.callers).toHaveLength(4);
    expect(first.callers).toContainEqual(
      expect.objectContaining({ file: 'src/api/public/index.ts', line: 23 }),
    );
    expect(first.endpoints_affected).toContain('GET /api/public/items');
    expect(first.crons_affected).toEqual(['job:reset_rate_buckets']);
  });

  it('reports flag_off when repo intelligence is disabled', async () => {
    const res = await get(appOff);
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;
    expect(body.degraded).toBe(true);
    expect(body.degraded_reason).toBe('flag_off');
  });

  it('404s on an unknown PR', async () => {
    const res = await get(app, randomUUID());
    expect(res.statusCode).toBe(404);
  });

  it('degrades with no_data and empty downstream once the index state is gone', async () => {
    await pg.handle.db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repoId));
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;
    expect(body.degraded).toBe(true);
    expect(body.degraded_reason).toBe('no_data');
    expect(body.downstream).toEqual([]);
  });
});
