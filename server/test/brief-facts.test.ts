import { describe, it, expect } from 'vitest';
import type { BlastRadiusResponse, PrIntentState } from '@devdigest/shared';
import { buildFacts } from '../src/modules/brief/facts.js';
import { hunkRanges, toBriefBlast } from '../src/modules/brief/helpers.js';
import type { BriefPull } from '../src/modules/brief/ports.js';
import type { SmartDiffFacts } from '../src/modules/smart-diff/types.js';

const repo = { owner: 'o', name: 'n' } as BriefPull['repo'];

export const pull = (files: BriefPull['files'] = []): BriefPull => ({
  id: 'pr1', title: 'T', body: 'B', headSha: 'sha', base: 'main', repoId: 'r1', repo, clonePath: null, files,
});

const intentState = (stale = false, has = true): PrIntentState => ({
  stale,
  intent: has
    ? {
        pr_id: 'pr1', head_sha: 'sha', model: 'm', cost_usd: null, updated_at: null,
        intent: 'Do X', in_scope: ['a'], out_of_scope: ['b'], risk_areas: [{ label: 'l', kind: 'api' }],
        confidence: 'high', basis: 'spec', sources: [], unresolved_refs: [],
      }
    : null,
});

const blast = (o: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse => ({
  changed_symbols: [], downstream: [], summary: 'sum', pr_id: 'pr1', index_sha: null,
  stats: { symbols: 0, callers: 0, endpoints: 0, crons: 0 }, degraded: false, degraded_reason: null, ...o,
});

const diff = (o: Partial<SmartDiffFacts> = {}): SmartDiffFacts => ({ files: [], findings: [], reviewed: true, ...o });
const specs = { specs: [{ path: 'docs/a.md', content: 'x' }], specsRead: ['docs/a.md'] };

const run = (o: {
  pull?: BriefPull; intent?: PrIntentState; blast?: BlastRadiusResponse; diff?: SmartDiffFacts;
  specs?: typeof specs | { specs: []; specsRead: [] };
} = {}) =>
  buildFacts({
    pull: o.pull ?? pull(), intent: o.intent ?? intentState(), blast: o.blast ?? blast(),
    diff: o.diff ?? diff(), specs: o.specs ?? specs,
  });

describe('hunkRanges', () => {
  it('reads every +c,d header; d defaults to 1; +c,0 kept', () => {
    const patch = '@@ -1,3 +10,4 @@ fn secret()\n+x\n@@ -20 +30 @@\n+y\n@@ -40,2 +50,0 @@\n-z';
    expect(hunkRanges(patch)).toEqual([
      { start: 10, count: 4 }, { start: 30, count: 1 }, { start: 50, count: 0 },
    ]);
    expect(hunkRanges(null)).toEqual([]);
  });
});

describe('buildFacts — missing inputs', () => {
  it('no intent → null + missing (AC36)', () => {
    const r = run({ intent: intentState(false, false) });
    expect(r.intent).toBeNull();
    expect(r.missing).toContain('intent');
    expect(r.intentStale).toBe(false);
  });
  it('stale intent is used with intentStale (AC51)', () => {
    const r = run({ intent: intentState(true) });
    expect(r.intent?.intent).toBe('Do X');
    expect(r.intentStale).toBe(true);
    expect(r.missing).not.toContain('intent');
  });
  it('degraded with 0 symbols / 0 callers → null + missing (AC37)', () => {
    const r = run({ blast: blast({ degraded: true, degraded_reason: 'no_data' }) });
    expect(r.blast).toBeNull();
    expect(r.missing).toContain('blast');
  });
  it('degraded with data is kept with its reason (AC53)', () => {
    const b = blast({
      degraded: true, degraded_reason: 'index_partial',
      changed_symbols: [{ name: 's', file: 'a.ts', kind: 'fn' }],
    });
    const r = run({ blast: b });
    expect(r.blast).toEqual({ summary: 'sum', caller_files: [], degraded_reason: 'index_partial' });
    expect(r.missing).not.toContain('blast');
  });
  it('not degraded and empty is kept, not missing (AC55)', () => {
    const r = run();
    expect(r.blast).toEqual({ summary: 'sum', caller_files: [], degraded_reason: null });
    expect(r.missing).not.toContain('blast');
  });
  it('caller_files are unique, in order of appearance', () => {
    const b = blast({
      downstream: [
        { symbol: 's', endpoints_affected: [], crons_affected: [], callers: [
          { name: 'a', file: 'x.ts', line: 1 }, { name: 'b', file: 'y.ts', line: 2 }, { name: 'c', file: 'x.ts', line: 3 },
        ] },
      ],
    });
    expect(toBriefBlast(b)?.caller_files).toEqual(['x.ts', 'y.ts']);
    expect([...run({ blast: b }).callerFiles]).toEqual(['x.ts', 'y.ts']);
  });
  it('empty specs → specs missing (AC39)', () => {
    expect(run({ specs: { specs: [], specsRead: [] } }).missing).toContain('specs');
    expect(run().missing).not.toContain('specs');
  });
  it('reviewed false → review_findings; reviewed with 0 findings → not (AC40)', () => {
    expect(run({ diff: diff({ reviewed: false }) }).missing).toContain('review_findings');
    expect(run({ diff: diff({ reviewed: true, findings: [] }) }).missing).not.toContain('review_findings');
  });
});

describe('buildFacts — files and anchors', () => {
  it('orders by Smart Diff, appends unlisted files with role null, caps ranges', () => {
    const many = Array.from({ length: 25 }, (_, i) => `@@ -1 +${i + 1},1 @@`).join('\n');
    const p = pull([
      { path: 'b.ts', additions: 1, deletions: 0, patch: many },
      { path: 'a.ts', additions: 2, deletions: 1, patch: null },
      { path: 'c.ts', additions: 0, deletions: 0, patch: null },
    ]);
    const r = run({ pull: p, diff: diff({ files: [{ path: 'a.ts', role: 'core' }, { path: 'b.ts', role: 'tests' }] }) });
    expect(r.facts.files.map((f) => [f.path, f.role])).toEqual([['a.ts', 'core'], ['b.ts', 'tests'], ['c.ts', null]]);
    expect(r.facts.files[1]?.ranges).toHaveLength(20);
    expect(r.files.get('b.ts')).toHaveLength(20);
  });
  it('caps at 100 files', () => {
    const files = Array.from({ length: 150 }, (_, i) => ({ path: `f${i}.ts`, additions: 1, deletions: 0, patch: null }));
    expect(run({ pull: pull(files) }).facts.files).toHaveLength(100);
  });
  it('anchors sorted severity → path → line, at most 30 (AC54)', () => {
    const findings = [
      { file: 'b.ts', start_line: 5, severity: 'WARNING' as const, title: 't1' },
      { file: 'a.ts', start_line: 9, severity: 'WARNING' as const, title: 't2' },
      { file: 'a.ts', start_line: 2, severity: 'WARNING' as const, title: 't3' },
      { file: 'z.ts', start_line: 1, severity: 'CRITICAL' as const, title: 't4' },
      { file: 'a.ts', start_line: 1, severity: 'SUGGESTION' as const, title: 't5' },
    ];
    expect(run({ diff: diff({ findings }) }).facts.anchors.map((a) => a.title)).toEqual(['t4', 't3', 't2', 't1', 't5']);
    const lots = Array.from({ length: 50 }, (_, i) => ({ file: 'a.ts', start_line: i, severity: 'WARNING' as const, title: `${i}` }));
    expect(run({ diff: diff({ findings: lots }) }).facts.anchors).toHaveLength(30);
  });
});
