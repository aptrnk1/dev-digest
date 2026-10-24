import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = { verdict: 'approve', summary: 'ok', score: 90, findings: [] };
const CLASSIFIED = {
  intent: 'Add limiter',
  in_scope: [],
  out_of_scope: [],
  risk_areas: [],
  confidence: 'medium',
};

d('Project context wired into the run (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    cloneDir = await mkdtemp(join(tmpdir(), 'ctx-run-'));
    await mkdir(join(cloneDir, '.git'));
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(cloneDir, { recursive: true, force: true });
  });

  function appWith(files: Record<string, string>, extra: Record<string, unknown> = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        ...extra,
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF, refs: ['origin/main'], files }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', { structuredBySchema: { Review: REVIEW } }),
          openrouter: new MockLLMProvider('openai', { structuredBySchema: { pr_intent: CLASSIFIED } }),
        },
      },
    });
  }

  async function setup(name: string) {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: cloneDir })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'T',
        author: 'a',
        branch: 'feat',
        base: 'main',
        headSha: 'abc',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'b',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  async function runReview(app: Awaited<ReturnType<typeof appWith>>, prId: string, agentName: string) {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: agentName, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    return { agent, run: undefined as unknown, send: async () => {
      const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId: agent.id } });
      await waitForPrRuns(pg.handle.db, prId, { expected: 1 });
      const runId = res.json().runs[0].run_id as string;
      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      return trace;
    } };
  }

  it('injects attached docs (agent first, then skill) read from origin/<base>', async () => {
    const files = {
      'origin/main:docs/a.md': '# A doc',
      'origin/main:docs/s.md': '# Skill doc',
    };
    const app = await appWith(files);
    const { repo, pr } = await setup('ctx-run-1');
    const { agent, send } = await runReview(app, pr.id, 'CtxAgent');
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({ workspaceId, name: 'ctx-skill', description: 'd', type: 'custom', source: 'manual', body: 'skill body' })
      .returning();
    await pg.handle.db.insert(t.agentSkills).values({ agentId: agent.id, skillId: skill!.id, order: 0, enabled: true });
    await pg.handle.db.insert(t.contextAttachments).values([
      { workspaceId, repoId: repo.id, agentId: agent.id, path: 'docs/a.md', order: 0 },
      { workspaceId, repoId: repo.id, skillId: skill!.id, path: 'docs/s.md', order: 0 },
    ]);

    const trace = await send();
    expect(trace.specs_read).toEqual(['docs/a.md', 'docs/s.md']);
    expect(trace.prompt_assembly.specs).toContain('# A doc');
    expect(trace.prompt_assembly.specs).toContain('# Skill doc');
    expect(trace.prompt_assembly.block_tokens?.specs ?? 0).toBeGreaterThan(0);
    expect(trace.prompt_assembly.block_tokens?.specs ?? 0).toBeLessThanOrEqual(8000);
    await app.close();
  });

  it('agent without attachments → empty specs and a "none attached" line', async () => {
    const app = await appWith({});
    const { pr } = await setup('ctx-run-2');
    const { send } = await runReview(app, pr.id, 'NoCtxAgent');
    const trace = await send();
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(JSON.stringify(trace.log)).toContain('Project context: none attached');
    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(runs[0]!.status).toBe('done');
    await app.close();
  });

  it('a throwing resolver does not fail the run: one skipped line, no specs', async () => {
    const app = await appWith(
      {},
      {
        runContext: {
          resolveForRun: async () => {
            throw new Error('db down');
          },
        },
      },
    );
    const { pr } = await setup('ctx-run-3');
    const { send } = await runReview(app, pr.id, 'ThrowCtxAgent');
    const trace = await send();
    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(runs[0]!.status).toBe('done');
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    const lines = trace.log.filter((e: { msg: string }) => e.msg === 'Project context: skipped (error: db down)');
    expect(lines).toHaveLength(1);
    await app.close();
  });

  it("resolveForRepo unions enabled agents' attachments, skips disabled, reads origin/<base>", async () => {
    const app = await appWith({
      'origin/main:docs/one.md': '# One',
      'origin/main:docs/two.md': '# Two',
      'origin/main:docs/off.md': '# Off',
    });
    const { repo } = await setup('ctx-run-4');
    const [a1, a2, off] = await pg.handle.db
      .insert(t.agents)
      .values(
        ['RepoA1', 'RepoA2', 'RepoOff'].map((name, i) => ({
          workspaceId,
          name,
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 's',
          enabled: i < 2,
          createdAt: new Date(Date.now() + 60_000 + i * 1000),
        })),
      )
      .returning();
    await pg.handle.db.insert(t.contextAttachments).values([
      { workspaceId, repoId: repo.id, agentId: a1!.id, path: 'docs/one.md', order: 0 },
      { workspaceId, repoId: repo.id, agentId: a2!.id, path: 'docs/one.md', order: 0 },
      { workspaceId, repoId: repo.id, agentId: a2!.id, path: 'docs/two.md', order: 1 },
      { workspaceId, repoId: repo.id, agentId: off!.id, path: 'docs/off.md', order: 0 },
    ]);
    const out = await app.container.runContext.resolveForRepo(
      {
        workspaceId,
        repoId: repo.id,
        repo: { owner: 'acme', name: 'ctx-run-4' },
        clonePath: cloneDir,
        base: 'main',
      },
      { info: () => {} },
    );
    expect(out.specsRead).toEqual(['docs/one.md', 'docs/two.md']);
    await app.close();
  });
});
