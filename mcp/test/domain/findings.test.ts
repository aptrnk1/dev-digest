import { describe, expect, it } from 'vitest';
import {
  MAX_FINDINGS,
  MAX_RESPONSE_CHARS,
  compactFindings,
  countsBySeverity,
  deriveVerdict,
  fitBudget,
  toRunView,
} from '../../src/domain/findings.js';
import { findingFixture as f, reviewFixture } from '../fakes.js';

const concise = { detail: 'concise' as const };

describe('compactFindings', () => {
  it('drops dismissed findings', () => {
    const r = compactFindings([f({ id: 'a' }), f({ id: 'b', dismissed_at: '2026-01-01' })], concise);
    expect(r.findings.map((x) => x.id)).toEqual(['a']);
  });

  it('sorts by severity, then file, then line; line = start_line', () => {
    const r = compactFindings(
      [
        f({ id: 's', severity: 'SUGGESTION', file: 'a.ts' }),
        f({ id: 'w2', severity: 'WARNING', file: 'b.ts', start_line: 1 }),
        f({ id: 'w1b', severity: 'WARNING', file: 'a.ts', start_line: 9 }),
        f({ id: 'w1a', severity: 'WARNING', file: 'a.ts', start_line: 2 }),
        f({ id: 'c', severity: 'CRITICAL', file: 'z.ts' }),
      ],
      concise,
    );
    expect(r.findings.map((x) => x.id)).toEqual(['c', 'w1a', 'w1b', 'w2', 's']);
    expect(r.findings[1]?.line).toBe(2);
  });

  it('applies severityMin', () => {
    const all = [f({ id: 'c', severity: 'CRITICAL' }), f({ id: 'w' }), f({ id: 's', severity: 'SUGGESTION' })];
    expect(compactFindings(all, { ...concise, severityMin: 'WARNING' }).findings.map((x) => x.id)).toEqual(['c', 'w']);
    expect(compactFindings(all, { ...concise, severityMin: 'CRITICAL' }).findings.map((x) => x.id)).toEqual(['c']);
  });

  it('limits to 50 and reports truncated', () => {
    const many = Array.from({ length: 60 }, (_, i) => f({ id: `f${i}`, start_line: i }));
    const r = compactFindings(many, concise);
    expect(r.findings).toHaveLength(MAX_FINDINGS);
    expect(r.truncated).toBe(10);
  });

  it('includes rationale only with detail full; omits null suggestion', () => {
    const rec = [f({ suggestion: null }), f({ id: 'g', suggestion: 'fix it', start_line: 99 })];
    const c = compactFindings(rec, concise).findings;
    expect(c[0]).not.toHaveProperty('rationale');
    expect(c[0]).not.toHaveProperty('suggestion');
    expect(c[1]?.suggestion).toBe('fix it');
    const full = compactFindings(rec, { detail: 'full' }).findings;
    expect(full[0]?.rationale).toBe('because');
  });

  it('caps long fields with an ellipsis', () => {
    const [x] = compactFindings(
      [f({ title: 't'.repeat(500), suggestion: 's'.repeat(900), rationale: 'r'.repeat(2000) })],
      { detail: 'full' },
    ).findings;
    expect(x?.title).toHaveLength(200);
    expect(x?.suggestion).toHaveLength(400);
    expect(x?.rationale).toHaveLength(800);
    expect(x?.title.endsWith('…')).toBe(true);
  });
});

describe('countsBySeverity', () => {
  it('counts visible findings regardless of filters', () => {
    expect(
      countsBySeverity([
        f({ severity: 'CRITICAL' }),
        f({ severity: 'WARNING' }),
        f({ severity: 'WARNING' }),
        f({ severity: 'SUGGESTION', dismissed_at: 'x' }),
      ]),
    ).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
  });
});

describe('deriveVerdict', () => {
  it('prefers the API verdict', () => {
    expect(deriveVerdict('approve', [f({ severity: 'CRITICAL' })])).toBe('approve');
  });
  it('derives when the API verdict is null', () => {
    expect(deriveVerdict(null, [f({ severity: 'CRITICAL' })])).toBe('request_changes');
    expect(deriveVerdict(null, [f({ severity: 'WARNING' })])).toBe('comment');
    expect(deriveVerdict(null, [])).toBe('approve');
    expect(deriveVerdict(null, [f({ severity: 'CRITICAL', dismissed_at: 'x' })])).toBe('approve');
  });
});

describe('toRunView', () => {
  it('builds the view with counts computed before the filter and a hint on truncation', () => {
    const findings = Array.from({ length: 55 }, (_, i) => f({ id: `f${i}`, start_line: i }));
    const v = toRunView(
      { run_id: 'run-1', agent: 'Security', status: 'done', review: reviewFixture({ findings, verdict: null }) },
      { ...concise, severityMin: 'CRITICAL' },
    );
    expect(v.findings).toHaveLength(0);
    expect(v.counts_by_severity.WARNING).toBe(55);
    expect(v.verdict).toBe('comment');

    const t = toRunView(
      { run_id: 'run-1', agent: 'Security', status: 'done', review: reviewFixture({ findings }) },
      concise,
    );
    expect(t.truncated).toBe(5);
    expect(t.hint).toBe('filter with severity_min');
    expect(t).toMatchObject({ run_id: 'run-1', agent: 'Security', status: 'done', summary: 'summary' });
  });

  it('without a review: no verdict, no findings; carries the error', () => {
    const v = toRunView({ run_id: null, agent: 'A', status: 'failed', error: 'boom' }, concise);
    expect(v).toMatchObject({ verdict: null, findings: [], truncated: 0, error: 'boom' });
    expect(v).not.toHaveProperty('hint');
  });
});

describe('fitBudget', () => {
  it('returns small payloads untouched', () => {
    const p = { findings: [], truncated: 0 };
    expect(fitBudget(p)).toBe(p);
  });

  it('keeps 50 long full findings within 16000 chars and raises truncated', () => {
    const long = Array.from({ length: 50 }, (_, i) =>
      f({ id: `f${i}`, start_line: i, title: 't'.repeat(300), suggestion: 's'.repeat(900), rationale: 'r'.repeat(2000) }),
    );
    const view = toRunView(
      { run_id: 'r', agent: 'A', status: 'done', review: reviewFixture({ findings: long }) },
      { detail: 'full' },
    );
    expect(JSON.stringify(view).length).toBeGreaterThan(MAX_RESPONSE_CHARS);
    const fitted = fitBudget(view);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(fitted.truncated).toBeGreaterThan(0);
    expect(fitted.truncated + fitted.findings.length).toBe(50);
    expect(fitted.hint).toBe('filter with severity_min');
  });

  it('trims the last run first for multi-run payloads', () => {
    const mk = (n: number) => ({ findings: Array.from({ length: n }, (_, i) => ({ id: i, t: 'x'.repeat(500) })), truncated: 0 });
    const out = fitBudget({ runs: [mk(20), mk(20)] }, 12000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(12000);
    expect(out.runs[0]?.truncated).toBe(0);
    expect(out.runs[1]?.truncated).toBeGreaterThan(0);
  });
});
