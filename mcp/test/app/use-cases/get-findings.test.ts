import { describe, expect, it } from 'vitest';
import { makeGetFindings } from '../../../src/app/use-cases/get-findings.js';
import { createResolver } from '../../../src/app/resolve.js';
import { BadArgs, RunUnknown } from '../../../src/domain/errors.js';
import {
  agentFixture,
  fakeApi,
  findingFixture,
  memoryRunStore,
  prFixture,
  repoFixture,
  reviewFixture,
  runFixture,
} from '../../fakes.js';

function setup(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({
    listAgents: async () => [agentFixture({ id: 'a1', name: 'Security' }), agentFixture({ id: 'a2', name: 'Style' })],
    listRepos: async () => [repoFixture()],
    listPulls: async () => [prFixture({ id: 'pr-1', number: 7 })],
    ...over,
  });
  const runs = memoryRunStore();
  return { runs, uc: makeGetFindings({ api, resolver: createResolver(api), runs }) };
}

const many = (n: number) =>
  Array.from({ length: n }, (_, k) => findingFixture({ id: `f${k}`, start_line: k + 1 }));

describe('getFindings by run', () => {
  it('finds a run remembered by this session', async () => {
    const { uc, runs } = setup({
      listRuns: async () => [runFixture({ run_id: 'r1', agent_id: 'a1' })],
      listReviews: async () => [reviewFixture({ run_id: 'r1', findings: [findingFixture()] })],
    });
    runs.remember('r1', { prId: 'pr-1', repo: 'acme/web', pr: 7, agent: 'a1' });
    const v = (await uc({ runId: 'r1', detail: 'concise' })) as { run_id: string; findings: unknown[]; verdict: string };
    expect(v.run_id).toBe('r1');
    expect(v.findings).toHaveLength(1);
    expect(v.verdict).toBe('comment');
  });

  it('accepts an unknown run_id together with repo and pr', async () => {
    const { uc } = setup({
      listRuns: async () => [runFixture({ run_id: 'r9' })],
      listReviews: async () => [reviewFixture({ run_id: 'r9' })],
    });
    const v = (await uc({ runId: 'r9', repo: 'acme/web', pr: 7, detail: 'concise' })) as { run_id: string };
    expect(v.run_id).toBe('r9');
  });

  it('rejects a bare unknown run_id', async () => {
    const { uc } = setup();
    await expect(uc({ runId: 'zzz', detail: 'concise' })).rejects.toBeInstanceOf(RunUnknown);
  });

  it('reports a running run without findings', async () => {
    const { uc, runs } = setup({ listRuns: async () => [runFixture({ run_id: 'r1', status: 'running' })] });
    runs.remember('r1', { prId: 'pr-1', repo: 'acme/web', pr: 7, agent: 'a1' });
    const v = (await uc({ runId: 'r1', detail: 'concise' })) as { status: string; findings: unknown[]; verdict: unknown };
    expect(v.status).toBe('running');
    expect(v.findings).toEqual([]);
    expect(v.verdict).toBeNull();
  });
});

describe('getFindings by PR', () => {
  const reviews = [
    reviewFixture({ id: 'old', agent_id: 'a1', created_at: '2026-01-01T00:00:00Z', findings: [findingFixture({ id: 'x' })] }),
    reviewFixture({ id: 'new', agent_id: 'a1', run_id: 'r2', created_at: '2026-02-01T00:00:00Z', findings: [findingFixture({ id: 'y' })] }),
    reviewFixture({ id: 'b', agent_id: 'a2', agent_name: 'Style', run_id: 'r3', created_at: '2026-01-15T00:00:00Z' }),
  ];

  it('returns the newest review of the named agent', async () => {
    const { uc } = setup({ listReviews: async () => reviews });
    const v = (await uc({ repo: 'acme/web', pr: 7, agent: 'Security', detail: 'concise' })) as {
      runs: Array<{ run_id: string; findings: Array<{ id: string }> }>;
    };
    expect(v.runs).toHaveLength(1);
    expect(v.runs[0]!.run_id).toBe('r2');
    expect(v.runs[0]!.findings[0]!.id).toBe('y');
  });

  it('returns the newest review per agent, overlaying a newer failed run', async () => {
    const { uc } = setup({
      listReviews: async () => reviews,
      listRuns: async () => [
        runFixture({ run_id: 'r4', agent_id: 'a2', agent_name: 'Style', status: 'failed', error: 'no key', ran_at: '2026-03-01T00:00:00Z' }),
      ],
    });
    const v = (await uc({ repo: 'acme/web', pr: 7, detail: 'concise' })) as {
      runs: Array<{ agent: string; status: string; error?: string }>;
    };
    expect(v.runs).toHaveLength(2);
    const style = v.runs.find((r) => r.agent === 'Style')!;
    expect(style.status).toBe('failed');
    expect(style.error).toBe('no key');
    expect(v.runs.find((r) => r.agent === 'Security')!.status).toBe('done');
  });

  it('includes a seeded review with run_id null', async () => {
    const { uc } = setup({ listReviews: async () => [reviewFixture({ run_id: null, findings: [findingFixture()] })] });
    const v = (await uc({ repo: 'acme/web', pr: 7, detail: 'concise' })) as { runs: Array<{ run_id: null }> };
    expect(v.runs).toHaveLength(1);
    expect(v.runs[0]!.run_id).toBeNull();
  });

  it('caps 60 findings at 50 with truncated 10', async () => {
    const { uc } = setup({ listReviews: async () => [reviewFixture({ findings: many(60) })] });
    const v = (await uc({ repo: 'acme/web', pr: 7, detail: 'concise' })) as {
      runs: Array<{ findings: unknown[]; truncated: number }>;
    };
    expect(v.runs[0]!.findings).toHaveLength(50);
    expect(v.runs[0]!.truncated).toBe(10);
  });
});

describe('getFindings args', () => {
  it('rejects no args and repo without pr', async () => {
    const { uc } = setup();
    await expect(uc({ detail: 'concise' })).rejects.toBeInstanceOf(BadArgs);
    await expect(uc({ repo: 'acme/web', detail: 'concise' })).rejects.toBeInstanceOf(BadArgs);
  });
});
