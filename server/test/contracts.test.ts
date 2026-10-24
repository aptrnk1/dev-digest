import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  BlastRadiusResponse,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  OnboardingTour,
  OnboardingJob,
  OnboardingTourResponse,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  PrIntentState,
  PromptAssembly,
  SpecFile,
  SpecFileList,
  ContextDocUsage,
  ContextAttachments,
  ContextAttachmentsInput,
  FEATURE_MODELS,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({
        intent: 'x',
        in_scope: ['a'],
        out_of_scope: ['b'],
        risk_areas: [],
        confidence: 'low',
        basis: 'inferred',
        sources: [],
        unresolved_refs: [],
      }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('BlastRadiusResponse parses full payload', () => {
    const response = BlastRadiusResponse.parse({
      pr_id: 'p482',
      changed_symbols: [{ name: 'rateLimit', file: 'src/middleware/ratelimit.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'rateLimit',
          callers: [{ name: 'publicRouter', file: 'src/api/public/index.ts', line: 23 }],
          endpoints_affected: ['GET /api/public/items'],
          crons_affected: ['job:reset_rate_buckets'],
        },
      ],
      summary: '1 changed symbols · 1 callers · 1 endpoints · 1 crons',
      index_sha: 'b1a5700000000000000000000000000000000482',
      stats: { symbols: 1, callers: 1, endpoints: 1, crons: 1 },
      degraded: false,
      degraded_reason: null,
    });
    expect(response.pr_id).toBe('p482');
    expect(response.degraded).toBe(false);
    expect(response.stats.symbols).toBe(1);
  });

  it('BlastRadiusResponse parses degraded payload with index_partial reason', () => {
    const response = BlastRadiusResponse.parse({
      pr_id: 'p482',
      changed_symbols: [],
      downstream: [],
      summary: '0 changed symbols · 0 callers · 0 endpoints · 0 crons (index degraded: index_partial)',
      index_sha: 'b1a5700000000000000000000000000000000482',
      stats: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      degraded: true,
      degraded_reason: 'index_partial',
    });
    expect(response.degraded).toBe(true);
    expect(response.degraded_reason).toBe('index_partial');
  });

  it('BlastRadiusResponse parses with index_sha null', () => {
    const response = BlastRadiusResponse.parse({
      pr_id: 'p482',
      changed_symbols: [],
      downstream: [],
      summary: '0 changed symbols · 0 callers · 0 endpoints · 0 crons',
      index_sha: null,
      stats: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      degraded: false,
      degraded_reason: null,
    });
    expect(response.index_sha).toBeNull();
  });

  it('BlastRadiusResponse rejects unknown degraded_reason', () => {
    expect(() =>
      BlastRadiusResponse.parse({
        pr_id: 'p482',
        changed_symbols: [],
        downstream: [],
        summary: 's',
        index_sha: null,
        stats: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        degraded: true,
        degraded_reason: 'unknown',
      }),
    ).toThrow();
  });

  it('BlastRadiusResponse rejects negative stats', () => {
    expect(() =>
      BlastRadiusResponse.parse({
        pr_id: 'p482',
        changed_symbols: [],
        downstream: [],
        summary: 's',
        index_sha: null,
        stats: { symbols: -1, callers: 0, endpoints: 0, crons: 0 },
        degraded: false,
        degraded_reason: null,
      }),
    ).toThrow();
  });

  it('SmartDiff (data.jsx DIFF) — all five roles, finding_ids, max_severity, rank_percentile, files_with_findings', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [
            {
              path: 'src/core.ts',
              additions: 84,
              deletions: 0,
              finding_lines: [28, 52],
              finding_ids: ['f1', 'f2'],
              max_severity: 'CRITICAL',
              rank_percentile: 0.85,
            },
          ],
          files_with_findings: 1,
        },
        {
          role: 'tests',
          files: [
            {
              path: 'src/core.test.ts',
              additions: 24,
              deletions: 0,
              finding_lines: [],
              finding_ids: [],
              max_severity: null,
              rank_percentile: null,
            },
          ],
          files_with_findings: 0,
        },
        {
          role: 'wiring',
          files: [
            {
              path: 'package.json',
              additions: 1,
              deletions: 0,
              finding_lines: [],
              finding_ids: [],
              max_severity: null,
              rank_percentile: 0.5,
            },
          ],
          files_with_findings: 0,
        },
        {
          role: 'docs',
          files: [
            {
              path: 'README.md',
              additions: 10,
              deletions: 0,
              finding_lines: [],
              finding_ids: [],
              max_severity: null,
              rank_percentile: null,
            },
          ],
          files_with_findings: 0,
        },
        {
          role: 'boilerplate',
          files: [
            {
              path: 'pnpm-lock.yaml',
              additions: 100,
              deletions: 10,
              finding_lines: [],
              finding_ids: [],
              max_severity: null,
              rank_percentile: null,
            },
          ],
          files_with_findings: 0,
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups).toHaveLength(5);
    expect(d.groups[0]!.role).toBe('core');
    expect(d.groups[0]!.files[0]!.finding_ids).toEqual(['f1', 'f2']);
    expect(d.groups[0]!.files[0]!.max_severity).toBe('CRITICAL');
    expect(d.groups[0]!.files[0]!.rank_percentile).toBe(0.85);
    expect(d.groups[0]!.files_with_findings).toBe(1);
    expect(d.groups[1]!.role).toBe('tests');
    expect(d.groups[2]!.role).toBe('wiring');
    expect(d.groups[3]!.role).toBe('docs');
    expect(d.groups[4]!.role).toBe('boilerplate');
  });

  it('SmartDiff rejects invalid role (with whitespace)', () => {
    expect(() =>
      SmartDiff.parse({
        groups: [
          {
            role: 'tests ',
            files: [],
            files_with_findings: 0,
          },
        ],
        split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
      }),
    ).toThrow();
  });

  it('SmartDiff rejects unknown role', () => {
    expect(() =>
      SmartDiff.parse({
        groups: [
          {
            role: 'unknown',
            files: [],
            files_with_findings: 0,
          },
        ],
        split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
      }),
    ).toThrow();
  });

  it('SmartDiff rejects invalid max_severity', () => {
    expect(() =>
      SmartDiff.parse({
        groups: [
          {
            role: 'core',
            files: [
              {
                path: 'a.ts',
                additions: 1,
                deletions: 0,
                finding_lines: [],
                finding_ids: [],
                max_severity: 'INFO',
                rank_percentile: null,
              },
            ],
            files_with_findings: 0,
          },
        ],
        split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
      }),
    ).toThrow();
  });

  describe('Onboarding tour', () => {
    const sha = 'a'.repeat(40);
    const tour = () => ({
      commit_sha: sha,
      generated_at: '2026-10-24T10:00:00.000Z',
      files_indexed: 12,
      index_status: 'full',
      architecture: {
        summary: 'Summary',
        diagram: {
          nodes: [{ id: 'a', label: 'API', kind: 'entry', path: 'src/index.ts' }],
          edges: [{ from: 'a', to: 'a' }],
        },
      },
      critical_paths: [{ path: 'src/a.ts', description: 'd' }],
      run_steps: [{ command: 'pnpm dev', source_path: 'package.json' }],
      reading_path: [{ path: 'README.md', why: 'w' }],
      first_tasks: [{ title: 't', description: 'd', size: 'S', files: ['src/a.ts'] }],
    });

    it('accepts a valid tour', () => {
      expect(() => OnboardingTour.parse(tour())).not.toThrow();
    });

    it('rejects 9 critical_paths', () => {
      const t = tour();
      t.critical_paths = Array.from({ length: 9 }, () => ({ path: 'p', description: 'd' }));
      expect(() => OnboardingTour.parse(t)).toThrow();
    });

    it('rejects 13 diagram nodes', () => {
      const t = tour();
      t.architecture.diagram.nodes = Array.from({ length: 13 }, (_, i) => ({
        id: `n${i}`,
        label: 'l',
        kind: 'module',
        path: null,
      }));
      expect(() => OnboardingTour.parse(t)).toThrow();
    });

    it('rejects a first task with 4 files', () => {
      const t = tour();
      t.first_tasks[0]!.files = ['a', 'b', 'c', 'd'];
      expect(() => OnboardingTour.parse(t)).toThrow();
    });

    it('rejects a job error longer than 200 chars', () => {
      const job = { status: 'failed', error: 'x'.repeat(201), started_at: 's', finished_at: 'f' };
      expect(() => OnboardingJob.parse(job)).toThrow();
      expect(() => OnboardingJob.parse({ ...job, error: 'x'.repeat(200) })).not.toThrow();
    });

    it('accepts job: null, tour: null', () => {
      expect(() => OnboardingTourResponse.parse({ job: null, tour: null })).not.toThrow();
    });
  });

  it('Conformance / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.06, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('Intent layer contracts', () => {
  const intent = {
    intent: 'Add retry to webhook delivery',
    in_scope: ['retry loop'],
    out_of_scope: ['queue rewrite'],
    risk_areas: [{ label: 'duplicate delivery', kind: 'api' }],
    confidence: 'medium',
    basis: 'description',
    sources: [{ kind: 'description', ref: 'pr-description', truncated: false }],
    unresolved_refs: [{ ref: 'ABC-123', reason: 'Jira not supported' }],
  };

  it('parses a full Intent and PrIntentState', () => {
    expect(Intent.parse(intent).risk_areas).toHaveLength(1);
    const state = PrIntentState.parse({
      intent: {
        ...intent,
        pr_id: 'p1',
        head_sha: 'abc',
        model: null,
        cost_usd: null,
        updated_at: null,
      },
      stale: false,
    });
    expect(state.stale).toBe(false);
    expect(PrIntentState.parse({ intent: null, stale: false }).intent).toBeNull();
  });

  it('PromptAssembly without intent still parses (legacy traces)', () => {
    const pa = PromptAssembly.parse({ system: 's', user: 'u' });
    expect(pa.intent).toBeUndefined();
  });

  it('review_intent defaults to openrouter Haiku 4.5', () => {
    const m = FEATURE_MODELS.find((f) => f.id === 'review_intent');
    expect(m?.defaultProvider).toBe('openrouter');
    expect(m?.defaultModel).toBe('anthropic/claude-haiku-4-5');
  });

  describe('Project Context contracts', () => {
    const doc = {
      path: 'docs/a.md',
      folder: 'docs',
      category: 'docs',
      size: 10,
      tokens: null,
      status: 'too_large',
    };
    const id = '11111111-1111-4111-8111-111111111111';

    it('SpecFile / SpecFileList parse and reject bad enums', () => {
      expect(SpecFile.parse(doc).tokens).toBeNull();
      expect(SpecFileList.parse({ docs: [doc], truncated: false }).docs).toHaveLength(1);
      expect(SpecFile.safeParse({ ...doc, category: 'other' }).success).toBe(false);
      expect(SpecFile.safeParse({ ...doc, status: 'missing' }).success).toBe(false);
      expect(SpecFile.safeParse({ path: 'a.md' }).success).toBe(false);
    });

    it('ContextDocUsage and ContextAttachments parse', () => {
      expect(ContextDocUsage.parse({ agents: [{ id: 'a', name: 'A' }], skills: [] }).skills).toEqual([]);
      const ok = ContextAttachments.parse({
        repo_id: id,
        attached: [{ path: 'a.md', status: 'missing', tokens: null }],
        inherited: [{ path: 'b.md', skill_id: id, skill_name: 'S', status: 'ok', tokens: 5 }],
      });
      expect(ok.inherited[0]?.tokens).toBe(5);
      expect(
        ContextAttachments.safeParse({ repo_id: id, attached: [{ path: 'a', status: 'x', tokens: 1 }], inherited: [] })
          .success,
      ).toBe(false);
    });

    it('ContextAttachmentsInput caps paths at 50', () => {
      const paths = (n: number) => Array.from({ length: n }, (_, i) => `d${i}.md`);
      expect(ContextAttachmentsInput.safeParse({ paths: paths(50) }).success).toBe(true);
      expect(ContextAttachmentsInput.safeParse({ paths: paths(51) }).success).toBe(false);
      expect(ContextAttachmentsInput.safeParse({ paths: [''] }).success).toBe(false);
    });
  });
});
