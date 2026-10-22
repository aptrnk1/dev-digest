import { describe, expect, it, vi } from 'vitest';
import { runAgentOnPrTool } from '../../../../src/adapters/mcp/tools/run-agent-on-pr.js';
import { ApiError } from '../../../../src/adapters/http/errors.js';
import type { ToolExtra } from '../../../../src/adapters/mcp/result.js';

const extra = (o: Partial<ToolExtra> = {}): ToolExtra => ({
  signal: new AbortController().signal,
  sendNotification: async () => {},
  ...o,
});
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content[0]?.text ?? '';
const args = { repo: 'acme/web', pr: 1, agent: 'Security' };

describe('run_agent_on_pr tool', () => {
  it('applies defaults', async () => {
    const uc = vi.fn(async (_i: unknown) => ({ status: 'running' as const, run_id: 'r', hint: 'h' }));
    await runAgentOnPrTool(uc as never, 'http://x')(args, extra());
    expect(uc.mock.calls[0]![0]).toMatchObject({ timeoutS: 300, detail: 'concise' });
  });

  it('timeout_s 601 is a validation error', async () => {
    const uc = vi.fn();
    const res = await runAgentOnPrTool(uc, 'http://x')({ ...args, timeout_s: 601 }, extra());
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('invalid arguments');
    expect(uc).not.toHaveBeenCalled();
  });

  it('maps rate limit', async () => {
    const uc = async () => {
      throw new ApiError('rate_limited', '/pulls/p/review', 'too many', 429);
    };
    const res = await runAgentOnPrTool(uc, 'http://x')(args, extra());
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('rate limit hit');
  });

  it('sends progress notifications only with a progressToken', async () => {
    const send = vi.fn(async () => {});
    const uc = vi.fn(async (_i: unknown, ctx: { progress?: (p: number, t?: number) => Promise<void> }) => {
      await ctx.progress?.(3, 300);
      return { status: 'running' as const, run_id: 'r', hint: 'h' };
    });
    await runAgentOnPrTool(uc as never, 'http://x')(args, extra({ sendNotification: send }));
    expect(send).not.toHaveBeenCalled();
    await runAgentOnPrTool(uc as never, 'http://x')(args, extra({ sendNotification: send, _meta: { progressToken: 7 } }));
    expect(send).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 7, progress: 3, total: 300 },
    });
  });
});
