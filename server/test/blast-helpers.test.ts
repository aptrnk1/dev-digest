import { describe, it, expect } from 'vitest';
import { BlastRadiusResponse } from '@devdigest/shared';
import { deriveDegraded, toBlastRadiusResponse } from '../src/modules/blast/helpers.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';

const state = (over: Partial<IndexState> = {}): IndexState => ({
  repoId: 'r1',
  status: 'full',
  filesIndexed: 1,
  filesSkipped: 0,
  durationMs: 1,
  lastIndexedSha: 'abc123',
  indexerVersion: 1,
  updatedAt: new Date(0),
  ...over,
});

const result = (over: Partial<BlastResult> = {}): BlastResult => ({
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  ...over,
});

const row = (viaSymbol: string, file: string, line: number, symbol = 'caller', rank = 0) => ({
  viaSymbol,
  file,
  line,
  symbol,
  rank,
});

const map = (r: BlastResult, s = state(), enabled = true) =>
  toBlastRadiusResponse({ prId: 'p1', result: r, state: s, repoIntelEnabled: enabled });

describe('toBlastRadiusResponse', () => {
  it('groups callers by viaSymbol; caller name = row symbol; symbols without callers are absent', () => {
    const out = map(
      result({
        changedSymbols: [
          { name: 'a', file: 'a.ts', kind: 'function' },
          { name: 'b', file: 'b.ts', kind: 'function' },
        ],
        callers: [row('a', 'x.ts', 3, 'doX')],
      }),
    );
    expect(out.downstream).toEqual([
      { symbol: 'a', callers: [{ name: 'doX', file: 'x.ts', line: 3 }], endpoints_affected: [], crons_affected: [] },
    ]);
    expect(out.changed_symbols.map((s) => s.name)).toEqual(['a', 'b']);
    expect(BlastRadiusResponse.safeParse(out).success).toBe(true);
  });

  it('dedupes same file+line within a symbol but keeps the caller under two symbols', () => {
    const out = map(
      result({ callers: [row('a', 'x.ts', 3), row('a', 'x.ts', 3), row('b', 'x.ts', 3)] }),
    );
    expect(out.downstream.find((d) => d.symbol === 'a')?.callers).toHaveLength(1);
    expect(out.downstream.find((d) => d.symbol === 'b')?.callers).toHaveLength(1);
    expect(out.stats.callers).toBe(2);
  });

  it('sorts callers by rank desc, file, line; groups by count desc then symbol', () => {
    const out = map(
      result({
        callers: [
          row('z', 'a.ts', 1),
          row('m', 'b.ts', 9, 'c', 1),
          row('m', 'a.ts', 5, 'c', 1),
          row('m', 'a.ts', 2, 'c', 1),
          row('m', 'z.ts', 1, 'c', 5),
          row('b', 'a.ts', 1),
        ],
      }),
    );
    expect(out.downstream.map((d) => d.symbol)).toEqual(['m', 'b', 'z']);
    expect(out.downstream[0]?.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'z.ts:1',
      'a.ts:2',
      'a.ts:5',
      'b.ts:9',
    ]);
  });

  it('dedupes changed_symbols by name+file in input order', () => {
    const out = map(
      result({
        changedSymbols: [
          { name: 'a', file: 'a.ts', kind: 'function' },
          { name: 'a', file: 'a.ts', kind: 'function' },
          { name: 'a', file: 'b.ts', kind: 'function' },
        ],
      }),
    );
    expect(out.changed_symbols.map((s) => s.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('unions per-symbol endpoints/crons from factsByFile (deduped, sorted); absent facts -> []', () => {
    const callers = [row('a', 'x.ts', 1), row('a', 'y.ts', 1), row('b', 'x.ts', 2)];
    const withFacts = map(
      result({
        callers,
        factsByFile: {
          'x.ts': { endpoints: ['POST /b', 'GET /a'], crons: ['0 * * * *'] },
          'y.ts': { endpoints: ['GET /a'], crons: ['job:z'] },
        },
        impactedEndpoints: ['IGNORED'],
      }),
    );
    const a = withFacts.downstream.find((d) => d.symbol === 'a');
    expect(a?.endpoints_affected).toEqual(['GET /a', 'POST /b']);
    expect(a?.crons_affected).toEqual(['0 * * * *', 'job:z']);
    expect(withFacts.stats.endpoints).toBe(2);
    expect(withFacts.stats.crons).toBe(2);

    const noFacts = map(result({ callers, impactedEndpoints: ['GET /a'] }));
    expect(noFacts.downstream.every((d) => d.endpoints_affected.length === 0)).toBe(true);
    expect(noFacts.stats.endpoints).toBe(0);
  });

  it('computes stats and the exact summary, with and without degraded', () => {
    const r = result({
      changedSymbols: [{ name: 'a', file: 'a.ts', kind: 'function' }],
      callers: [row('a', 'x.ts', 1), row('a', 'y.ts', 1)],
      factsByFile: { 'x.ts': { endpoints: ['GET /a'], crons: [] } },
    });
    const ok = map(r);
    expect(ok.stats).toEqual({ symbols: 1, callers: 2, endpoints: 1, crons: 0 });
    expect(ok.summary).toBe('1 changed symbols · 2 callers · 1 endpoints · 0 crons');
    expect(ok.degraded).toBe(false);

    const bad = map(r, state({ status: 'partial' }));
    expect(bad.summary).toBe('1 changed symbols · 2 callers · 1 endpoints · 0 crons (index degraded: index_partial)');
    expect(bad.downstream).toHaveLength(1); // data still returned
    expect(bad.degraded_reason).toBe('index_partial');
  });

  it('index_sha: empty -> null', () => {
    expect(map(result(), state({ lastIndexedSha: '' })).index_sha).toBeNull();
    expect(map(result()).index_sha).toBe('abc123');
    expect(map(result()).pr_id).toBe('p1');
  });
});

describe('deriveDegraded precedence', () => {
  const none = { degraded: false, reason: null };
  it('flag off wins over everything', () => {
    expect(
      deriveDegraded({ repoIntelEnabled: false, state: state({ degraded: true }), result: result({ degraded: true }) }),
    ).toEqual({ degraded: true, reason: 'flag_off' });
  });
  it('state.degraded uses degradedReason, defaulting to index_failed', () => {
    expect(
      deriveDegraded({
        repoIntelEnabled: true,
        state: state({ degraded: true, degradedReason: 'repo_too_large' }),
        result: result(),
      }),
    ).toEqual({ degraded: true, reason: 'repo_too_large' });
    expect(deriveDegraded({ repoIntelEnabled: true, state: state({ degraded: true }), result: result() })).toEqual({
      degraded: true,
      reason: 'index_failed',
    });
  });
  it('partial status -> index_partial', () => {
    expect(deriveDegraded({ repoIntelEnabled: true, state: state({ status: 'partial' }), result: result() })).toEqual({
      degraded: true,
      reason: 'index_partial',
    });
  });
  it('result.degraded -> its reason, default no_data', () => {
    expect(
      deriveDegraded({ repoIntelEnabled: true, state: state(), result: result({ degraded: true, reason: 'no_data' }) }),
    ).toEqual({ degraded: true, reason: 'no_data' });
    expect(deriveDegraded({ repoIntelEnabled: true, state: state(), result: result({ degraded: true }) })).toEqual({
      degraded: true,
      reason: 'no_data',
    });
  });
  it('otherwise not degraded', () => {
    expect(deriveDegraded({ repoIntelEnabled: true, state: state(), result: result() })).toEqual(none);
  });
});
