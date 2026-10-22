import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UseCases } from '../../app/use-cases/index.js';
import { TOOL_DEFS, type ToolName } from './definitions.js';
import type { ToolHandler } from './result.js';
import { getBlastRadiusTool } from './tools/get-blast-radius.js';
import { getConventionsTool } from './tools/get-conventions.js';
import { getFindingsTool } from './tools/get-findings.js';
import { listAgentsTool } from './tools/list-agents.js';
import { runAgentOnPrTool } from './tools/run-agent-on-pr.js';

// registerTool's generic over ZodRawShape blows the type-instantiation depth when the shape is
// not a literal; the shapes are validated by the tool adapters, so a loose structural view is used.
interface LooseRegistrar {
  registerTool(name: string, config: (typeof TOOL_DEFS)[ToolName], cb: ToolHandler): unknown;
}

export function registerTools(server: McpServer, uc: UseCases, baseUrl: string): void {
  const reg = (name: ToolName, cb: ToolHandler): void => {
    (server as unknown as LooseRegistrar).registerTool(name, TOOL_DEFS[name], cb);
  };
  reg('list_agents', listAgentsTool(uc.listAgents, baseUrl));
  reg('run_agent_on_pr', runAgentOnPrTool(uc.runReview, baseUrl));
  reg('get_findings', getFindingsTool(uc.getFindings, baseUrl));
  reg('get_conventions', getConventionsTool(uc.getConventions, baseUrl));
  reg('get_blast_radius', getBlastRadiusTool(uc.getBlastRadius, baseUrl));
}
