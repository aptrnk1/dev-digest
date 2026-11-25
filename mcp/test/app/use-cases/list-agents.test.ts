import { describe, expect, it } from 'vitest';
import { makeListAgents } from '../../../src/app/use-cases/list-agents.js';
import { agentFixture, fakeApi } from '../../fakes.js';

describe('listAgents', () => {
  it('returns only enabled agents as {id,name,description?,model}', async () => {
    const api = fakeApi({
      listAgents: async () => [
        agentFixture({ id: 'a1', name: 'Sec', description: 'finds vulns', model: 'm1' }),
        agentFixture({ id: 'a2', name: 'Off', enabled: false }),
        agentFixture({ id: 'a3', name: 'Style', description: '', model: 'm3' }),
      ],
    });
    expect(await makeListAgents({ api })()).toEqual([
      { id: 'a1', name: 'Sec', description: 'finds vulns', model: 'm1' },
      { id: 'a3', name: 'Style', model: 'm3' },
    ]);
  });
});
