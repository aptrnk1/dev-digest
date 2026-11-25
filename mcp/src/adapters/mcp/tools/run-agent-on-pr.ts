import { z } from 'zod';
import type { UseCases } from '../../../app/use-cases/index.js';
import { DEFAULT_TIMEOUT_S, TOOL_DEFS } from '../definitions.js';
import type { ProgressSink } from '../../../app/ports.js';
import { jsonResult, toErrorResult, type ToolExtra, type ToolHandler } from '../result.js';

const Args = z.object(TOOL_DEFS.run_agent_on_pr.inputSchema);

function progressSink(token: string | number, send: ToolExtra['sendNotification']): ProgressSink {
  return async (progress, total) => {
    try {
      await send({
        method: 'notifications/progress',
        params: { progressToken: token, progress, ...(total !== undefined ? { total } : {}) },
      });
    } catch {
      // progress is best-effort; a closed transport must not fail the run
    }
  };
}

export function runAgentOnPrTool(uc: UseCases['runReview'], baseUrl: string): ToolHandler {
  return async (args, extra) => {
    try {
      const a = Args.parse(args);
      const token = extra._meta?.progressToken;
      const view = await uc(
        {
          repo: a.repo,
          pr: a.pr,
          agent: a.agent,
          timeoutS: a.timeout_s ?? DEFAULT_TIMEOUT_S,
          ...(a.severity_min ? { severityMin: a.severity_min } : {}),
          detail: a.detail ?? 'concise',
        },
        {
          signal: extra.signal,
          ...(token !== undefined ? { progress: progressSink(token, extra.sendNotification) } : {}),
        },
      );
      return jsonResult(view);
    } catch (err) {
      return toErrorResult(err, baseUrl);
    }
  };
}
