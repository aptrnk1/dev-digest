import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMProvider, OnboardingTour } from '@devdigest/shared';
import { OnboardingService, type OnboardingDeps } from '../src/modules/onboarding/service.js';
import { ERROR_MESSAGES, httpError, DEADLINE_MS, STALE_RUN_MS } from '../src/modules/onboarding/constants.js';
import { OnboardingDomainError } from '../src/modules/onboarding/domain.js';
import type {
  JobRecord,
  OnboardingState,
  OnboardingStore,
  RepoBasics,
  RepoFiles,
} from '../src/modules/onboarding/ports.js';

const WS = 'ws';
const REPO: RepoBasics = { id: 'r1', owner: 'acme', name: 'api', clonePath: '/clone' };
const SHA = 'a'.repeat(40);

const draft = {
  summary: 'An API.',
  diagram: {
    nodes: [{ key: 'a', label: 'App', kind: 'entry', path: 'src/app.ts' }],
    edges: [],
  },
  critical_paths: [{ path: 'src/app.ts', description: 'entry' }],
  run_steps: [{ command: 'pnpm dev', source_path: 'package.json' }],
  reading_path: [{ path: 'src/app.ts', why: 'start' }],
  first_tasks: [{ title: 't', description: 'd', size: 'S', files: ['src/app.ts'] }],
};

class FakeStore implements OnboardingStore {
  repo: RepoBasics | undefined = REPO;
  state: OnboardingState | undefined;
  tryStartResult: 'ok' | 'busy' = 'ok';
  completeResult = true;
  failResult = true;
  tryStart = vi.fn(async (_r: string, runId: string, now: Date): Promise<JobRecord | null> =>
    this.tryStartResult === 'busy'
      ? null
      : { runId, status: 'running', error: null, startedAt: now, finishedAt: null },
  );
  complete = vi.fn(async (_r: string, _id: string, _t: OnboardingTour) => this.completeResult);
  fail = vi.fn(async (_r: string, _id: string, _e: string) => this.failResult);
  async getRepo() {
    return this.repo;
  }
  async getState() {
    return this.state;
  }
}

function files(overrides: Partial<RepoFiles> = {}): RepoFiles {
  return {
    isClone: async () => true,
    listTree: async () => ['package.json', 'src/app.ts'],
    listRootFiles: async () => ['README.md', 'package.json', 'pnpm-lock.yaml'],
    readCapped: async (_r, p) => `content of ${p}`,
    isRegularFileInside: async (_r, p) => p === 'src/app.ts' || p === 'package.json',
    ...overrides,
  };
}

interface Harness {
  svc: OnboardingService;
  store: FakeStore;
  calls: Array<Record<string, unknown>>;
  logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  resolveModel: ReturnType<typeof vi.fn>;
}

function make(
  behaviors: Array<() => Promise<unknown>>,
  extra: Partial<OnboardingDeps> = {},
  store = new FakeStore(),
): Harness {
  const calls: Array<Record<string, unknown>> = [];
  const llm = {
    completeStructured: vi.fn(async (req: Record<string, unknown>) => {
      calls.push(req);
      const b = behaviors[calls.length - 1] ?? behaviors[behaviors.length - 1]!;
      return b();
    }),
  } as unknown as LLMProvider;
  const resolveModel = vi.fn(async () => ({ model: 'm1', provider: async () => llm }));
  const logger = { info: vi.fn(), error: vi.fn() };
  const svc = new OnboardingService({
    store,
    files: files(),
    index: {
      getIndexState: async () => ({ status: 'full', filesIndexed: 42 }),
      getTopFilesByRank: async () => ['src/app.ts'],
      getCriticalPaths: async () => [['a', 'b']],
    } as unknown as OnboardingDeps['index'],
    head: { currentHead: async () => SHA },
    tokens: { count: (t: string) => t.length },
    resolveModel,
    loadSystemPrompt: async () => 'sys',
    repoIntelEnabled: true,
    logger,
    ...extra,
  });
  return { svc, store, calls, logger, resolveModel };
}

const ok = () => Promise.resolve({ data: draft });
const flush = async () => {
  for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('GET', () => {
  it('undefined for unknown repo; nulls without a row; provider never called', async () => {
    const h = make([ok]);
    h.store.repo = undefined;
    expect(await h.svc.get(WS, 'r1')).toBeUndefined();
    h.store.repo = REPO;
    expect(await h.svc.get(WS, 'r1')).toEqual({ job: null, tour: null });
    expect(h.calls).toHaveLength(0);
    expect(h.resolveModel).not.toHaveBeenCalled();
  });

  it('a stale running row is reported as failed (AC50)', async () => {
    const h = make([ok]);
    const startedAt = new Date(Date.now() - STALE_RUN_MS - 1000);
    h.store.state = { job: { runId: 'x', status: 'running', error: null, startedAt, finishedAt: null }, tour: null };
    const res = await h.svc.get(WS, 'r1');
    expect(res?.job).toMatchObject({ status: 'failed', error: ERROR_MESSAGES.stale });
  });
});

describe('POST checks', () => {
  it('404 -> undefined, no tryStart', async () => {
    const h = make([ok]);
    h.store.repo = undefined;
    expect(await h.svc.generate(WS, 'r1')).toBeUndefined();
    expect(h.store.tryStart).not.toHaveBeenCalled();
  });

  it('not cloned (no path / no .git) -> repo_not_cloned', async () => {
    const h = make([ok]);
    h.store.repo = { ...REPO, clonePath: null };
    await expect(h.svc.generate(WS, 'r1')).rejects.toMatchObject({ code: 'repo_not_cloned' });
    const h2 = make([ok], { files: files({ isClone: async () => false }) });
    await expect(h2.svc.generate(WS, 'r1')).rejects.toMatchObject({ code: 'repo_not_cloned' });
    expect(h.store.tryStart).not.toHaveBeenCalled();
    expect(h2.store.tryStart).not.toHaveBeenCalled();
  });

  it('live running row -> onboarding_in_progress; checked before the key', async () => {
    const h = make([ok]);
    h.store.state = {
      job: { runId: 'x', status: 'running', error: null, startedAt: new Date(), finishedAt: null },
      tour: null,
    };
    await expect(h.svc.generate(WS, 'r1')).rejects.toMatchObject({ code: 'onboarding_in_progress' });
    expect(h.resolveModel).not.toHaveBeenCalled();
    expect(h.store.tryStart).not.toHaveBeenCalled();
  });

  it('missing key -> llm_not_configured, no tryStart', async () => {
    const resolveModel = vi.fn(async () => {
      throw new OnboardingDomainError('llm_not_configured', 'no key');
    });
    const h = make([ok], { resolveModel });
    const svc = h.svc;
    await expect(svc.generate(WS, 'r1')).rejects.toMatchObject({ code: 'llm_not_configured' });
    expect(h.store.tryStart).not.toHaveBeenCalled();
  });

  it('tryStart null -> onboarding_in_progress', async () => {
    const h = make([ok]);
    h.store.tryStartResult = 'busy';
    await expect(h.svc.generate(WS, 'r1')).rejects.toMatchObject({ code: 'onboarding_in_progress' });
  });

  it('a stale running row does not block a new run', async () => {
    const h = make([ok]);
    h.store.state = {
      job: { runId: 'x', status: 'running', error: null, startedAt: new Date(Date.now() - STALE_RUN_MS - 5), finishedAt: null },
      tour: null,
    };
    const job = await h.svc.generate(WS, 'r1');
    expect(job?.status).toBe('running');
    await flush();
  });
});

describe('background generation', () => {
  it('success: completes with HEAD / index state captured at start; model from resolveModel', async () => {
    const h = make([ok]);
    const job = await h.svc.generate(WS, 'r1');
    expect(job).toMatchObject({ status: 'running', error: null, finished_at: null });
    await flush();
    expect(h.store.complete).toHaveBeenCalledTimes(1);
    const tour = h.store.complete.mock.calls[0]![2];
    expect(tour).toMatchObject({ commit_sha: SHA, files_indexed: 42, index_status: 'full' });
    expect(tour.architecture.diagram.nodes[0]!.path).toBe('src/app.ts');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ model: 'm1', maxRetries: 0 });
    expect(h.calls[0]!.timeoutMs).toBe(DEADLINE_MS);
    expect(h.store.fail).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('disabled repo-intel -> index_status none / 0 files', async () => {
    const h = make([ok], { repoIntelEnabled: false });
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(h.store.complete.mock.calls[0]![2]).toMatchObject({ index_status: 'none', files_indexed: 0 });
  });

  it('429 + 429 -> exactly 2 calls, fail with HTTP 429, one logger.error', async () => {
    const e = Object.assign(new Error('rate limited sk-secret'), { status: 429 });
    const h = make([() => Promise.reject(e)]);
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.store.fail).toHaveBeenCalledTimes(1);
    expect(h.store.fail.mock.calls[0]![2]).toBe(httpError(429));
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const [obj, msg] = h.logger.error.mock.calls[0]!;
    expect(obj).toMatchObject({ repoId: 'r1', error: httpError(429) });
    expect(JSON.stringify([obj, msg])).not.toContain('content of');
  });

  it('schema failure then success -> 2 calls, complete', async () => {
    const h = make([
      () => Promise.reject(new Error('OpenAI structured output failed schema validation')),
      ok,
    ]);
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.store.complete).toHaveBeenCalledTimes(1);
  });

  it('400 -> 1 call, fail', async () => {
    const h = make([() => Promise.reject(Object.assign(new Error('bad'), { status: 400 }))]);
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.store.fail.mock.calls[0]![2]).toBe(httpError(400));
  });

  it('unresponsive provider -> fail at 180 s with the deadline text, no new call', async () => {
    const h = make([() => new Promise(() => {})]);
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(h.store.fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEADLINE_MS + 1);
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.store.fail).toHaveBeenCalledTimes(1);
    expect(h.store.fail.mock.calls[0]![2]).toBe(ERROR_MESSAGES.deadline);
    expect(h.store.complete).not.toHaveBeenCalled();
  });

  it('input over budget -> 0 calls, context-too-large text', async () => {
    const h = make([ok], { tokens: { count: () => 1_000_000 } });
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.store.fail.mock.calls[0]![2]).toBe(ERROR_MESSAGES.contextTooLarge);
  });

  it('complete / fail returning false -> only logger.info', async () => {
    const h = make([ok]);
    h.store.completeResult = false;
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.error).not.toHaveBeenCalled();

    const h2 = make([() => Promise.reject(new Error('x'))]);
    h2.store.failResult = false;
    await h2.svc.generate(WS, 'r1');
    await flush();
    expect(h2.store.fail).toHaveBeenCalledTimes(1);
    expect(h2.logger.info).toHaveBeenCalledTimes(1);
  });

  it('never reads secret files', async () => {
    const read: string[] = [];
    const h = make([ok], {
      files: files({
        listRootFiles: async () => ['README.md', '.env', 'package.json'],
        readCapped: async (_r, p) => {
          read.push(p);
          return 'x';
        },
      }),
      index: {
        getIndexState: async () => ({ status: 'full', filesIndexed: 1 }),
        getTopFilesByRank: async () => ['.env.production', 'src/app.ts'],
        getCriticalPaths: async () => [],
      } as unknown as OnboardingDeps['index'],
    });
    await h.svc.generate(WS, 'r1');
    await flush();
    expect(read).not.toContain('.env');
    expect(read).not.toContain('.env.production');
  });
});
