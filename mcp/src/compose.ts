import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApiClient } from './adapters/http/api-client.js';
import { SERVER_INSTRUCTIONS } from './adapters/mcp/definitions.js';
import { registerTools } from './adapters/mcp/register.js';
import { RunRegistry } from './adapters/memory/run-registry.js';
import type { Clock, DevDigestApi, RunStore, Sleeper } from './app/ports.js';
import { createResolver } from './app/resolve.js';
import { makeGetBlastRadius } from './app/use-cases/get-blast-radius.js';
import { makeGetConventions } from './app/use-cases/get-conventions.js';
import { makeGetFindings } from './app/use-cases/get-findings.js';
import type { UseCases } from './app/use-cases/index.js';
import { makeListAgents } from './app/use-cases/list-agents.js';
import { makeRunReview } from './app/use-cases/run-review.js';

const realSleep: Sleeper = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/** Composition root: wires adapters, use cases and the MCP server. */
export function createServer(
  config: { baseUrl: string },
  overrides: Partial<{ api: DevDigestApi; runs: RunStore; sleep: Sleeper; now: Clock }> = {},
): McpServer {
  const api = overrides.api ?? createApiClient({ baseUrl: config.baseUrl });
  const runs = overrides.runs ?? new RunRegistry();
  const sleep = overrides.sleep ?? realSleep;
  const now = overrides.now ?? Date.now;
  const resolver = createResolver(api);

  const useCases: UseCases = {
    listAgents: makeListAgents({ api }),
    runReview: makeRunReview({ api, resolver, runs, sleep, now }),
    getFindings: makeGetFindings({ api, resolver, runs }),
    getConventions: makeGetConventions({ api, resolver }),
    getBlastRadius: makeGetBlastRadius(),
  };

  const server = new McpServer({ name: 'devdigest', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, useCases, config.baseUrl);
  return server;
}
