import { z } from 'zod';
import type { UseCases } from '../../../app/use-cases/index.js';
import { TOOL_DEFS } from '../definitions.js';
import { jsonResult, toErrorResult, type ToolHandler } from '../result.js';

const Args = z.object(TOOL_DEFS.get_conventions.inputSchema);

// get_conventions: flat args → use case → compact JSON; errors mapped at the edge.
export function getConventionsTool(uc: UseCases['getConventions'], baseUrl: string): ToolHandler {
  return async (args) => {
    try {
      const a = Args.parse(args);
      const view = await uc({
        repo: a.repo,
        ...(a.category ? { category: a.category } : {}),
      });
      return jsonResult(view);
    } catch (err) {
      return toErrorResult(err, baseUrl);
    }
  };
}
