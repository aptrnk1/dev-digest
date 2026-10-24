import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, PrBrief, StructuredRequest } from '@devdigest/shared';
import { BriefService, type BriefDeps } from '../src/modules/brief/service.js';
import { BriefDomainError } from '../src/modules/brief/domain.js';
import type { BriefPull, BriefStore } from '../src/modules/brief/ports.js';

const PATCH = '@@ -1,2 +1,3 @@\n a\n+b\n c';
const pull = (over: Partial<BriefPull> = {}): BriefPull => ({
  id: 'pr1', title: 'T', body: 'B', headSha: 'sha1', base: 'main', repoId: 'r1',
  repo: { owner: 'o', name: 'n' } as BriefPull['repo'], clonePath: null,
  files: [{ path: 'a.ts', additions: 1, deletions: 0, patch: PATCH }],
  ...over,
});

const draft = {
  summary: 'sum',
  risks: [{ kind: 'api', title: 't', explanation: 'e', severity: 'high', file_refs: ['a.ts:2'] }],
  review_focus: [{ file: 'a.ts', line: 2, reason: 'r' }],
};

const ok = (req: StructuredRequest<unknown>, costUsd: number | null = null) => ({
  data: draft, model: req.model, tokensIn: 1, tokensOut: 1, costUsd, raw: '', attempts: 1,
});

function setup(o: {
  pull?: BriefPull | undefined;
  stored?: unknown;
  completeStructured?: (req: StructuredRequest<unknown>) => Promise<unknown>;
  resolveModel?: BriefDeps['resolveModel'];
  specs?: BriefDeps['specs']['resolveForRepo'];
  intent?: BriefDeps['intent']['get'];
} = {}) {
  const hasPull = 'pull' in o ? o.pull : pull();
  const upsert = vi.fn(async (_id: string, _b: PrBrief) => {});
  const store: BriefStore = {
    loadPull: async () => hasPull,
    getBriefJson: async () => o.stored,
    upsertBrief: upsert,
  };
  const calls: StructuredRequest<unknown>[] = [];
  const provider = {
    completeStructured: vi.fn(async (req: StructuredRequest<unknown>) => {
      calls.push(req);
      if (o.completeStructured) return o.completeStructured(req);
      return ok(req, 0.01);
    }),
  } as unknown as LLMProvider;
  const intentGet = vi.fn(o.intent ?? (async () => ({ intent: null, stale: false })));
  const resolveModel = vi.fn(o.resolveModel ?? (async () => ({ model: 'risk-model', provider })));
  const service = new BriefService({
    store,
    intent: { get: intentGet },
    blast: {
      get: async () => ({
        changed_symbols: [], downstream: [], summary: 's', pr_id: 'pr1', index_sha: null,
        stats: { symbols: 0, callers: 0, endpoints: 0, crons: 0 }, degraded: false, degraded_reason: null,
      }),
    },
    diff: { facts: async () => ({ files: [{ path: 'a.ts', role: 'core' as const }], findings: [], reviewed: false }) },
    specs: {
      resolveForRepo:
        o.specs ?? (async () => ({ specs: [{ path: 'docs/a.md', content: 'x' }], specsRead: ['docs/a.md'] })),
    },
    resolveModel,
    tokens: { count: (t) => Math.ceil(t.length / 4) },
    now: () => new Date('2026-10-24T10:00:00.000Z'),
  });
  return { service, upsert, calls, provider, intentGet, resolveModel };
}

const validStored = (head = 'sha1'): PrBrief => ({
  summary: 's', intent: null, intent_stale: false, blast: null, risks: { risks: [] }, review_focus: [],
  history: { history: [] }, missing_inputs: [], head_sha: head, generated_at: '2026-10-24T10:00:00.000Z',
  model: 'm', cost_usd: null,
});

describe('BriefService.get', () => {
  it('no row -> { brief: null, stale: false } and no LLM call', async () => {
    const { service, provider } = setup();
    expect(await service.get('ws', 'pr1')).toEqual({ brief: null, stale: false });
    expect(provider.completeStructured).not.toHaveBeenCalled();
  });
  it('broken JSON -> brief null', async () => {
    const { service } = setup({ stored: { nope: 1 } });
    expect(await service.get('ws', 'pr1')).toEqual({ brief: null, stale: false });
  });
  it('same head -> not stale; moved head -> stale', async () => {
    expect((await setup({ stored: validStored('sha1') }).service.get('ws', 'pr1')).stale).toBe(false);
    const r = await setup({ stored: validStored('old') }).service.get('ws', 'pr1');
    expect(r.stale).toBe(true);
    expect(r.brief?.head_sha).toBe('old');
  });
  it('unknown PR -> pr_not_found', async () => {
    const { service } = setup({ pull: undefined });
    await expect(service.get('ws', 'x')).rejects.toMatchObject({ code: 'pr_not_found' });
  });
});

describe('BriefService.generate', () => {
  it('unknown PR -> pr_not_found, no LLM', async () => {
    const { service, resolveModel } = setup({ pull: undefined });
    await expect(service.generate('ws', 'x')).rejects.toMatchObject({ code: 'pr_not_found' });
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it('one structured call with the risk model, stores head_sha, one now(), cost', async () => {
    const { service, calls, upsert, intentGet } = setup();
    const brief = await service.generate('ws', 'pr1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'risk-model', maxRetries: 0, timeoutMs: 45_000 });
    expect(brief.head_sha).toBe('sha1');
    expect(brief.generated_at).toBe('2026-10-24T10:00:00.000Z');
    expect(brief.model).toBe('risk-model');
    expect(brief.cost_usd).toBe(0.01);
    expect(brief.risks.risks).toHaveLength(1);
    expect(brief.review_focus).toEqual([{ file: 'a.ts', line: 2, reason: 'r' }]);
    expect(upsert).toHaveBeenCalledWith('pr1', brief);
    expect(intentGet).toHaveBeenCalledTimes(1);
  });

  it('missing inputs: no intent, no review findings', async () => {
    const { service } = setup();
    const b = await service.generate('ws', 'pr1');
    expect(b.missing_inputs).toEqual(expect.arrayContaining(['intent', 'review_findings']));
    expect(b.intent).toBeNull();
  });

  it('stale stored intent -> intent_stale true', async () => {
    const { service } = setup({
      intent: async () => ({
        stale: true,
        intent: {
          pr_id: 'pr1', head_sha: 'old', model: 'm', cost_usd: null, updated_at: null,
          intent: 'Do X', in_scope: [], out_of_scope: [], risk_areas: [],
          confidence: 'high', basis: 'spec', sources: [], unresolved_refs: [],
        },
      }),
    });
    const b = await service.generate('ws', 'pr1');
    expect(b.intent_stale).toBe(true);
    expect(b.missing_inputs).not.toContain('intent');
  });

  it('resolveForRepo throws -> specs in missing, still succeeds', async () => {
    const { service } = setup({
      specs: async () => {
        throw new Error('boom');
      },
    });
    const b = await service.generate('ws', 'pr1');
    expect(b.missing_inputs).toContain('specs');
  });

  it('invalid first response -> second call succeeds', async () => {
    let n = 0;
    const { service, calls } = setup({
      completeStructured: async (req) => {
        if (++n === 1) throw new Error('schema mismatch');
        return ok(req);
      },
    });
    const b = await service.generate('ws', 'pr1');
    expect(calls).toHaveLength(2);
    expect(b.cost_usd).toBeNull();
  });

  it('two failures (timeout) -> brief_failed, nothing stored', async () => {
    const { service, calls, upsert } = setup({
      completeStructured: async () => {
        throw new Error('Request timed out after 45000ms');
      },
    });
    await expect(service.generate('ws', 'pr1')).rejects.toMatchObject({ code: 'brief_failed' });
    expect(calls).toHaveLength(2);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('llm_not_configured passes through, no call', async () => {
    const { service, calls, upsert } = setup({
      resolveModel: async () => {
        throw new BriefDomainError('llm_not_configured', 'no key');
      },
    });
    await expect(service.generate('ws', 'pr1')).rejects.toMatchObject({ code: 'llm_not_configured' });
    expect(calls).toHaveLength(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('concurrent generate -> brief_in_progress, one LLM call; lock released after', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { service, calls } = setup({
      completeStructured: async (req) => {
        await gate;
        return ok(req);
      },
    });
    const first = service.generate('ws', 'pr1');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await expect(service.generate('ws', 'pr1')).rejects.toMatchObject({ code: 'brief_in_progress' });
    release();
    await first;
    expect(calls).toHaveLength(1);
    await expect(service.generate('ws', 'pr1')).resolves.toBeDefined();
  });

  it('lock is released after a failure', async () => {
    let fail = true;
    const { service } = setup({
      completeStructured: async (req) => {
        if (fail) throw new Error('x');
        return ok(req);
      },
    });
    await expect(service.generate('ws', 'pr1')).rejects.toMatchObject({ code: 'brief_failed' });
    fail = false;
    await expect(service.generate('ws', 'pr1')).resolves.toBeDefined();
  });
});
