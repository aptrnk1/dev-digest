import { z } from 'zod';
import type { UseCases } from '../../../app/use-cases/index.js';
import { TOOL_DEFS } from '../definitions.js';
import { jsonResult, toErrorResult, type ToolHandler } from '../result.js';

const Args = z.object(TOOL_DEFS.get_findings.inputSchema);

// get_findings: flat args → use case → compact JSON; errors mapped at the edge.
export function getFindingsTool(uc: UseCases['getFindings'], baseUrl: string): ToolHandler {
  return async (args) => {
    try {
      const a = Args.parse(args);
      const view = await uc({
        ...(a.run_id ? { runId: a.run_id } : {}),
        ...(a.repo ? { repo: a.repo } : {}),
        ...(a.pr ? { pr: a.pr } : {}),
        ...(a.agent ? { agent: a.agent } : {}),
        ...(a.severity_min ? { severityMin: a.severity_min } : {}),
        detail: a.detail ?? 'concise',
      });
      return jsonResult(view);
    } catch (err) {
      return toErrorResult(err, baseUrl);
    }
  };
}
