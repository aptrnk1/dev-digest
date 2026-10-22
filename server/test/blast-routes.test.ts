import { describe, it, expect } from 'vitest';
import { BlastRadiusResponse } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { BlastDomainError } from '../src/modules/blast/domain.js';
import type { BlastFacade } from '../src/modules/blast/types.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const ID = '11111111-1111-4111-8111-111111111111';

const payload: BlastRadiusResponse = {
  pr_id: ID,
  index_sha: 'abc',
  changed_symbols: [{ name: 'a', file: 'a.ts', kind: 'function' }],
  downstream: [
    { symbol: 'a', callers: [{ name: 'c', file: 'c.ts', line: 4 }], endpoints_affected: ['GET /x'], crons_affected: [] },
  ],
  summary: '1 changed symbols · 1 callers · 1 endpoints · 0 crons',
  stats: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  degraded: false,
  degraded_reason: null,
};

function app(blast: BlastFacade) {
  return buildApp({ config, overrides: { auth: new MockAuthProvider(), blast } });
}

describe('GET /pulls/:id/blast-radius', () => {
  it('200 with a body matching BlastRadiusResponse; passes workspace + id', async () => {
    const calls: string[][] = [];
    const a = await app({
      get: async (w, p) => {
        calls.push([w, p]);
        return payload;
      },
    });
    const res = await a.inject({ method: 'GET', url: `/pulls/${ID}/blast-radius` });
    expect(res.statusCode).toBe(200);
    expect(BlastRadiusResponse.safeParse(res.json()).success).toBe(true);
    expect(calls).toEqual([['w1', ID]]);
    await a.close();
  });

  it('unknown PR -> 404', async () => {
    const a = await app({
      get: async () => {
        throw new BlastDomainError('pr_not_found', 'Pull request not found');
      },
    });
    const res = await a.inject({ method: 'GET', url: `/pulls/${ID}/blast-radius` });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it('non-uuid id -> 4xx validation, facade not called', async () => {
    let called = false;
    const a = await app({
      get: async () => {
        called = true;
        return payload;
      },
    });
    const res = await a.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast-radius' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(called).toBe(false);
    await a.close();
  });
});
