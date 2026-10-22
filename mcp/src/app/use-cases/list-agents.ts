import type { DevDigestApi } from '../ports.js';

export interface AgentView {
  id: string;
  name: string;
  description?: string;
  model: string;
}

/** Enabled agents only, in a compact shape. */
export function makeListAgents(deps: { api: Pick<DevDigestApi, 'listAgents'> }): () => Promise<AgentView[]> {
  return async () => {
    const agents = await deps.api.listAgents();
    return agents
      .filter((a) => a.enabled === true)
      .map((a): AgentView => {
        const view: AgentView = { id: a.id, name: a.name, model: a.model };
        if (a.description) view.description = a.description;
        return view;
      });
  };
}
