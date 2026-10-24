import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { LLMProvider } from '../src/ports/index.js';
import type { PrBrief, PrBriefState } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * PR Brief against real Postgres: POST generates + upserts one row per PR, GET
 * serves it with no LLM call, a failing provider is a 502 that leaves the row
 * untouched.
 */

const DRAFT = {
  summary: 'Adds a token-bucket rate limiter and hardens webhook signature checks.',
  risks: [
    {
      kind: 'security',
      title: 'Webhook signature validation',
      explanation: 'The signature check changed shape; a wrong branch would accept forged webhooks.',
      severity: 'high',
      file_refs: ['src/api/public/webhooks.ts'],
    },
  ],
  review_focus: [{ file: 'src/middleware/ratelimit.ts', line: 5, reason: 'Bucket state is process-local' }],
};

class ThrowingProvider extends MockLLMProvider {
  override async completeStructured<T>(req: Parameters<MockLLMProvider['completeStructured']>[0]): Promise<never> {
    this.calls.push({ method: 'completeStructured', req });
    throw new Error('provider down');
  }
}

d('PR Brief (Testcontainers pg)', () => {
  let pg: PgFixture;
  let prId: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [pr] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(provider: MockLLMProvider) {
    llm = provider;
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llmWithLimits: () => provider as LLMProvider,
      },
    });
  }
  const okProvider = () => new MockLLMProvider('openai', { structuredBySchema: { pr_brief: DRAFT } });
  const calls = () => llm.calls.filter((c) => c.method === 'completeStructured').length;
  const rows = () => pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));

  it('POST generates and stores one row with the PR head_sha; a repeat overwrites it', async () => {
    const app = await makeApp(okProvider());
    const [pr] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId));

    const first = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(first.statusCode).toBe(200);
    const brief = first.json() as PrBrief;
    expect(brief.head_sha).toBe(pr!.headSha);
    expect(brief.summary).toBe(DRAFT.summary);
    expect(calls()).toBe(1);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.json).toEqual(brief);

    const second = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(second.statusCode).toBe(200);
    expect(calls()).toBe(2);
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.json).toEqual(second.json());
    await app.close();
  });

  it('GET returns the stored brief without any LLM call', async () => {
    const app = await makeApp(okProvider());
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const state = res.json() as PrBriefState;
    expect(state.stale).toBe(false);
    expect(state.brief?.summary).toBe(DRAFT.summary);
    expect(calls()).toBe(0);
    await app.close();
  });

  it('a failing provider is a 502 and the stored row is byte-identical', async () => {
    const before = JSON.stringify((await rows())[0]!.json);
    const app = await makeApp(new ThrowingProvider('openai'));
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('brief_failed');
    expect(calls()).toBe(2); // one retry, then give up
    expect(JSON.stringify((await rows())[0]!.json)).toBe(before);
    await app.close();
  });

  it('GET p95 over 20 requests is within 300 ms', async () => {
    const app = await makeApp(okProvider());
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
      times.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(times.length * 0.95) - 1]!).toBeLessThanOrEqual(300);
    expect(calls()).toBe(0);
    await app.close();
  });
});
