import { describe, it, expect, vi } from 'vitest';
import type { PrIntentRecord, StructuredRequest } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { IntentService } from '../src/modules/intent/service.js';
import type {
  IntentStore,
  NewIntent,
  PullInputs,
  StoredIntent,
} from '../src/modules/intent/ports.js';

const HEAD = 'abc1234def';

function pull(over: Partial<PullInputs> = {}): PullInputs {
  return {
    id: 'pr-1',
    number: 482,
    title: 'Add rate limiting',
    body: 'Fixes #12. Plan: [spec](specs/foo.md). Also PAY-9 and https://linear.app/a/issue/ENG-1/x',
    branch: 'feat/rate-limit',
    headSha: HEAD,
    repo: { owner: 'acme', name: 'payments-api' },
    commits: ['Add limiter'],
    files: [{ path: 'src/limiter.ts', additions: 10, deletions: 1 }],
    ...over,
  };
}

class FakeStore implements IntentStore {
  stored: StoredIntent | undefined;
  constructor(public p: PullInputs | null = pull()) {}
  async loadPull(): Promise<PullInputs | undefined> {
    return this.p ?? undefined;
  }
  async getIntent(): Promise<StoredIntent | undefined> {
    return this.stored;
  }
  async upsertIntent(prId: string, row: NewIntent): Promise<PrIntentRecord> {
    const { input_hash, tokens_in: _a, tokens_out: _b, ...rest } = row;
    const record: PrIntentRecord = { ...rest, pr_id: prId, updated_at: '2026-01-01T00:00:00.000Z' };
    this.stored = { record, inputHash: input_hash };
    return record;
  }
}

const CLASSIFIED = {
  intent: 'Limit abuse of the public API',
  in_scope: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  out_of_scope: ['x'],
  risk_areas: Array.from({ length: 8 }, (_, i) => ({ label: `r${i}`, kind: 'security' as const })),
  confidence: 'high',
};

function setup(opts: { store?: FakeStore; files?: Record<string, string>; confidence?: string } = {}) {
  const store = opts.store ?? new FakeStore();
  const llm = new MockLLMProvider('openai', {
    structuredBySchema: { pr_intent: { ...CLASSIFIED, confidence: opts.confidence ?? 'high' } },
  });
  const getIssue = vi.fn(async (_r: unknown, n: number) => ({
    number: n,
    title: `Issue ${n}`,
    body: 'issue body',
    state: 'open',
  }));
  const showFile = vi.fn(async (_r: unknown, ref: string, path: string) => opts.files?.[`${ref}:${path}`] ?? null);
  const resolveModel = vi.fn(async () => ({ llm, model: 'anthropic/claude-haiku-4-5' }));
  const service = new IntentService({
    store,
    issues: { getIssue } as never,
    files: { showFile },
    resolveModel,
  });
  const calls = () => llm.calls.filter((c) => c.method === 'completeStructured');
  return { store, llm, service, getIssue, showFile, resolveModel, calls };
}

const FILES = { [`${HEAD}:specs/foo.md`]: '# Spec\nLimit public API calls.' };

describe('IntentService.ensure', () => {
  it('AC1: spec and issue land in the prompt, each in its own untrusted block; basis=spec', async () => {
    const { service, calls } = setup({ files: FILES });
    const rec = await service.ensure('ws', 'pr-1');
    const req = calls()[0]!.req as StructuredRequest<unknown>;
    const user = req.messages[1]!.content;
    expect(user).toContain('<untrusted source="spec:specs/foo.md">');
    expect(user).toContain('<untrusted source="issue:#12">');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('<untrusted source="pr-signals">');
    expect(req).toMatchObject({ schemaName: 'pr_intent', temperature: 0, maxRetries: 1, timeoutMs: 20000 });
    expect(rec.basis).toBe('spec');
    expect(rec.confidence).toBe('high');
    expect(rec.sources.map((s) => s.kind)).toEqual(['spec', 'ticket', 'description', 'inferred']);
  });

  it('AC4: uses the resolved model', async () => {
    const { service, calls } = setup({ files: FILES });
    const rec = await service.ensure('ws', 'pr-1');
    expect((calls()[0]!.req as StructuredRequest<unknown>).model).toBe('anthropic/claude-haiku-4-5');
    expect(rec.model).toBe('anthropic/claude-haiku-4-5');
  });

  it('slices every array to 6', async () => {
    const { service } = setup({ files: FILES });
    const rec = await service.ensure('ws', 'pr-1');
    expect(rec.in_scope).toHaveLength(6);
    expect(rec.risk_areas).toHaveLength(6);
  });

  it('AC2: empty body → low / inferred even when the model says high', async () => {
    const store = new FakeStore(pull({ body: '', branch: 'chore/tidy' }));
    const { service, getIssue } = setup({ store });
    const rec = await service.ensure('ws', 'pr-1');
    expect(rec.confidence).toBe('low');
    expect(rec.basis).toBe('inferred');
    expect(getIssue).not.toHaveBeenCalled();
    expect(rec.sources.map((s) => s.kind)).toEqual(['inferred']);
  });

  it('AC3: unchanged inputs are a cache hit; body/head change or force recompute', async () => {
    const { store, service, calls } = setup({ files: FILES });
    const log = { info: vi.fn(), error: vi.fn() };
    await service.ensure('ws', 'pr-1');
    await service.ensure('ws', 'pr-1', { log });
    expect(calls()).toHaveLength(1);
    expect(log.info.mock.calls.map((c) => c[0] as string).some((m) => m.startsWith('Intent cache hit'))).toBe(true);

    store.p = pull({ body: 'Different body. Fixes #12 [s](specs/foo.md)' });
    await service.ensure('ws', 'pr-1');
    expect(calls()).toHaveLength(2);

    store.p = { ...store.p!, headSha: 'new-head' };
    await service.ensure('ws', 'pr-1');
    expect(calls()).toHaveLength(3);

    await service.ensure('ws', 'pr-1', { force: true });
    expect(calls()).toHaveLength(4);
  });

  it('AC7: unsafe spec links are never read and are listed as unresolved', async () => {
    const store = new FakeStore(pull({ body: '[a](../../etc/passwd) [b](/abs/x.md) [c](src/a.ts)' }));
    const { service, showFile } = setup({ store });
    const rec = await service.ensure('ws', 'pr-1');
    expect(showFile).not.toHaveBeenCalled();
    expect(rec.unresolved_refs.map((u) => u.ref).sort()).toEqual(['../../etc/passwd', '/abs/x.md', 'src/a.ts']);
  });

  it('a spec link missing at head goes to unresolved with a reason', async () => {
    const { service } = setup();
    const rec = await service.ensure('ws', 'pr-1');
    expect(rec.unresolved_refs).toContainEqual({ ref: 'specs/foo.md', reason: 'not found at head' });
    expect(rec.basis).toBe('ticket');
  });

  it('AC8: Jira / Linear make no GitHub call and are unresolved', async () => {
    const store = new FakeStore(pull({ body: 'PAY-9 https://linear.app/a/issue/ENG-1/x', branch: 'main' }));
    const { service, getIssue } = setup({ store });
    const rec = await service.ensure('ws', 'pr-1');
    expect(getIssue).not.toHaveBeenCalled();
    expect(rec.unresolved_refs.map((u) => u.ref).sort()).toEqual(
      ['PAY-9', 'https://linear.app/a/issue/ENG-1/x'].sort(),
    );
  });

  it('an issue fetch failure is an unresolved ref, not an error', async () => {
    const { service, getIssue } = setup({ files: FILES });
    getIssue.mockRejectedValueOnce(new Error('GITHUB_TOKEN is not configured'));
    const rec = await service.ensure('ws', 'pr-1');
    expect(rec.unresolved_refs).toContainEqual({ ref: '#12', reason: 'not fetched: GITHUB_TOKEN is not configured' });
    expect(rec.basis).toBe('spec');
  });

  it('writes the §10 run-log lines', async () => {
    const { service } = setup({ files: FILES });
    const log = { info: vi.fn(), error: vi.fn() };
    await service.ensure('ws', 'pr-1', { log });
    const lines = log.info.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toBe('Deriving PR intent…');
    expect(lines[1]).toMatch(/^Intent sources: spec specs\/foo\.md · issue #12/);
    expect(lines.at(-1)).toMatch(/^Intent: confidence=high basis=spec · 100→50 tok · \$0\.0010$/);
  });

  it('throws pr_not_found for an unknown PR', async () => {
    const { service } = setup({ store: new FakeStore(null) });
    await expect(service.ensure('ws', 'x')).rejects.toMatchObject({ code: 'pr_not_found' });
  });
});

describe('IntentService.get', () => {
  it('null + not stale before derivation; stale after the head moves', async () => {
    const { store, service } = setup({ files: FILES });
    expect(await service.get('ws', 'pr-1')).toEqual({ intent: null, stale: false });
    await service.ensure('ws', 'pr-1');
    expect((await service.get('ws', 'pr-1')).stale).toBe(false);
    store.p = { ...store.p!, headSha: 'moved' };
    const s = await service.get('ws', 'pr-1');
    expect(s.stale).toBe(true);
    expect(s.intent?.head_sha).toBe(HEAD);
  });
});
