import { describe, expect, it, vi } from 'vitest';
import { makeRunReview } from '../../../src/app/use-cases/run-review.js';
import { createResolver } from '../../../src/app/resolve.js';
import { AgentDisabled, RunFailed, RunNotStarted } from '../../../src/domain/errors.js';
import type { DevDigestApi } from '../../../src/app/ports.js';
import {
  agentFixture,
  fakeApi,
  fakeClock,
  findingFixture,
  memoryRunStore,
  prFixture,
  repoFixture,
  reviewFixture,
  runFixture,
} from '../../fakes.js';

const input = { repo: 'acme/web', pr: 1, agent: 'Security', timeoutS: 300, detail: 'concise' as const };

function setup(statuses: Array<'running' | 'done' | 'failed' | 'cancelled'>, extra: Partial<DevDigestApi> = {}) {
  let n = 0;
  const clock = fakeClock();
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
    clock.advance(ms);
  };
  const listRuns = vi.fn(async () => {
    const status = statuses[Math.min(n++, statuses.length - 1)]!;
    return [runFixture({ run_id: 'run-1', status, error: status === 'failed' ? 'bad key' : null })];
  });
  const api = fakeApi({
    listRepos: async () => [repoFixture()],
    listPulls: async () => [prFixture()],
    listAgents: async () => [agentFixture(), agentFixture({ id: 'off', name: 'Off', enabled: false })],
    listRuns,
    listReviews: async () => [
      reviewFixture({ run_id: 'other' }),
      reviewFixture({ run_id: 'run-1', findings: [findingFixture({ severity: 'CRITICAL' })] }),
    ],
    ...extra,
  });
  const runs = memoryRunStore();
  const uc = makeRunReview({ api, resolver: createResolver(api), runs, sleep, now: clock });
  return { uc, calls, listRuns, runs, api };
}

describe('runReview', () => {
  it('polls running -> running -> done with 1s, 2s backoff', async () => {
    const { uc, calls } = setup(['running', 'running', 'done']);
    const view = await uc(input, { signal: new AbortController().signal });
    expect(calls).toEqual([1000, 2000]);
    expect(view).toMatchObject({ run_id: 'run-1', status: 'done', verdict: 'request_changes' });
  });

  it('returns a pending view on timeout', async () => {
    const { uc } = setup(['running']);
    const view = await uc({ ...input, timeoutS: 5 }, { signal: new AbortController().signal });
    expect(view).toMatchObject({ status: 'running', run_id: 'run-1' });
    expect((view as { hint: string }).hint).toContain('get_findings(run_id="run-1", repo="acme/web", pr=1)');
  });

  it.each(['failed', 'cancelled'] as const)('%s -> RunFailed', async (s) => {
    const { uc } = setup([s]);
    const err = await uc(input, { signal: new AbortController().signal }).catch((e) => e);
    expect(err).toBeInstanceOf(RunFailed);
    if (s === 'failed') expect(err.message).toContain('bad key');
  });

  it('empty runs from POST review -> RunNotStarted, no polling', async () => {
    const { uc, listRuns } = setup(['done'], {
      startReview: async () => ({ pr_id: 'pr-1', runs: [], reviews: [] }) as never,
    });
    const err = await uc(input, { signal: new AbortController().signal }).catch((e) => e);
    expect(err).toBeInstanceOf(RunNotStarted);
    expect(listRuns).not.toHaveBeenCalled();
  });

  it('aborted signal stops polling without cancelling', async () => {
    const { uc, listRuns } = setup(['running']);
    const ac = new AbortController();
    ac.abort();
    const view = await uc(input, { signal: ac.signal });
    expect(view).toMatchObject({ status: 'running' });
    expect(listRuns).not.toHaveBeenCalled();
  });

  it('remembers the run and reports progress each poll', async () => {
    const { uc, runs } = setup(['running', 'running', 'done']);
    const progress = vi.fn(async () => {});
    await uc(input, { signal: new AbortController().signal, progress });
    expect(runs.lookup('run-1')).toEqual({ prId: 'pr-1', repo: 'acme/web', pr: 1, agent: 'Security' });
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('propagates AgentDisabled', async () => {
    const { uc } = setup(['done']);
    await expect(uc({ ...input, agent: 'Off' }, { signal: new AbortController().signal })).rejects.toBeInstanceOf(
      AgentDisabled,
    );
  });
});
