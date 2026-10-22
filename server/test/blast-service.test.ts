import { describe, it, expect } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { BlastDomainError } from '../src/modules/blast/domain.js';
import type { BlastSource, BlastStore, PullPathsRead } from '../src/modules/blast/ports.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';

const state: IndexState = {
  repoId: 'r1',
  status: 'full',
  filesIndexed: 1,
  filesSkipped: 0,
  durationMs: 1,
  lastIndexedSha: 'sha1',
  indexerVersion: 1,
  updatedAt: new Date(0),
};

function setup(opts: { pull?: PullPathsRead; blast?: () => Promise<BlastResult> } = {}) {
  const calls: { blast: [string, string[]][]; state: string[] } = { blast: [], state: [] };
  const store: BlastStore = { loadPull: async () => opts.pull };
  const intel: BlastSource = {
    getBlastRadius: async (repoId, paths) => {
      calls.blast.push([repoId, paths]);
      return opts.blast
        ? opts.blast()
        : { changedSymbols: [{ name: 'a', file: 'a.ts', kind: 'function' }], callers: [], impactedEndpoints: [] };
    },
    getIndexState: async (repoId) => {
      calls.state.push(repoId);
      return state;
    },
  };
  return { svc: new BlastService({ store, intel, repoIntelEnabled: true }), calls };
}

describe('BlastService', () => {
  it('unknown PR -> pr_not_found, no intel calls', async () => {
    const { svc, calls } = setup();
    await expect(svc.get('w1', 'p1')).rejects.toMatchObject({ code: 'pr_not_found' });
    await expect(svc.get('w1', 'p1')).rejects.toBeInstanceOf(BlastDomainError);
    expect(calls.blast).toEqual([]);
    expect(calls.state).toEqual([]);
  });

  it('passes repoId and PR paths to getBlastRadius', async () => {
    const { svc, calls } = setup({ pull: { prId: 'p1', repoId: 'r1', paths: ['a.ts', 'b.ts'] } });
    const out = await svc.get('w1', 'p1');
    expect(calls.blast).toEqual([['r1', ['a.ts', 'b.ts']]]);
    expect(out.pr_id).toBe('p1');
    expect(out.index_sha).toBe('sha1');
    expect(out.degraded).toBe(false);
  });

  it('empty paths -> getBlastRadius skipped, still non-degraded, index state read', async () => {
    const { svc, calls } = setup({ pull: { prId: 'p1', repoId: 'r1', paths: [] } });
    const out = await svc.get('w1', 'p1');
    expect(calls.blast).toEqual([]);
    expect(calls.state).toEqual(['r1']);
    expect(out.degraded).toBe(false);
    expect(out.stats).toEqual({ symbols: 0, callers: 0, endpoints: 0, crons: 0 });
  });

  it('intel rejects -> degraded no_data, no throw', async () => {
    const { svc } = setup({
      pull: { prId: 'p1', repoId: 'r1', paths: ['a.ts'] },
      blast: async () => {
        throw new Error('boom');
      },
    });
    const out = await svc.get('w1', 'p1');
    expect(out.degraded).toBe(true);
    expect(out.degraded_reason).toBe('no_data');
    expect(out.changed_symbols).toEqual([]);
  });
});
