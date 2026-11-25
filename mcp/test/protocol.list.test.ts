import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/compose.js';
import { agentFixture, fakeApi } from './fakes.js';

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(api = fakeApi()) {
  const server = createServer({ baseUrl: 'http://localhost:3001' }, { api });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 't', version: '0' });
  await client.connect(b);
  return client;
}

describe('tools/list', () => {
  it('exposes exactly the five tools within budget', async () => {
    const c = await connect();
    const list = await c.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
    );
    for (const t of list.tools) {
      const sentences = (t.description ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(3);
      for (const p of Object.values((t.inputSchema.properties ?? {}) as Record<string, { type?: string }>)) {
        expect(['object', 'array']).not.toContain(p.type);
      }
      if (t.name === 'run_agent_on_pr') expect(t.annotations?.readOnlyHint).toBe(false);
      else expect(t.annotations?.readOnlyHint).toBe(true);
    }
    const instructions = c.getInstructions() ?? '';
    expect(instructions.split('\n').length).toBeLessThanOrEqual(4);
    expect(JSON.stringify(list).length + instructions.length).toBeLessThanOrEqual(6000);
  });

  it('list_agents goes through the use case', async () => {
    const c = await connect(fakeApi({ listAgents: async () => [agentFixture({ id: 'a1' })] }));
    const r = await c.callTool({ name: 'list_agents', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse((r.content as Array<{ text: string }>)[0]!.text)[0].id).toBe('a1');
  });

  it('SDK validates args before the handler runs (wrong type -> isError, handler not reached)', async () => {
    let called = 0;
    const c = await connect(fakeApi({ listRepos: async () => (called++, []) }));
    const r = await c.callTool({ name: 'get_blast_radius', arguments: { repo: 'a/b', pr: 'seven' } });
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('Invalid arguments for tool get_blast_radius');
    expect(called).toBe(0);
  });
});
