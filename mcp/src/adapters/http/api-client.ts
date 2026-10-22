import {
  Agent,
  ConventionsList,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';
import { z } from 'zod';
import type { DevDigestApi } from '../../app/ports.js';
import { ApiError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Error body of the server: `{ error: { message } }`. */
const extractMessage = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const err = (body as { error?: unknown }).error;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return undefined;
};

export function createApiClient(o: {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): DevDigestApi {
  const base = o.baseUrl.replace(/\/+$/, '');
  const doFetch = o.fetch ?? globalThis.fetch;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body?: unknown,
  ): Promise<T> {
    const url = `${base}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        signal: ctrl.signal,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
    } catch (err) {
      throw new ApiError('unreachable', url, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      const msg = extractMessage(json) ?? `HTTP ${res.status}`;
      const kind = res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : 'http';
      throw new ApiError(kind, url, msg, res.status);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError('http', url, `unexpected response shape: ${parsed.error.message}`, res.status);
    }
    return parsed.data;
  }

  return {
    listAgents: () => call('GET', '/agents', z.array(Agent)),
    listRepos: () => call('GET', '/repos', z.array(Repo)),
    listPulls: (repoId) => call('GET', `/repos/${encodeURIComponent(repoId)}/pulls`, z.array(PrMeta)),
    startReview: (prId, agentId) =>
      call('POST', `/pulls/${encodeURIComponent(prId)}/review`, ReviewRunResponse, { agentId }),
    listRuns: (prId) => call('GET', `/pulls/${encodeURIComponent(prId)}/runs`, z.array(RunSummary)),
    listReviews: (prId) => call('GET', `/pulls/${encodeURIComponent(prId)}/reviews`, z.array(ReviewRecord)),
    listConventions: (repoId) =>
      call('GET', `/repos/${encodeURIComponent(repoId)}/conventions`, ConventionsList),
  };
}
