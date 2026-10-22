import type { Agent, Repo } from '@devdigest/shared';
import {
  AgentAmbiguous,
  AgentDisabled,
  AgentNotFound,
  PrNotFound,
  RepoBadFormat,
  RepoNotFound,
} from '../domain/errors.js';
import type { DevDigestApi } from './ports.js';

export interface Resolver {
  repo(repo: string): Promise<Repo>;
  pull(repo: Repo, pr: number): Promise<{ id: string; number: number }>;
  agent(agent: string, o: { enabledOnly: boolean }): Promise<Agent>;
}

const REPO_FORMAT = /^[^/\s]+\/[^/\s]+$/;

export function createResolver(
  api: Pick<DevDigestApi, 'listRepos' | 'listPulls' | 'listAgents'>,
): Resolver {
  const pullCache = new Map<string, { id: string; number: number }>();

  return {
    async repo(repo) {
      if (!REPO_FORMAT.test(repo)) throw new RepoBadFormat(repo);
      const repos = await api.listRepos();
      const want = repo.toLowerCase();
      const hit = repos.find((r) => r.full_name.toLowerCase() === want);
      if (!hit) throw new RepoNotFound(repo, repos.map((r) => r.full_name));
      return hit;
    },

    async pull(repo, pr) {
      const key = `${repo.id}#${pr}`;
      const cached = pullCache.get(key);
      if (cached) return cached;
      const pulls = await api.listPulls(repo.id);
      const hit = pulls.find((p) => p.number === pr);
      if (!hit?.id) throw new PrNotFound(pr, repo.full_name);
      const value = { id: hit.id, number: hit.number };
      pullCache.set(key, value);
      return value;
    },

    async agent(agent, { enabledOnly }) {
      const agents = await api.listAgents();
      const want = agent.toLowerCase();
      const byId = agents.filter((a) => a.id.toLowerCase() === want);
      const matches = byId.length ? byId : agents.filter((a) => a.name.toLowerCase() === want);
      if (matches.length === 0) throw new AgentNotFound(agent);
      if (matches.length > 1) throw new AgentAmbiguous(agent, matches.map((a) => `${a.name} (${a.id})`));
      const hit = matches[0] as Agent;
      if (enabledOnly && !hit.enabled) throw new AgentDisabled(agent);
      return hit;
    },
  };
}
