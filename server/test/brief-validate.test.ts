import { describe, it, expect } from 'vitest';
import { BriefDraft } from '../src/modules/brief/prompt.js';
import { parseStoredBrief, sanitizeDraft } from '../src/modules/brief/validate.js';
import { truncateCodePoints } from '../src/modules/brief/helpers.js';

const ctx = {
  files: new Map([['a.ts', [{ start: 10, count: 5 }]], ['b.ts', [{ start: 1, count: 1 }]]]),
  callerFiles: new Set(['caller.ts']),
};
const risk = (o: object = {}) => ({ kind: 'k', title: 't', explanation: 'e', severity: 'high' as const, file_refs: ['a.ts'], ...o });
const draft = (o: Partial<BriefDraft> = {}): BriefDraft => ({ summary: 's', risks: [], review_focus: [], ...o });

describe('BriefDraft strictness (AC48)', () => {
  const ok = { summary: 's', risks: [risk()], review_focus: [{ file: 'a.ts', line: 10, reason: 'r' }] };
  it('accepts a valid draft', () => expect(BriefDraft.safeParse(ok).success).toBe(true));
  it('rejects an extra field at any level', () => {
    expect(BriefDraft.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(BriefDraft.safeParse({ ...ok, risks: [risk({ extra: 1 })] }).success).toBe(false);
    expect(BriefDraft.safeParse({ ...ok, review_focus: [{ file: 'a', line: 1, reason: 'r', x: 1 }] }).success).toBe(false);
  });
  it('rejects severity outside the enum', () => {
    expect(BriefDraft.safeParse({ ...ok, risks: [risk({ severity: 'critical' })] }).success).toBe(false);
  });
});

describe('sanitizeDraft', () => {
  it('drops focus on unknown files or lines outside new-side ranges (AC38)', () => {
    const out = sanitizeDraft(
      draft({
        review_focus: [
          { file: 'a.ts', line: 10, reason: 'in' },
          { file: 'a.ts', line: 14, reason: 'in end' },
          { file: 'a.ts', line: 15, reason: 'out' },
          { file: 'a.ts', line: 9, reason: 'out' },
          { file: 'zzz.ts', line: 1, reason: 'unknown' },
        ],
      }),
      ctx,
    );
    expect(out.review_focus.map((f) => f.reason)).toEqual(['in', 'in end']);
  });
  it('strips refs outside changed ∪ callers; drops risks left without refs (AC43, AC44)', () => {
    const out = sanitizeDraft(
      draft({
        risks: [
          risk({ title: 'keep', file_refs: ['a.ts', 'nope.ts', 'caller.ts:3', 'b.ts:4-9'] }),
          risk({ title: 'drop', file_refs: ['nope.ts:1', '../x'] }),
        ],
      }),
      ctx,
    );
    expect(out.risks.risks).toHaveLength(1);
    expect(out.risks.risks[0]?.file_refs).toEqual(['a.ts', 'caller.ts:3', 'b.ts:4-9']);
  });
  it('keeps the first 6 risks and 6 focus items in model order (AC45)', () => {
    const out = sanitizeDraft(
      draft({
        risks: Array.from({ length: 8 }, (_, i) => risk({ title: `r${i}` })),
        review_focus: Array.from({ length: 8 }, (_, i) => ({ file: 'a.ts', line: 10, reason: `f${i}` })),
      }),
      ctx,
    );
    expect(out.risks.risks.map((r) => r.title)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
    expect(out.review_focus.map((f) => f.reason)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5']);
  });
  it('truncates by code point to the limits (AC45)', () => {
    const long = 'x'.repeat(1000);
    const out = sanitizeDraft(
      draft({
        summary: long,
        risks: [risk({ kind: long, title: long, explanation: long })],
        review_focus: [{ file: 'a.ts', line: 10, reason: long }],
      }),
      ctx,
    );
    expect(out.summary).toHaveLength(600);
    const r = out.risks.risks[0]!;
    expect([r.kind.length, r.title.length, r.explanation.length]).toEqual([40, 120, 500]);
    expect(out.review_focus[0]?.reason).toHaveLength(200);
  });
  it('never leaves a lone surrogate at the cut', () => {
    const s = 'a'.repeat(599) + '😀' + 'tail';
    const cut = truncateCodePoints(s, 600);
    expect(Array.from(cut)).toHaveLength(600);
    expect(cut.endsWith('😀')).toBe(true);
    expect(() => JSON.parse(JSON.stringify(cut))).not.toThrow();
    expect(/[\uD800-\uDBFF]$/.test(cut)).toBe(false);
    const out = sanitizeDraft(draft({ summary: s }), ctx);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out.summary)).toBe(false);
  });
});

describe('parseStoredBrief (AC5)', () => {
  it('returns null on broken / old JSON', () => {
    expect(parseStoredBrief({ summary: 'old' })).toBeNull();
    expect(parseStoredBrief(null)).toBeNull();
    expect(parseStoredBrief('x')).toBeNull();
  });
  it('returns the brief when it matches the contract', () => {
    const b = {
      summary: 's', intent: null, intent_stale: false, blast: null, risks: { risks: [] }, review_focus: [],
      missing_inputs: [], head_sha: 'h', generated_at: '2026-10-24T00:00:00.000Z', model: 'm', cost_usd: null,
    };
    expect(parseStoredBrief(b)?.history).toEqual({ history: [] });
  });
});
