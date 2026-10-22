import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/compose.js';
import type { RunStore } from '../src/app/ports.js';
import {
  agentFixture,
  conventionFixture,
  fakeApi,
  fakeClock,
  findingFixture,
  memoryRunStore,
  prFixture,
  repoFixture,
  reviewFixture,
  runFixture,
} from './fakes.js';

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(
  api = fakeApi(),
  overrides: Partial<{ sleep: () => Promise<void>; runs: RunStore }> = {},
) {
  const server = createServer({ baseUrl: 'http://localhost:3001' }, { api, ...overrides });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 't', version: '0' });
  await client.connect(b);
  return client;
}

function expectValidJson(text: string) {
  expect(text.length).toBeLessThanOrEqual(16000);
  return JSON.parse(text);
}

describe('tools/call', () => {
  it('list_agents returns parseable JSON with agent keys', async () => {
    const c = await connect(
      fakeApi({
        listAgents: async () => [
          agentFixture({ id: 'a1', name: 'Security', description: 'finds vulns' }),
          agentFixture({ id: 'a2', name: 'Style', enabled: false }),
        ],
      }),
    );
    const r = await c.callTool({ name: 'list_agents', arguments: {} });
    expect(r.isError).toBeFalsy();
    const result = expectValidJson((r.content as Array<{ text: string }>)[0]!.text);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('model');
  });

  it('run_agent_on_pr returns parseable JSON with run view keys', async () => {
    const repo = repoFixture({ full_name: 'acme/web' });
    const pr = prFixture({ number: 42 });
    const c = await connect(
      fakeApi({
        listRepos: async () => [repo],
        listPulls: async () => [pr],
        listAgents: async () => [agentFixture()],
        startReview: async (prId) => ({
          pr_id: prId,
          runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security' }],
          reviews: [],
        }),
        listRuns: async () => [runFixture({ status: 'done' })],
        listReviews: async () => [reviewFixture({ run_id: 'run-1' })],
      }),
      { sleep: async () => {} },
    );
    const r = await c.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/web', pr: 42, agent: 'Security', timeout_s: 5 },
    });
    expect(r.isError).toBeFalsy();
    const result = expectValidJson((r.content as Array<{ text: string }>)[0]!.text);
    expect(result).toHaveProperty('run_id');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('agent');
  });

  it('get_findings by run_id returns parseable JSON with findings', async () => {
    const runs = memoryRunStore();
    runs.remember('run-1', { prId: 'pr-1', repo: 'acme/web', pr: 1, agent: 'Security' });
    const c = await connect(
      fakeApi({
        listRepos: async () => [repoFixture()],
        listPulls: async () => [prFixture()],
        listAgents: async () => [agentFixture()],
        listRuns: async () => [runFixture({ run_id: 'run-1' })],
        listReviews: async () => [
          reviewFixture({
            run_id: 'run-1',
            findings: [findingFixture({ id: 'f1', severity: 'CRITICAL' })],
          }),
        ],
      }),
      { runs },
    );
    const r = await c.callTool({
      name: 'get_findings',
      arguments: { run_id: 'run-1', detail: 'concise' },
    });
    expect(r.isError).toBeFalsy();
    const result = expectValidJson((r.content as Array<{ text: string }>)[0]!.text);
    expect(result).toHaveProperty('run_id');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('status');
  });

  it('get_findings by repo+pr returns parseable JSON with runs', async () => {
    const c = await connect(
      fakeApi({
        listRepos: async () => [repoFixture()],
        listPulls: async () => [prFixture()],
        listAgents: async () => [agentFixture()],
        listRuns: async () => [runFixture()],
        listReviews: async () => [reviewFixture({ findings: [findingFixture()] })],
      }),
    );
    const r = await c.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/web', pr: 1, detail: 'full' },
    });
    expect(r.isError).toBeFalsy();
    const result = expectValidJson((r.content as Array<{ text: string }>)[0]!.text);
    expect(result).toHaveProperty('repo');
    expect(result).toHaveProperty('pr');
    expect(result).toHaveProperty('runs');
    expect(Array.isArray(result.runs)).toBe(true);
  });

  it('get_conventions returns parseable JSON with conventions', async () => {
    const c = await connect(
      fakeApi({
        listRepos: async () => [repoFixture()],
        listConventions: async () => ({
          scan: null,
          items: [
            conventionFixture({ category: 'naming', status: 'accepted' }),
            conventionFixture({ category: 'typing', status: 'accepted' }),
          ],
        }),
      }),
    );
    const r = await c.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/web' },
    });
    expect(r.isError).toBeFalsy();
    const result = expectValidJson((r.content as Array<{ text: string }>)[0]!.text);
    expect(result).toHaveProperty('repo');
    expect(result).toHaveProperty('conventions');
    expect(Array.isArray(result.conventions)).toBe(true);
  });

  it('get_conventions with category filter returns parseable JSON', async () => {
    const c = await connect(
      fakeApi({
        listRepos: async () => [repoFixture()],
        listConventions: async () => ({
          scan: null,
          items: [
            conventionFixture({ category: 'naming', status: 'accepted' }),
            conventionFixture({ category: 'typing', status: 'accepted' }),
          ],
        }),
      }),
    );
    const r = await c.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/web', category: 'naming' },
    });
    expect(r.isError).toBeFalsy();
    const result = expectValidJson((r.content as Array<{ text: string }>)[0]!.text);
    expect(result.conventions).toHaveLength(1);
    expect(result.conventions[0].category).toBe('naming');
  });

  it('get_blast_radius returns not_implemented status', async () => {
    const c = await connect();
    const r = await c.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/web', pr: 1 },
    });
    expect(r.isError).toBeFalsy();
    const result = expectValidJson((r.content as Array<{ text: string }>)[0]!.text);
    expect(result).toHaveProperty('status');
    expect(result.status).toBe('not_implemented');
    expect(result).toHaveProperty('hint');
  });

  it('unknown repo returns isError:true', async () => {
    const c = await connect(fakeApi({ listRepos: async () => [] }));
    const r = await c.callTool({
      name: 'get_conventions',
      arguments: { repo: 'unknown/repo' },
    });
    expect(r.isError).toBe(true);
  });

  it('all tool responses are within 16k char budget', async () => {
    const manyFindings = Array.from({ length: 60 }, (_, k) =>
      findingFixture({ id: `f${k}`, start_line: k + 1 }),
    );
    const c = await connect(
      fakeApi({
        listRepos: async () => [repoFixture()],
        listPulls: async () => [prFixture()],
        listAgents: async () => [agentFixture()],
        listRuns: async () => [runFixture()],
        listReviews: async () => [reviewFixture({ findings: manyFindings })],
        listConventions: async () => ({
          scan: null,
          items: Array.from({ length: 70 }, (_, k) =>
            conventionFixture({ id: `c${k}`, category: 'naming' }),
          ),
        }),
      }),
      { sleep: async () => {} },
    );

    const tools = [
      { name: 'list_agents', arguments: {} },
      { name: 'get_blast_radius', arguments: { repo: 'acme/web', pr: 1 } },
      { name: 'get_findings', arguments: { repo: 'acme/web', pr: 1, detail: 'full' } },
      { name: 'get_conventions', arguments: { repo: 'acme/web' } },
    ];

    for (const tool of tools) {
      const r = await c.callTool(tool);
      const text = (r.content as Array<{ text: string }>)[0]!.text;
      expect(text.length).toBeLessThanOrEqual(16000);
    }
  });
});
