import { z } from 'zod';
import type { UseCases } from '../../../app/use-cases/index.js';
import { TOOL_DEFS } from '../definitions.js';
import { jsonResult, toErrorResult, type ToolHandler } from '../result.js';

const Args = z.object(TOOL_DEFS.get_blast_radius.inputSchema);

export function getBlastRadiusTool(uc: UseCases['getBlastRadius'], baseUrl: string): ToolHandler {
  return async (args) => {
    try {
      const a = Args.parse(args);
      return jsonResult(await uc({ repo: a.repo, pr: a.pr }));
    } catch (err) {
      return toErrorResult(err, baseUrl);
    }
  };
}
