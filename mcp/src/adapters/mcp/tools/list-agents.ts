import type { UseCases } from '../../../app/use-cases/index.js';
import { jsonResult, toErrorResult, type ToolHandler } from '../result.js';

export function listAgentsTool(uc: UseCases['listAgents'], baseUrl: string): ToolHandler {
  return async () => {
    try {
      return jsonResult(await uc());
    } catch (err) {
      return toErrorResult(err, baseUrl);
    }
  };
}
