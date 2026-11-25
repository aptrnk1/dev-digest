import { describe, expect, it } from 'vitest';
import { getBlastRadiusTool } from '../../../../src/adapters/mcp/tools/get-blast-radius.js';
import type { ToolExtra } from '../../../../src/adapters/mcp/result.js';
import { makeGetBlastRadius } from '../../../../src/app/use-cases/get-blast-radius.js';
import { createResolver } from '../../../../src/app/resolve.js';
import { blastFixture, fakeApi, prFixture, repoFixture } from '../../../fakes.js';

const extra: ToolExtra = { signal: new AbortController().signal, sendNotification: async () => {} };
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content[0]?.text ?? '';

describe('getBlastRadiusTool', () => {
  const api = fakeApi({
    listRepos: async () => [repoFixture({ full_name: 'acme/web' })],
    listPulls: async () => [prFixture({ number: 3 })],
    getBlastRadius: async () => blastFixture({ summary: 'ok' }),
  });
  const tool = getBlastRadiusTool(makeGetBlastRadius({ api, resolver: createResolver(api) }), 'http://x');

  it('maps args to the use case and returns JSON', async () => {
    const r = await tool({ repo: 'acme/web', pr: 3 }, extra);
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(text(r))).toMatchObject({ repo: 'acme/web', pr: 3, summary: 'ok' });
  });

  it('returns an error result for an unknown repo', async () => {
    const r = await tool({ repo: 'nope/x', pr: 3 }, extra);
    expect(r.isError).toBe(true);
  });
});
