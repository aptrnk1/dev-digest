import { describe, it, expect } from 'vitest';
import type { BlastRadiusResponse, PrIntentState } from '@devdigest/shared';
import { TiktokenTokenizer } from '../src/adapters/tokenizer/index.js';
import { buildFacts } from '../src/modules/brief/facts.js';
import { buildBriefMessages } from '../src/modules/brief/prompt.js';
import type { BriefPull } from '../src/modules/brief/ports.js';
import type { SmartDiffFacts } from '../src/modules/smart-diff/types.js';

const tokens = new TiktokenTokenizer();
const repo = { owner: 'o', name: 'n' } as BriefPull['repo'];

const intent: PrIntentState = {
  stale: true,
  intent: {
    pr_id: 'p', head_sha: 's', model: null, cost_usd: null, updated_at: null,
    intent: 'INTENT_MARK', in_scope: ['IN_MARK'], out_of_scope: ['OUT_MARK'],
    risk_areas: [{ label: 'RISK_MARK', kind: 'data' }], confidence: 'high', basis: 'spec', sources: [], unresolved_refs: [],
  },
};
const blast: BlastRadiusResponse = {
  changed_symbols: [{ name: 'SYM_MARK', file: 'src/a.ts', kind: 'function' }],
  downstream: [{ symbol: 'SYM_MARK', endpoints_affected: [], crons_affected: [], callers: [{ name: 'CALLER_MARK', file: 'src/c.ts', line: 42 }] }],
  summary: 'BLAST_MARK', pr_id: 'p', index_sha: null, stats: { symbols: 1, callers: 1, endpoints: 0, crons: 0 },
  degraded: true, degraded_reason: 'index_partial',
};
const patch = '@@ -1,3 +10,4 @@ HEADER_TEXT_MARK\n+CODE_LINE_MARK\n-OLD_LINE_MARK\n context\n@@ -9 +20,2 @@ HDR2\n+more';
const pull: BriefPull = {
  id: 'p', title: 'TITLE_MARK', body: 'BODY_MARK', headSha: 's', base: 'main', repoId: 'r', repo, clonePath: null,
  files: [{ path: 'src/a.ts', additions: 7, deletions: 3, patch }],
};
const diff: SmartDiffFacts = {
  files: [{ path: 'src/a.ts', role: 'core' }],
  findings: [{ file: 'src/a.ts', start_line: 11, severity: 'CRITICAL', title: 'FINDING_MARK' }],
  reviewed: false,
};
const specs = { specs: [{ path: 'docs/spec.md', content: 'SPEC_MARK' }], specsRead: ['docs/spec.md'] };

const text = (b: ReturnType<typeof buildFacts>) => buildBriefMessages(b, tokens).map((m) => String(m.content)).join('\n\n');

describe('buildBriefMessages', () => {
  const b = buildFacts({ pull, intent, blast, diff, specs });
  const out = text(b);

  it('includes exactly the listed facts (AC34)', () => {
    for (const m of ['TITLE_MARK', 'BODY_MARK', 'INTENT_MARK', 'IN_MARK', 'OUT_MARK', 'RISK_MARK', 'BLAST_MARK',
      'SYM_MARK', 'CALLER_MARK', 'src/c.ts:42', 'index_partial', 'src/a.ts', 'role=core', '+7 -3', '+10,4', '+20,2',
      'SPEC_MARK', 'docs/spec.md', 'FINDING_MARK', 'CRITICAL src/a.ts:11']) {
      expect(out).toContain(m);
    }
  });

  it('never includes patch lines or header text (AC35)', () => {
    for (const m of ['HEADER_TEXT_MARK', 'CODE_LINE_MARK', 'OLD_LINE_MARK', 'HDR2', 'context', '@@']) {
      expect(out).not.toContain(m);
    }
  });

  it('passes missing_inputs and intent_stale with the instruction (AC41)', () => {
    expect(out).toContain('missing_inputs: review_findings');
    expect(out).toContain('intent_stale: true');
    expect(out).toMatch(/Name every missing input and a stale intent in the summary/);
  });

  it('wraps every repo/LLM value in <untrusted> and reminds after (AC47)', () => {
    const user = String(buildBriefMessages(b, tokens)[1]?.content);
    const outside = user.replace(/<untrusted[^>]*>[\s\S]*?<\/untrusted>/g, '');
    for (const m of ['TITLE_MARK', 'BODY_MARK', 'INTENT_MARK', 'BLAST_MARK', 'SYM_MARK', 'src/a.ts', 'role=core',
      'FINDING_MARK', 'SPEC_MARK', 'index_partial']) {
      expect(outside).not.toContain(m);
    }
    expect(user.trimEnd().endsWith('summary.')).toBe(true);
    expect(user.lastIndexOf('Reminder:')).toBeGreaterThan(user.lastIndexOf('</untrusted>'));
  });

  it('caps a huge PR: ≤ 100 files, ≤ 30 anchors, ≤ 20 000 tokens (NFR3)', () => {
    const files = Array.from({ length: 300 }, (_, i) => ({
      path: `src/module${i}/some/deeply/nested/file-${i}.ts`, additions: 5, deletions: 5,
      patch: Array.from({ length: 30 }, (_, j) => `@@ -${j} +${j * 10 + 1},3 @@ x`).join('\n'),
    }));
    const findings = Array.from({ length: 100 }, (_, i) => ({
      file: files[i]!.path, start_line: i + 1, severity: 'WARNING' as const, title: `finding title number ${i} ${'w'.repeat(200)}`,
    }));
    const big = buildFacts({
      pull: { ...pull, files },
      intent, blast,
      diff: { reviewed: true, findings, files: files.map((f) => ({ path: f.path, role: 'core' as const })) },
      specs,
    });
    expect(big.facts.files).toHaveLength(100);
    expect(big.facts.anchors).toHaveLength(30);
    const msgs = buildBriefMessages(big, tokens);
    const total = msgs.reduce((s, m) => s + tokens.count(String(m.content)), 0);
    expect(total).toBeLessThanOrEqual(20_000);
    expect(String(msgs[1]?.content)).toContain('src/module0/');
  });

  it('drops files from the end when over budget', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({
      path: `p${i}.ts`, additions: 1, deletions: 1, patch: '@@ -1 +1,1 @@',
    }));
    const huge = { specs: [{ path: 's.md', content: 'word '.repeat(19_500) }], specsRead: ['s.md'] };
    const r = buildFacts({ pull: { ...pull, files }, intent, blast, diff: { files: [], findings: [], reviewed: true }, specs: huge });
    const msgs = buildBriefMessages(r, tokens);
    const t = msgs.reduce((s, m) => s + tokens.count(String(m.content)), 0);
    expect(t).toBeLessThanOrEqual(20_000);
    expect(String(msgs[1]?.content)).not.toContain('p99.ts');
  });

  it('a huge blast radius is capped and never evicts changed files', () => {
    const callers = Array.from({ length: 2000 }, (_, i) => ({ name: `caller${i}`, file: `src/caller${i}.ts`, line: i + 1 }));
    const bigBlast: BlastRadiusResponse = {
      ...blast,
      changed_symbols: Array.from({ length: 500 }, (_, i) => ({ name: `sym${i}`, file: 'src/a.ts', kind: 'function' })),
      downstream: [{ symbol: 's', endpoints_affected: [], crons_affected: [], callers }],
    };
    const r = buildFacts({ pull, intent, blast: bigBlast, diff, specs });
    expect(r.facts.blast?.callers.length).toBeLessThanOrEqual(50);
    expect(r.facts.blast?.symbols.length).toBeLessThanOrEqual(30);
    expect(r.callerFiles.size).toBe(2000);
    const msgs = buildBriefMessages(r, tokens);
    expect(msgs.reduce((s, m) => s + tokens.count(String(m.content)), 0)).toBeLessThanOrEqual(20_000);
    expect(String(msgs[1]?.content)).toContain('src/a.ts | role=core');
  });
});
