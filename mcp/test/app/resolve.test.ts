import { describe, expect, it, vi } from 'vitest';
import { createResolver } from '../../src/app/resolve.js';
import {
  AgentAmbiguous,
  AgentDisabled,
  AgentNotFound,
  PrNotFound,
  RepoBadFormat,
  RepoNotFound,
} from '../../src/domain/errors.js';
import { agentFixture, fakeApi, prFixture, repoFixture } from '../fakes.js';

describe('resolver.repo', () => {
  const api = fakeApi({ listRepos: async () => [repoFixture(), repoFixture({ id: 'r2', full_name: 'acme/api' })] });

  it('matches case-insensitively', async () => {
    expect((await createResolver(api).repo('ACME/Web')).id).toBe('repo-1');
  });

  it('unknown repo lists at most 10 known names', async () => {
    const many = Array.from({ length: 15 }, (_, i) => repoFixture({ id: `r${i}`, full_name: `o/n${i}` }));
    const r = createResolver(fakeApi({ listRepos: async () => many }));
    const err = await r.repo('x/y').catch((e) => e);
    expect(err).toBeInstanceOf(RepoNotFound);
    expect(err.message).toContain('o/n9');
    expect(err.message).not.toContain('o/n10');
  });

  it('rejects a bare name', async () => {
    await expect(createResolver(api).repo('shop')).rejects.toBeInstanceOf(RepoBadFormat);
  });
});

describe('resolver.pull', () => {
  it('finds a PR and caches it', async () => {
    const listPulls = vi.fn(async () => [prFixture({ id: 'p7', number: 7 })]);
    const r = createResolver(fakeApi({ listPulls }));
    const repo = repoFixture();
    expect(await r.pull(repo, 7)).toEqual({ id: 'p7', number: 7 });
    await r.pull(repo, 7);
    expect(listPulls).toHaveBeenCalledTimes(1);
  });

  it('PrNotFound', async () => {
    const r = createResolver(fakeApi({ listPulls: async () => [] }));
    await expect(r.pull(repoFixture(), 9)).rejects.toBeInstanceOf(PrNotFound);
  });
});

describe('resolver.agent', () => {
  const agents = [
    agentFixture({ id: 'a1', name: 'Security' }),
    agentFixture({ id: 'a2', name: 'Perf' }),
    agentFixture({ id: 'a3', name: 'perf' }),
    agentFixture({ id: 'a4', name: 'Off', enabled: false }),
  ];
  const r = createResolver(fakeApi({ listAgents: async () => agents }));

  it('by id and by name, case-insensitive', async () => {
    expect((await r.agent('A1', { enabledOnly: true })).id).toBe('a1');
    expect((await r.agent('security', { enabledOnly: true })).id).toBe('a1');
  });
  it('ambiguous name', async () => {
    await expect(r.agent('perf', { enabledOnly: true })).rejects.toBeInstanceOf(AgentAmbiguous);
  });
  it('not found', async () => {
    await expect(r.agent('zzz', { enabledOnly: true })).rejects.toBeInstanceOf(AgentNotFound);
  });
  it('disabled only rejected with enabledOnly', async () => {
    await expect(r.agent('off', { enabledOnly: true })).rejects.toBeInstanceOf(AgentDisabled);
    expect((await r.agent('off', { enabledOnly: false })).id).toBe('a4');
  });
});
