import { describe, expect, it } from 'vitest';
import { makeGetConventions } from '../../../src/app/use-cases/get-conventions.js';
import { createResolver } from '../../../src/app/resolve.js';
import { RepoNotFound } from '../../../src/domain/errors.js';
import { MAX_RESPONSE_CHARS } from '../../../src/domain/findings.js';
import { conventionFixture, fakeApi, repoFixture } from '../../fakes.js';

describe('getConventions', () => {
  it('returns only accepted conventions, filtered by category', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({
        scan: null,
        items: [
          conventionFixture({ category: 'naming', status: 'accepted' }),
          conventionFixture({ category: 'typing', status: 'accepted' }),
          conventionFixture({ category: 'naming', status: 'pending' }),
          conventionFixture({ category: 'naming', status: 'rejected' }),
        ],
      }),
    });
    const resolver = createResolver(api);
    const uc = makeGetConventions({ api, resolver });
    const view = await uc({ repo: 'acme/web', category: 'naming' });
    expect(view.repo).toBe('acme/web');
    expect(view.conventions).toHaveLength(1);
    expect(view.conventions[0]?.category).toBe('naming');
    expect(view.hint).toBeUndefined();
    expect(view.truncated).toBeUndefined();
  });

  it('returns empty with a hint when no conventions exist', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({ scan: null, items: [] }),
    });
    const resolver = createResolver(api);
    const uc = makeGetConventions({ api, resolver });
    const view = await uc({ repo: 'acme/web' });
    expect(view.conventions).toHaveLength(0);
    expect(view.hint).toContain('run extraction in the UI');
    expect(view.hint).toContain('Skills Lab');
  });

  it('returns a hint when a scan is running', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({
        scan: {
          id: 'scan-1',
          status: 'running',
          files_sampled: 0,
          error: null,
          started_at: '2026-01-01T00:00:00Z',
          finished_at: null,
        },
        items: [],
      }),
    });
    const resolver = createResolver(api);
    const uc = makeGetConventions({ api, resolver });
    const view = await uc({ repo: 'acme/web' });
    expect(view.conventions).toHaveLength(0);
    expect(view.hint).toContain('extraction is in progress');
  });

  it('limits to 60 conventions and sets truncated', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const conventions = Array.from({ length: 70 }, (_, i) =>
      conventionFixture({ id: `c${i}`, status: 'accepted' }),
    );
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({ scan: null, items: conventions }),
    });
    const resolver = createResolver(api);
    const uc = makeGetConventions({ api, resolver });
    const view = await uc({ repo: 'acme/web' });
    expect(view.conventions).toHaveLength(60);
    expect(view.truncated).toBe(10);
    expect(view.hint).toContain('pass category');
  });

  it('drops tail conventions until the response fits the char budget', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const items = Array.from({ length: 40 }, () => conventionFixture({ status: 'accepted', rule: 'x'.repeat(1000) }));
    const api = fakeApi({ listRepos: async () => [repo], listConventions: async () => ({ scan: null, items }) });
    const view = await makeGetConventions({ api, resolver: createResolver(api) })({ repo: 'acme/web' });
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(view.conventions.length + (view.truncated ?? 0)).toBe(40);
    expect(view.hint).toContain('pass category');
  });

  it('throws RepoNotFound for unknown repo', async () => {
    const api = fakeApi({
      listRepos: async () => [repoFixture({ id: 'r1', full_name: 'other/repo' })],
    });
    const resolver = createResolver(api);
    const uc = makeGetConventions({ api, resolver });
    await expect(uc({ repo: 'unknown/repo' })).rejects.toThrow(RepoNotFound);
  });

  it('maps evidence_path and evidence_line to path and line', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({
        scan: null,
        items: [
          conventionFixture({
            status: 'accepted',
            evidence_path: 'src/style.ts',
            evidence_line: 42,
          }),
        ],
      }),
    });
    const resolver = createResolver(api);
    const uc = makeGetConventions({ api, resolver });
    const view = await uc({ repo: 'acme/web' });
    expect(view.conventions[0]?.path).toBe('src/style.ts');
    expect(view.conventions[0]?.line).toBe(42);
  });
});
