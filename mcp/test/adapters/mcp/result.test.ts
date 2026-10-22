import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../../../src/adapters/http/errors.js';
import { jsonResult, toErrorResult } from '../../../src/adapters/mcp/result.js';
import {
  AgentAmbiguous,
  AgentDisabled,
  AgentNotFound,
  BadArgs,
  PrNotFound,
  RepoBadFormat,
  RepoNotFound,
  RunFailed,
  RunUnknown,
  type DomainError,
} from '../../../src/domain/errors.js';

const text = (r: ReturnType<typeof toErrorResult>) => (r.content[0] as { text: string }).text;
const URL = 'http://localhost:3001';

describe('toErrorResult', () => {
  const errors: DomainError[] = [
    new RepoNotFound('x/y', ['a/b']),
    new RepoBadFormat('shop'),
    new PrNotFound(7, 'a/b'),
    new AgentNotFound('z'),
    new AgentAmbiguous('z', ['1', '2']),
    new AgentDisabled('z'),
    new RunUnknown(),
    new RunFailed('failed', 'boom'),
    new BadArgs('x'),
  ];
  it.each(errors.map((e) => [e.code, e] as const))('maps DomainError %s', (_c, e) => {
    const r = toErrorResult(e, URL);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(e.message);
  });

  it('maps ApiError kinds', () => {
    const u = toErrorResult(new ApiError('unreachable', `${URL}/agents`, 'ECONNREFUSED'), URL);
    expect(u.isError).toBe(true);
    expect(text(u)).toBe(`DevDigest API is not responding at ${URL}; start it with ./scripts/dev.sh`);
    expect(text(toErrorResult(new ApiError('rate_limited', 'u', 'm', 429), URL))).toBe(
      'rate limit hit (POST /pulls/:id/review allows 10/min); retry in a minute',
    );
    expect(toErrorResult(new ApiError('not_found', `${URL}/x`, 'nf', 404), URL).isError).toBe(true);
    const h = toErrorResult(new ApiError('http', 'u', 'server said no', 500), URL);
    expect(h.isError).toBe(true);
    expect(text(h)).toContain('server said no');
  });

  it('maps ZodError to an invalid-arguments hint naming the field', () => {
    const parsed = z.object({ pr: z.number().int() }).safeParse({ pr: 'x' });
    if (parsed.success) throw new Error('expected a parse failure');
    const r = toErrorResult(parsed.error, URL);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^invalid arguments \(pr: /);
  });

  it('maps unknown errors to a generic message and logs to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = toErrorResult(new Error('secret internals'), URL);
    expect(r.isError).toBe(true);
    expect(text(r)).not.toContain('secret internals');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('jsonResult', () => {
  it('is one compact JSON text block', () => {
    const r = jsonResult({ a: 1, b: [2] });
    expect(r.isError).toBeUndefined();
    expect(r.content).toEqual([{ type: 'text', text: '{"a":1,"b":[2]}' }]);
  });
});
