import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * Project Context API against real Postgres + a temporary clone on disk:
 * attachments CRUD/order, statuses, inheritance from skills, usage, cascades,
 * no new agent/skill versions, persistence across app instances.
 */
d('Project Context API (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let tmpRoot: string;
  let cloneDir: string;
  let outsideDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    tmpRoot = mkdtempSync(join(tmpdir(), 'ctx-it-'));
    cloneDir = join(tmpRoot, 'clone');
    outsideDir = join(tmpRoot, 'outside');
    mkdirSync(join(cloneDir, '.git'), { recursive: true });
    mkdirSync(join(cloneDir, 'docs'), { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(cloneDir, 'README.md'), '# Readme\n');
    writeFileSync(join(cloneDir, 'docs', 'a.md'), '# A\n');
    writeFileSync(join(cloneDir, 'docs', 'b.md'), '# B\n');
    writeFileSync(join(cloneDir, 'docs', 'c.md'), '# C\n');
    writeFileSync(join(cloneDir, 'docs', 'usage-target.md'), '# U\n');
    writeFileSync(join(cloneDir, 'docs', 'big.md'), 'x'.repeat(1_048_576 + 1));
    writeFileSync(join(outsideDir, 'secret.md'), 'secret');
    symlinkSync(join(outsideDir, 'secret.md'), join(cloneDir, 'docs', 'escape.md'));
    // enough files that `zzz/last.md` falls beyond the 500-doc list cap
    mkdirSync(join(cloneDir, 'many'), { recursive: true });
    for (let i = 0; i < 505; i++) {
      writeFileSync(join(cloneDir, 'many', `f${String(i).padStart(4, '0')}.md`), `# ${i}\n`);
    }
    mkdirSync(join(cloneDir, 'zzz'), { recursive: true });
    writeFileSync(join(cloneDir, 'zzz', 'last.md'), '# last\n');

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'ctx-it',
        fullName: 'acme/ctx-it',
        clonePath: cloneDir,
      })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
    });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;
  type Item = { path: string; status: string; tokens: number | null };

  async function newAgent(app: App, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4o', system_prompt: 'review' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }
  async function newSkill(app: App, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, description: 'Use when X.', type: 'custom', body: 'body' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }
  const put = (app: App, kind: 'agents' | 'skills', id: string, paths: string[]) =>
    app.inject({ method: 'PUT', url: `/${kind}/${id}/context?repo_id=${repoId}`, payload: { paths } });
  const get = (app: App, kind: 'agents' | 'skills', id: string) =>
    app.inject({ method: 'GET', url: `/${kind}/${id}/context?repo_id=${repoId}` });
  const paths = (items: Item[]) => items.map((a) => a.path);

  it('PUT replaces the list in order and returns ContextAttachments (AC50, AC33, AC34, AC26, AC83)', async () => {
    const app = await makeApp();
    const agent = await newAgent(app, 'ctx-put-agent');

    const first = await put(app, 'agents', agent, ['docs/a.md', 'docs/b.md']);
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.repo_id).toBe(repoId);
    expect(paths(body.attached)).toEqual(['docs/a.md', 'docs/b.md']);
    expect(body.attached.every((a: Item) => a.status === 'ok' && (a.tokens ?? 0) > 0)).toBe(true);
    expect(body.inherited).toEqual([]);

    const added = await put(app, 'agents', agent, ['docs/a.md', 'docs/b.md', 'docs/c.md']);
    expect(paths(added.json().attached)).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
    const reordered = await put(app, 'agents', agent, ['docs/c.md', 'docs/a.md', 'docs/b.md']);
    expect(paths(reordered.json().attached)).toEqual(['docs/c.md', 'docs/a.md', 'docs/b.md']);
    const removed = await put(app, 'agents', agent, ['docs/a.md']);
    expect(paths(removed.json().attached)).toEqual(['docs/a.md']);
    const empty = await put(app, 'agents', agent, []);
    expect(empty.json().attached).toEqual([]);

    expect((await put(app, 'agents', agent, ['docs/a.md', 'docs/a.md'])).statusCode).toBe(422);
    expect((await put(app, 'agents', agent, ['../etc/passwd.md'])).statusCode).toBe(422);
    await app.close();
  });

  it('reports ok / too_large / missing, symlink escape -> missing (AC51)', async () => {
    const app = await makeApp();
    const agent = await newAgent(app, 'ctx-status-agent');
    await put(app, 'agents', agent, ['docs/a.md', 'docs/big.md', 'docs/gone.md', 'docs/escape.md']);
    const res = await get(app, 'agents', agent);
    expect(res.statusCode).toBe(200);
    const byPath = Object.fromEntries(res.json().attached.map((a: Item) => [a.path, a]));
    expect(byPath['docs/a.md'].status).toBe('ok');
    expect(byPath['docs/big.md']).toMatchObject({ status: 'too_large', tokens: null });
    expect(byPath['docs/gone.md']).toMatchObject({ status: 'missing', tokens: null });
    expect(byPath['docs/escape.md']).toMatchObject({ status: 'missing', tokens: null });
    await app.close();
  });

  it('a doc beyond the 500-doc list cap is still attachable with status ok (AC90)', async () => {
    const app = await makeApp();
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context` })).json();
    expect(list.truncated).toBe(true);
    expect(list.docs.length).toBe(500);
    expect(list.docs.some((x: { path: string }) => x.path === 'zzz/last.md')).toBe(false);

    const agent = await newAgent(app, 'ctx-cap-agent');
    const res = await put(app, 'agents', agent, ['zzz/last.md']);
    expect(res.json().attached[0]).toMatchObject({ path: 'zzz/last.md', status: 'ok' });
    await app.close();
  });

  it('inherited lists only docs of enabled, linked skills (AC51, AC41)', async () => {
    const app = await makeApp();
    const agent = await newAgent(app, 'ctx-inh-agent');
    const on = await newSkill(app, 'ctx-inh-on');
    const off = await newSkill(app, 'ctx-inh-off');
    await put(app, 'skills', on, ['docs/b.md']);
    await put(app, 'skills', off, ['docs/c.md']);
    await put(app, 'agents', agent, ['docs/a.md']);
    const link = await app.inject({
      method: 'PUT',
      url: `/agents/${agent}/skills`,
      payload: {
        items: [
          { skill_id: on, enabled: true },
          { skill_id: off, enabled: false },
        ],
      },
    });
    expect(link.statusCode).toBe(200);

    const body = (await get(app, 'agents', agent)).json();
    expect(paths(body.attached)).toEqual(['docs/a.md']);
    expect(body.inherited).toEqual([
      expect.objectContaining({ path: 'docs/b.md', skill_id: on, skill_name: 'ctx-inh-on', status: 'ok' }),
    ]);

    expect((await get(app, 'skills', on)).json().inherited).toEqual([]);
    await app.close();
  });

  it('usage lists agents and skills that attached a doc (AC56, AC24)', async () => {
    const app = await makeApp();
    const agent = await newAgent(app, 'ctx-usage-agent');
    const skill = await newSkill(app, 'ctx-usage-skill');
    await put(app, 'agents', agent, ['docs/usage-target.md']);
    await put(app, 'skills', skill, ['docs/usage-target.md']);
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/usage?path=${encodeURIComponent('docs/usage-target.md')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      agents: [{ id: agent, name: 'ctx-usage-agent' }],
      skills: [{ id: skill, name: 'ctx-usage-skill' }],
    });
    await app.close();
  });

  it('deleting an agent, a skill or a repo removes its attachments (AC54)', async () => {
    const app = await makeApp();
    const agent = await newAgent(app, 'ctx-del-agent');
    const skill = await newSkill(app, 'ctx-del-skill');
    await put(app, 'agents', agent, ['docs/a.md']);
    await put(app, 'skills', skill, ['docs/a.md']);
    const rowsFor = async (col: 'agentId' | 'skillId', id: string) =>
      (await pg.handle.db.select().from(t.contextAttachments).where(eq(t.contextAttachments[col], id)))
        .length;
    expect(await rowsFor('agentId', agent)).toBe(1);
    expect(await rowsFor('skillId', skill)).toBe(1);

    expect((await app.inject({ method: 'DELETE', url: `/agents/${agent}` })).statusCode).toBeLessThan(300);
    expect(await rowsFor('agentId', agent)).toBe(0);
    expect((await app.inject({ method: 'DELETE', url: `/skills/${skill}` })).statusCode).toBeLessThan(300);
    expect(await rowsFor('skillId', skill)).toBe(0);

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ctx-del', fullName: 'acme/ctx-del', clonePath: cloneDir })
      .returning();
    const keeper = await newAgent(app, 'ctx-del-keeper');
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${keeper}/context?repo_id=${repo!.id}`,
      payload: { paths: ['docs/a.md'] },
    });
    expect(res.statusCode).toBe(200);
    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, repo!.id));
    const left = await pg.handle.db
      .select()
      .from(t.contextAttachments)
      .where(eq(t.contextAttachments.repoId, repo!.id));
    expect(left).toEqual([]);
    await app.close();
  });

  it('attaching docs does not create agent or skill versions (AC55)', async () => {
    const app = await makeApp();
    const agent = await newAgent(app, 'ctx-ver-agent');
    const skill = await newSkill(app, 'ctx-ver-skill');
    const snapshot = async () => ({
      agent: (await app.inject({ method: 'GET', url: `/agents/${agent}` })).json().version,
      agentVersions: (
        await pg.handle.db.select().from(t.agentVersions).where(eq(t.agentVersions.agentId, agent))
      ).length,
      skill: (await app.inject({ method: 'GET', url: `/skills/${skill}` })).json().version,
      skillVersions: (
        await pg.handle.db.select().from(t.skillVersions).where(eq(t.skillVersions.skillId, skill))
      ).length,
    });
    const before = await snapshot();
    await put(app, 'agents', agent, ['docs/a.md', 'docs/b.md']);
    await put(app, 'skills', skill, ['docs/c.md']);
    await put(app, 'agents', agent, ['docs/b.md']);
    expect(await snapshot()).toEqual(before);
    await app.close();
  });

  it('order survives a new app instance on the same database (NFR6)', async () => {
    const app1 = await makeApp();
    const agent = await newAgent(app1, 'ctx-persist-agent');
    await put(app1, 'agents', agent, ['docs/c.md', 'docs/a.md', 'docs/b.md']);
    await app1.close();

    const app2 = await makeApp();
    const res = await get(app2, 'agents', agent);
    expect(paths(res.json().attached)).toEqual(['docs/c.md', 'docs/a.md', 'docs/b.md']);
    await app2.close();
  });

  it('uncloned repo -> 409 repo_not_cloned incl. PUT; unknown ids -> 404', async () => {
    const app = await makeApp();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ctx-nc', fullName: 'acme/ctx-nc' })
      .returning();
    const agent = await newAgent(app, 'ctx-nc-agent');
    const list = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/context` });
    expect(list.statusCode).toBe(409);
    expect(list.json().error.code).toBe('repo_not_cloned');
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${agent}/context?repo_id=${repo!.id}`,
      payload: { paths: ['docs/a.md'] },
    });
    expect(res.statusCode).toBe(409);
    const nil = '00000000-0000-0000-0000-000000000000';
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${nil}/context?repo_id=${repoId}` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/repos/${nil}/context` })).statusCode).toBe(404);
    await app.close();
  });
});
