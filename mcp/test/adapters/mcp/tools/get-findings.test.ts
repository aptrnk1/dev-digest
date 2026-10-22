import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../../src/compose.js';
import {
  agentFixture,
  fakeApi,
  findingFixture,
  prFixture,
  repoFixture,
  reviewFixture,
  runFixture,
} from '../../../fakes.js';

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function call(args: Record<string, unknown>) {
  const api = fakeApi({
    listAgents: async () => [agentFixture()],
    listRepos: async () => [repoFixture()],
    listPulls: async () => [prFixture({ number: 7 })],
    listRuns: async () => [runFixture({ run_id: 'r1' })],
    listReviews: async () => [
      reviewFixture({
        run_id: 'r1',
        findings: [
          findingFixture({ id: 'c', severity: 'CRITICAL', rationale: 'deep reason' }),
          findingFixture({ id: 's', severity: 'SUGGESTION' }),
        ],
      }),
    ],
  });
  const server = createServer({ baseUrl: 'http://localhost:3001' }, { api });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 't', version: '0' });
  await client.connect(b);
  const r = await client.callTool({ name: 'get_findings', arguments: args });
  return { isError: r.isError, text: (r.content as Array<{ text: string }>)[0]!.text };
}

describe('get_findings tool', () => {
  it('maps run_id, severity_min and detail', async () => {
    const r = await call({ run_id: 'r1', repo: 'acme/web', pr: 7, severity_min: 'CRITICAL', detail: 'full' });
    expect(r.isError).toBeFalsy();
    const v = JSON.parse(r.text);
    expect(v.run_id).toBe('r1');
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0].rationale).toBe('deep reason');
    expect(v.counts_by_severity.SUGGESTION).toBe(1);
  });

  it('returns isError with usage on bad args', async () => {
    const r = await call({});
    expect(r.isError).toBe(true);
    expect(r.text).toContain('run_id');
  });
});
