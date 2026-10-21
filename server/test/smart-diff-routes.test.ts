import { describe, it, expect } from 'vitest';
import { SmartDiffResponse } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { SmartDiffDomainError } from '../src/modules/smart-diff/domain.js';
import type { SmartDiffFacade } from '../src/modules/smart-diff/types.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const ID = '11111111-1111-4111-8111-111111111111';

const payload: SmartDiffResponse = {
  groups: [
    {
      role: 'core',
      files_with_findings: 1,
      files: [
        {
          path: 'src/a.ts',
          additions: 1,
          deletions: 0,
          finding_lines: [3],
          finding_ids: ['f1'],
          max_severity: 'WARNING',
          rank_percentile: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

function app(smartDiff: SmartDiffFacade) {
  return buildApp({ config, overrides: { auth: new MockAuthProvider(), smartDiff } });
}

describe('GET /pulls/:id/smart-diff', () => {
  it('200 with a body matching SmartDiffResponse; passes workspace + id', async () => {
    const calls: string[][] = [];
    const a = await app({
      get: async (w, p) => {
        calls.push([w, p]);
        return payload;
      },
    });
    const res = await a.inject({ method: 'GET', url: `/pulls/${ID}/smart-diff` });
    expect(res.statusCode).toBe(200);
    expect(SmartDiffResponse.safeParse(res.json()).success).toBe(true);
    expect(calls).toEqual([['w1', ID]]);
    await a.close();
  });

  it('unknown PR -> 404', async () => {
    const a = await app({
      get: async () => {
        throw new SmartDiffDomainError('pr_not_found', 'Pull request not found');
      },
    });
    const res = await a.inject({ method: 'GET', url: `/pulls/${ID}/smart-diff` });
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
    const res = await a.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(called).toBe(false);
    await a.close();
  });
});
