import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../src/adapters/http/api-client.js';
import { ApiError } from '../../../src/adapters/http/errors.js';
import { agentFixture, blastFixture, prFixture, repoFixture, runFixture } from '../../fakes.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const client = (f: typeof fetch) => createApiClient({ baseUrl: 'http://api.test/', fetch: f });

describe('api-client', () => {
  it('GET /agents parses agents', async () => {
    const f = vi.fn(async (..._a: [string, RequestInit]) => json([agentFixture()]));
    const out = await client(f as unknown as typeof fetch).listAgents();
    expect(out[0]?.id).toBe('agent-1');
    expect(f.mock.calls[0]?.[0]).toBe('http://api.test/agents');
    expect((f.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
  });

  it('GET /repos and /repos/:id/pulls', async () => {
    const f = vi.fn(async (u: unknown) =>
      String(u).endsWith('/repos') ? json([repoFixture()]) : json([prFixture()]),
    );
    const c = client(f as unknown as typeof fetch);
    expect((await c.listRepos())[0]?.full_name).toBe('acme/web');
    expect((await c.listPulls('repo-1'))[0]?.number).toBe(1);
    expect(f.mock.calls[1]?.[0]).toBe('http://api.test/repos/repo-1/pulls');
  });

  it('POST /pulls/:id/review sends {agentId}', async () => {
    const f = vi.fn(async (..._a: [string, RequestInit]) =>
      json({ pr_id: 'pr-1', runs: [{ run_id: 'r1', agent_id: 'a1', agent_name: 'Sec' }], reviews: [] }),
    );
    const out = await client(f as unknown as typeof fetch).startReview('pr-1', 'a1');
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(f.mock.calls[0]?.[0]).toBe('http://api.test/pulls/pr-1/review');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ agentId: 'a1' });
    expect(out.runs[0]?.run_id).toBe('r1');
  });

  it('GET /pulls/:id/runs, /reviews, /repos/:id/conventions', async () => {
    const f = vi.fn(async (u: unknown) => {
      const s = String(u);
      if (s.endsWith('/runs')) return json([runFixture()]);
      if (s.endsWith('/reviews')) return json([]);
      return json({ items: [], scan: null });
    });
    const c = client(f as unknown as typeof fetch);
    expect((await c.listRuns('pr-1'))[0]?.status).toBeDefined();
    expect(await c.listReviews('pr-1')).toEqual([]);
    expect((await c.listConventions('repo-1')).items).toEqual([]);
    expect(f.mock.calls.map((x) => x[0])).toEqual([
      'http://api.test/pulls/pr-1/runs',
      'http://api.test/pulls/pr-1/reviews',
      'http://api.test/repos/repo-1/conventions',
    ]);
  });

  it('GET /pulls/:id/blast-radius parses the body', async () => {
    const f = vi.fn(async (..._a: [string, RequestInit]) => json(blastFixture({ summary: 'x' })));
    const out = await client(f as unknown as typeof fetch).getBlastRadius('pr-1');
    expect(out.summary).toBe('x');
    expect(f.mock.calls[0]?.[0]).toBe('http://api.test/pulls/pr-1/blast-radius');
  });

  it('blast-radius malformed body -> ApiError http', async () => {
    const e = (await client((async () => json({ nope: 1 })) as unknown as typeof fetch)
      .getBlastRadius('pr-1')
      .catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.kind).toBe('http');
  });

  const failure = async (f: typeof fetch) =>
    (await client(f).listAgents().catch((e) => e)) as ApiError;

  it('network failure -> unreachable', async () => {
    const e = await failure((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.kind).toBe('unreachable');
    expect(e.url).toBe('http://api.test/agents');
  });

  it('abort on timeout -> unreachable', async () => {
    const f = ((_u: unknown, init: RequestInit) =>
      new Promise((_, rej) => {
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const e = await createApiClient({ baseUrl: 'http://api.test', fetch: f, timeoutMs: 5 })
      .listAgents()
      .catch((x) => x);
    expect(e.kind).toBe('unreachable');
  });

  it('404 -> not_found, 429 -> rate_limited', async () => {
    expect((await failure((async () => json({}, 404)) as unknown as typeof fetch)).kind).toBe('not_found');
    expect((await failure((async () => json({}, 429)) as unknown as typeof fetch)).kind).toBe('rate_limited');
  });

  it('500 uses error.message', async () => {
    const e = await failure((async () => json({ error: { message: 'boom' } }, 500)) as unknown as typeof fetch);
    expect(e.kind).toBe('http');
    expect(e.status).toBe(500);
    expect(e.message).toBe('boom');
  });
});
