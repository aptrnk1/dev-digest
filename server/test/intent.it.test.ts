import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
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
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import type { PrIntentRecord, PrIntentState } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * Intent Layer end to end against real Postgres: POST derives + persists, the
 * second POST is a cache hit, GET reports `stale` once the PR head moves, a
 * missing provider key is a 422 and an unknown PR a 404.
 */

const CLASSIFIED = {
  intent: 'Limit abuse of the public API with a token-bucket limiter',
  in_scope: ['limiter middleware'],
  out_of_scope: ['per-user quotas'],
  risk_areas: [{ label: 'secrets in config', kind: 'security' }],
  confidence: 'high',
};

d('Intent Layer (Testcontainers pg)', () => {
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

  function makeApp(opts: { withKey?: boolean } = {}) {
    llm = new MockLLMProvider('openai', { structuredBySchema: { pr_intent: CLASSIFIED } });
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        ...(opts.withKey === false
          ? { secrets: new MockSecretsProvider() }
          : { llm: { openrouter: llm } }),
      },
    });
  }
  const structuredCalls = () => llm.calls.filter((c) => c.method === 'completeStructured').length;

  it('GET returns the seeded intent, not stale', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrIntentState;
    expect(body.stale).toBe(false);
    expect(body.intent).toMatchObject({ pr_id: prId, confidence: 'medium', basis: 'description' });
    await app.close();
  });

  it('POST re-derives over the seed row, persists, and a second POST is a cache hit', async () => {
    const app = await makeApp();
    const first = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent`, payload: {} });
    expect(first.statusCode).toBe(200);
    const rec = first.json() as PrIntentRecord;
    expect(rec).toMatchObject({
      intent: CLASSIFIED.intent,
      // the model said high, but the seeded body (description only) caps it at medium
      confidence: 'medium',
      basis: 'description',
      model: 'anthropic/claude-haiku-4-5',
    });
    expect(structuredCalls()).toBe(1);

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    expect(row).toMatchObject({ intent: CLASSIFIED.intent, tokensIn: 100, tokensOut: 50, costUsd: 0.001 });
    expect(row!.inputHash).not.toBe('seed');

    const second = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent`, payload: {} });
    expect(second.statusCode).toBe(200);
    expect(structuredCalls()).toBe(1);

    const forced = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent`, payload: { force: true } });
    expect(forced.statusCode).toBe(200);
    expect(structuredCalls()).toBe(2);

    // POST without a body is accepted too
    const bare = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent` });
    expect(bare.statusCode).toBe(200);
    await app.close();
  });

  it('GET is stale after the PR head moves', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` })).json() as PrIntentState;
    expect(before.stale).toBe(false);

    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'ffffffffffff' })
      .where(and(eq(t.pullRequests.id, prId)));
    const after = (await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` })).json() as PrIntentState;
    expect(after.stale).toBe(true);
    expect(after.intent).not.toBeNull();

    const rederived = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent`, payload: {} });
    expect((rederived.json() as PrIntentRecord).head_sha).toBe('ffffffffffff');
    const fresh = (await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` })).json() as PrIntentState;
    expect(fresh.stale).toBe(false);
    await app.close();
  });

  it('POST is a 422 llm_not_configured without a provider key', async () => {
    const app = await makeApp({ withKey: false });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/intent`,
      payload: { force: true },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('llm_not_configured');
    await app.close();
  });

  it('404s an unknown PR on GET and POST; 422 on a non-uuid id', async () => {
    const app = await makeApp();
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/pulls/${id}/intent` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/pulls/${id}/intent`, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/pulls/nope/intent' })).statusCode).toBe(422);
    await app.close();
  });
});
