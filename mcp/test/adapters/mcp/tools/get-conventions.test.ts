import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getConventionsTool } from '../../../../src/adapters/mcp/tools/get-conventions.js';
import type { ToolExtra } from '../../../../src/adapters/mcp/result.js';
import { ConventionCategory } from '@devdigest/shared';
import { makeGetConventions } from '../../../../src/app/use-cases/get-conventions.js';
import { createResolver } from '../../../../src/app/resolve.js';
import { conventionFixture, fakeApi, repoFixture } from '../../../fakes.js';

const extra = (o: Partial<ToolExtra> = {}): ToolExtra => ({
  signal: new AbortController().signal,
  sendNotification: async () => {},
  ...o,
});
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content[0]?.text ?? '';

describe('getConventionsTool', () => {
  it('accepts valid args and returns parsed JSON', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({
        scan: null,
        items: [
          conventionFixture({ category: 'naming', status: 'accepted' }),
          conventionFixture({ category: 'typing', status: 'accepted' }),
        ],
      }),
    });
    const uc = makeGetConventions({ api, resolver: createResolver(api) });
    const tool = getConventionsTool(uc, 'http://localhost:3001');
    const result = await tool({ repo: 'acme/web' }, extra());
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(text(result));
    expect(parsed.repo).toBe('acme/web');
    expect(parsed.conventions).toHaveLength(2);
  });

  it('accepts optional category filter', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({
        scan: null,
        items: [
          conventionFixture({ category: 'naming', status: 'accepted' }),
          conventionFixture({ category: 'typing', status: 'accepted' }),
        ],
      }),
    });
    const uc = makeGetConventions({ api, resolver: createResolver(api) });
    const tool = getConventionsTool(uc, 'http://localhost:3001');
    const result = await tool({ repo: 'acme/web', category: 'naming' as ConventionCategory }, extra());
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(text(result));
    expect(parsed.conventions).toHaveLength(1);
  });

  it('returns isError for invalid category', async () => {
    const repo = repoFixture({ id: 'r1', full_name: 'acme/web' });
    const api = fakeApi({
      listRepos: async () => [repo],
      listConventions: async () => ({ scan: null, items: [] }),
    });
    const uc = makeGetConventions({ api, resolver: createResolver(api) });
    const tool = getConventionsTool(uc, 'http://localhost:3001');
    const result = await tool({ repo: 'acme/web', category: 'invalid_category' }, extra());
    expect(result.isError).toBe(true);
  });

  it('returns isError and helpful message for unknown repo', async () => {
    const api = fakeApi({
      listRepos: async () => [repoFixture({ id: 'r1', full_name: 'other/repo' })],
    });
    const uc = makeGetConventions({ api, resolver: createResolver(api) });
    const tool = getConventionsTool(uc, 'http://localhost:3001');
    const result = await tool({ repo: 'unknown/repo' }, extra());
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('not found');
  });
});
