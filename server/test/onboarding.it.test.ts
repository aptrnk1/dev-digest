import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { SEED_ONBOARDING_COMMIT_SHA } from '../src/db/seed-onboarding.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { OnboardingRepository } from '../src/modules/onboarding/repository.js';
import { ERROR_MESSAGES, STALE_RUN_MS } from '../src/modules/onboarding/constants.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import { OnboardingTour, type LLMProvider, type OnboardingTourResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const HEAD = 'abcdef0123456789abcdef0123456789abcdef01';

const DRAFT = {
  summary: 'A tiny service. Requests enter at src/index.ts.',
  diagram: {
    nodes: [
      { key: 'a', label: 'client', kind: 'external', path: null },
      { key: 'b', label: 'index', kind: 'entry', path: 'src/index.ts' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  },
  critical_paths: [{ path: 'src/index.ts', description: 'Entry point' }],
  run_steps: [{ command: 'npm start', source_path: 'package.json' }],
  reading_path: [{ path: 'src/index.ts', why: 'Start here' }],
  first_tasks: [{ title: 'Add a test', description: 'Cover the entry point.', size: 'S', files: ['src/index.ts'] }],
};

const repoIntelStub = {
  getIndexState: async (repoId: string) => ({
    repoId,
    status: 'full',
    filesIndexed: 3,
    lastIndexedSha: HEAD,
    indexerVersion: 1,
    updatedAt: new Date(),
  }),
  getTopFilesByRank: async () => ['src/index.ts'],
  getCriticalPaths: async () => [],
} as unknown as RepoIntel;

d('L05 onboarding tour (Testcontainers pg)', () => {
  let pg: PgFixture;
  let cloneDir: string;
  let workspaceId: string;
  let provider: LLMProvider;
  let mode: 'ok' | 'fail' | 'gated';
  let gate: Promise<void>;
  let release: () => void;
  let llmCalls: number;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    cloneDir = await mkdtemp(join(tmpdir(), 'onboarding-it-'));
    await mkdir(join(cloneDir, '.git'));
    await mkdir(join(cloneDir, 'src'));
    await writeFile(join(cloneDir, 'README.md'), '# tiny\n');
    await writeFile(join(cloneDir, 'package.json'), '{"scripts":{"start":"node src/index.js"}}\n');
    await writeFile(join(cloneDir, 'src/index.ts'), 'export const x = 1;\n');
  });
  afterAll(async () => {
    await pg?.stop();
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true });
  });

  function resetProvider(next: typeof mode) {
    mode = next;
    llmCalls = 0;
    gate = new Promise<void>((r) => (release = r));
    const inner = new MockLLMProvider('openai', { structuredBySchema: { OnboardingTourDraft: DRAFT } });
    provider = {
      id: 'openai',
      listModels: () => inner.listModels(),
      complete: (req) => inner.complete(req),
      completeStructured: async (req) => {
        llmCalls++;
        if (mode === 'fail') throw new Error('fetch failed: ECONNREFUSED');
        if (mode === 'gated') await gate;
        return inner.completeStructured(req);
      },
    } as LLMProvider;
  }

  function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ head: HEAD }),
        repoIntel: repoIntelStub,
        llmWithLimits: () => provider,
      },
    });
  }

  async function newRepo(): Promise<string> {
    const name = `tour-${randomUUID().slice(0, 8)}`;
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: cloneDir })
      .returning({ id: t.repos.id });
    return row!.id;
  }

  async function settled(app: Awaited<ReturnType<typeof makeApp>>, repoId: string): Promise<OnboardingTourResponse> {
    for (let i = 0; i < 100; i++) {
      const body = (await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` })).json() as OnboardingTourResponse;
      if (body.job && body.job.status !== 'running') return body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('generation did not settle');
  }

  it('GET before any run returns null job and null tour', async () => {
    resetProvider('ok');
    const app = await makeApp();
    const repoId = await newRepo();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ job: null, tour: null });
    await app.close();
  });

  it('POST -> 202, then done with a valid tour (HEAD at start, generated_at at finish)', async () => {
    resetProvider('ok');
    const app = await makeApp();
    const repoId = await newRepo();
    const before = Date.now();
    const post = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(post.statusCode).toBe(202);
    expect(post.json().job.status).toBe('running');
    const body = await settled(app, repoId);
    expect(body.job?.status).toBe('done');
    expect(body.job?.error).toBeNull();
    expect(OnboardingTour.safeParse(body.tour).success).toBe(true);
    expect(body.tour!.commit_sha).toBe(HEAD);
    expect(body.tour!.index_status).toBe('full');
    expect(new Date(body.tour!.generated_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(body.job!.finished_at).toBe(body.tour!.generated_at);
    await app.close();
  });

  it('two parallel POSTs: exactly one 202 and one 409', async () => {
    resetProvider('gated');
    const app = await makeApp();
    const repoId = await newRepo();
    const url = `/repos/${repoId}/onboarding/generate`;
    const [a, b] = await Promise.all([app.inject({ method: 'POST', url }), app.inject({ method: 'POST', url })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(JSON.stringify(loser.json())).toContain('onboarding_in_progress');
    release();
    expect((await settled(app, repoId)).job?.status).toBe('done');
    await app.close();
  });

  it('a running row older than 10 min reads as failed (AC50) and a new POST is accepted', async () => {
    resetProvider('ok');
    const app = await makeApp();
    const repoId = await newRepo();
    await pg.handle.db.insert(t.onboarding).values({
      repoId,
      status: 'running',
      startedAt: new Date(Date.now() - 11 * 60_000),
    });
    const got = (await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` })).json() as OnboardingTourResponse;
    expect(got.job).toMatchObject({ status: 'failed', error: ERROR_MESSAGES.stale });
    const post = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(post.statusCode).toBe(202);
    expect((await settled(app, repoId)).job?.status).toBe('done');
    await app.close();
  });

  it('provider failure -> failed with a fixed text; the previous tour stays', async () => {
    resetProvider('ok');
    const app = await makeApp();
    const repoId = await newRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    const first = await settled(app, repoId);
    expect(first.job?.status).toBe('done');

    resetProvider('fail');
    const post = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    expect(post.statusCode).toBe(202);
    const after = await settled(app, repoId);
    expect(after.job?.status).toBe('failed');
    expect(Object.values(ERROR_MESSAGES)).toContain(after.job?.error);
    expect(llmCalls).toBeLessThanOrEqual(2);
    expect(after.tour).toEqual(first.tour);
    await app.close();
  });

  it('CAS: complete with a replaced run_id changes nothing', async () => {
    const repoId = await newRepo();
    const store = new OnboardingRepository(pg.handle.db);
    const tour = OnboardingTour.parse({
      commit_sha: HEAD,
      generated_at: new Date().toISOString(),
      files_indexed: 1,
      index_status: 'full',
      architecture: { summary: 's', diagram: { nodes: [], edges: [] } },
      critical_paths: [],
      run_steps: [],
      reading_path: [],
      first_tasks: [],
    });
    const now = new Date();
    const runA = randomUUID();
    const runB = randomUUID();
    expect(await store.tryStart(repoId, runA, now, STALE_RUN_MS)).not.toBeNull();
    expect(await store.tryStart(repoId, randomUUID(), now, STALE_RUN_MS)).toBeNull();
    expect(await store.fail(repoId, runA, ERROR_MESSAGES.network, now, STALE_RUN_MS)).toBe(true);
    expect(await store.tryStart(repoId, runB, now, STALE_RUN_MS)).not.toBeNull();

    expect(await store.complete(repoId, runA, tour, new Date(), STALE_RUN_MS)).toBe(false);
    expect(await store.fail(repoId, runA, ERROR_MESSAGES.network, new Date(), STALE_RUN_MS)).toBe(false);
    const [row] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    expect(row).toMatchObject({ status: 'running', runId: runB, json: null });
  });

  it('deleting the repo deletes its onboarding row', async () => {
    resetProvider('ok');
    const app = await makeApp();
    const repoId = await newRepo();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    await settled(app, repoId);
    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, repoId));
    const rows = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    expect(rows).toHaveLength(0);
    await app.close();
  });

  it('a new app instance on the same DB serves the same tour (NFR6)', async () => {
    resetProvider('ok');
    const app1 = await makeApp();
    const repoId = await newRepo();
    await app1.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    const first = await settled(app1, repoId);
    await app1.close();
    const app2 = await makeApp();
    const again = (await app2.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` })).json();
    expect(again).toEqual(first);
    await app2.close();
  });

  it('re-seeding keeps exactly one seed tour with the AC71 content', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.fullName, 'acme/payments-api'));
    const rows = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo!.id));
    expect(rows).toHaveLength(1);
    const tour = OnboardingTour.parse(rows[0]!.json);
    expect(tour.commit_sha).toBe(SEED_ONBOARDING_COMMIT_SHA);
    expect(rows[0]!.status).toBe('done');

    resetProvider('ok');
    const app = await makeApp();
    const res = (await app.inject({ method: 'GET', url: `/repos/${repo!.id}/onboarding` })).json() as OnboardingTourResponse;
    expect(res.job?.status).toBe('done');
    expect(res.tour).toEqual(tour);
    await app.close();
  });
});
