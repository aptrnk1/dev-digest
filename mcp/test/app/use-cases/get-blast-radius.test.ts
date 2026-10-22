import { describe, expect, it } from 'vitest';
import { makeGetBlastRadius } from '../../../src/app/use-cases/get-blast-radius.js';
import { createResolver } from '../../../src/app/resolve.js';
import { PrNotFound } from '../../../src/domain/errors.js';
import { MAX_RESPONSE_CHARS } from '../../../src/domain/findings.js';
import { blastFixture, fakeApi, prFixture, repoFixture } from '../../fakes.js';

const setup = (body = blastFixture(), onCall?: (id: string) => void) => {
  const api = fakeApi({
    listRepos: async () => [repoFixture({ id: 'r1', full_name: 'acme/web' })],
    listPulls: async () => [prFixture({ id: 'pr-9', number: 9 })],
    getBlastRadius: async (id) => {
      onCall?.(id);
      return body;
    },
  });
  return makeGetBlastRadius({ api, resolver: createResolver(api) });
};

describe('getBlastRadius', () => {
  it('returns the API body plus repo and pr', async () => {
    let seen = '';
    const body = blastFixture({ summary: 's', stats: { symbols: 1, callers: 0, endpoints: 0, crons: 0 } });
    const view = await setup(body, (id) => (seen = id))({ repo: 'acme/web', pr: 9 });
    expect(seen).toBe('pr-9');
    expect(view).toEqual({ repo: 'acme/web', pr: 9, ...body });
  });

  it('adds a rebuild hint for no_data', async () => {
    const view = await setup(blastFixture({ degraded: true, degraded_reason: 'no_data' }))({ repo: 'acme/web', pr: 9 });
    expect(view.hint).toContain('index is no_data');
    expect(view.hint).toContain('Rebuild index');
  });

  it('adds a flag hint for flag_off', async () => {
    const view = await setup(blastFixture({ degraded: true, degraded_reason: 'flag_off' }))({ repo: 'acme/web', pr: 9 });
    expect(view.hint).toContain('REPO_INTEL_ENABLED=false');
  });

  it('throws PrNotFound for an unknown PR', async () => {
    await expect(setup()({ repo: 'acme/web', pr: 404 })).rejects.toThrow(PrNotFound);
  });

  it('truncates callers to fit the char budget', async () => {
    const callers = Array.from({ length: 300 }, (_, i) => ({ name: 'sym', file: `src/${'x'.repeat(60)}${i}.ts`, line: i + 1 }));
    const body = blastFixture({
      downstream: [
        { symbol: 'a', callers, endpoints_affected: [], crons_affected: [] },
        { symbol: 'b', callers: callers.slice(0, 2), endpoints_affected: [], crons_affected: [] },
      ],
    });
    const view = await setup(body)({ repo: 'acme/web', pr: 9 });
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(view.truncated_callers).toBeGreaterThan(0);
    expect(view.hint).toContain('response too large');
    expect(view.downstream.every((d) => d.callers.length > 0)).toBe(true);
    expect(body.downstream[0]!.callers).toHaveLength(300);
  });
});
