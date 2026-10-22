import type { CallToolResult, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors.js';
import { ApiError } from '../http/errors.js';

/** Subset of the SDK's request-handler extra that tool adapters use. */
export interface ToolExtra {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (n: ServerNotification) => Promise<void>;
}

/** Tool callback; avoids the SDK's deeply generic `ToolCallback<ZodRawShape>` type. */
export type ToolHandler = (args: Record<string, unknown>, extra: ToolExtra) => Promise<CallToolResult>;

export function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

const errorResult = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

export function toErrorResult(err: unknown, baseUrl: string): CallToolResult {
  if (err instanceof DomainError) return errorResult(err.message);
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ');
    return errorResult(`invalid arguments (${issues}); check the tool's input schema`);
  }
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'unreachable':
        return errorResult(`DevDigest API is not responding at ${baseUrl}; start it with ./scripts/dev.sh`);
      case 'rate_limited':
        return errorResult('rate limit hit (POST /pulls/:id/review allows 10/min); retry in a minute');
      case 'not_found':
        return errorResult(`DevDigest API returned 404 for ${err.url}; check repo, PR and run ids`);
      default:
        return errorResult(`DevDigest API error${err.status ? ` ${err.status}` : ''}: ${err.message}`);
    }
  }
  console.error('[devdigest-mcp] unexpected error:', err);
  return errorResult('unexpected error in the DevDigest MCP server; see the server log (stderr)');
}
