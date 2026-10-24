import { describe, expect, it } from 'vitest';
import {
  ContextAttachments,
  ContextDocUsage,
  SpecFile,
  SpecFileList,
} from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { ContextDomainError } from '../src/modules/context/domain.js';
import type { ContextFacade } from '../src/modules/context/types.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const ID = '11111111-1111-4111-8111-111111111111';
const REPO = '22222222-2222-4222-8222-222222222222';

const attachments: ContextAttachments = {
  repo_id: REPO,
  attached: [{ path: 'a.md', status: 'ok', tokens: 5 }],
  inherited: [],
};
const file: SpecFile = {
  path: 'a.md',
  folder: '',
  category: 'docs',
  tokens: 5,
  status: 'ok',
  size: 1,
  content: 'x',
};

function fake(over: Partial<ContextFacade> = {}): ContextFacade {
  return {
    list: async () => ({ docs: [file], truncated: false }),
    file: async () => file,
    usage: async () => ({ agents: [], skills: [] }),
    getAttachments: async () => attachments,
    setAttachments: async () => attachments,
    ...over,
  };
}

function app(projectContext: ContextFacade) {
  return buildApp({ config, overrides: { auth: new MockAuthProvider(), projectContext } });
}

const throwing = (code: ConstructorParameters<typeof ContextDomainError>[0]) => async () => {
  throw new ContextDomainError(code, code);
};

describe('repo context routes', () => {
  it('200 bodies match the contracts and pass workspace/id/path', async () => {
    const calls: unknown[][] = [];
    const a = await app(
      fake({
        file: async (...args) => (calls.push(args), file),
        usage: async (...args) => (calls.push(args), { agents: [{ id: 'a', name: 'A' }], skills: [] }),
      }),
    );
    const list = await a.inject({ method: 'GET', url: `/repos/${ID}/context` });
    expect(list.statusCode).toBe(200);
    expect(SpecFileList.safeParse(list.json()).success).toBe(true);
    const f = await a.inject({ method: 'GET', url: `/repos/${ID}/context/file?path=a.md` });
    expect(SpecFile.safeParse(f.json()).success).toBe(true);
    const u = await a.inject({ method: 'GET', url: `/repos/${ID}/context/usage?path=a.md` });
    expect(ContextDocUsage.safeParse(u.json()).success).toBe(true);
    expect(calls).toEqual([
      ['w1', ID, 'a.md'],
      ['w1', ID, 'a.md'],
    ]);
    await a.close();
  });

  it('404 for an unknown repo on all three routes (AC7)', async () => {
    const a = await app(
      fake({
        list: throwing('repo_not_found'),
        file: throwing('repo_not_found'),
        usage: throwing('repo_not_found'),
      }),
    );
    for (const url of [
      `/repos/${ID}/context`,
      `/repos/${ID}/context/file?path=a.md`,
      `/repos/${ID}/context/usage?path=a.md`,
    ]) {
      expect((await a.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
    await a.close();
  });

  it('409 repo_not_cloned (AC6)', async () => {
    const a = await app(fake({ list: throwing('repo_not_cloned') }));
    const res = await a.inject({ method: 'GET', url: `/repos/${ID}/context` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_cloned');
    await a.close();
  });

  it('422 invalid_path and 404 doc_not_found on /file (AC9, AC10)', async () => {
    const bad = await app(fake({ file: throwing('invalid_path') }));
    const r1 = await bad.inject({ method: 'GET', url: `/repos/${ID}/context/file?path=../x.md` });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().error.code).toBe('validation_error');
    await bad.close();
    const nf = await app(fake({ file: throwing('doc_not_found') }));
    const r2 = await nf.inject({ method: 'GET', url: `/repos/${ID}/context/file?path=a.md` });
    expect(r2.statusCode).toBe(404);
    await nf.close();
  });

  it('missing path query or non-uuid id -> 422 without calling the facade', async () => {
    let called = false;
    const a = await app(fake({ list: async () => ((called = true), { docs: [], truncated: false }) }));
    expect((await a.inject({ method: 'GET', url: `/repos/${ID}/context/file` })).statusCode).toBe(422);
    expect((await a.inject({ method: 'GET', url: '/repos/nope/context' })).statusCode).toBe(422);
    expect(called).toBe(false);
    await a.close();
  });
});

describe.each(['agents', 'skills'] as const)('/%s/:id/context', (plural) => {
  const url = `/${plural}/${ID}/context?repo_id=${REPO}`;

  it('GET and PUT pass owner, repo and paths and match ContextAttachments', async () => {
    const calls: unknown[][] = [];
    const a = await app(
      fake({
        getAttachments: async (...args) => (calls.push(['get', ...args]), attachments),
        setAttachments: async (...args) => (calls.push(['set', ...args]), attachments),
      }),
    );
    const kind = plural === 'agents' ? 'agent' : 'skill';
    const g = await a.inject({ method: 'GET', url });
    expect(ContextAttachments.safeParse(g.json()).success).toBe(true);
    const p = await a.inject({ method: 'PUT', url, payload: { paths: ['a.md', 'b.md'] } });
    expect(p.statusCode).toBe(200);
    expect(ContextAttachments.safeParse(p.json()).success).toBe(true);
    expect(calls).toEqual([
      ['get', 'w1', { kind, id: ID }, REPO],
      ['set', 'w1', { kind, id: ID }, REPO, ['a.md', 'b.md']],
    ]);
    await a.close();
  });

  it('404 for unknown owner/repo (AC53), 409 not cloned (AC91)', async () => {
    for (const [code, status] of [
      [`${plural === 'agents' ? 'agent' : 'skill'}_not_found`, 404],
      ['repo_not_found', 404],
      ['repo_not_cloned', 409],
    ] as const) {
      const a = await app(fake({ getAttachments: throwing(code), setAttachments: throwing(code) }));
      expect((await a.inject({ method: 'GET', url })).statusCode).toBe(status);
      expect((await a.inject({ method: 'PUT', url, payload: { paths: [] } })).statusCode).toBe(status);
      await a.close();
    }
  });

  it('422 on > 50 paths (schema) and on invalid_path (service) (AC52)', async () => {
    let called = false;
    const a = await app(fake({ setAttachments: async () => ((called = true), attachments) }));
    const many = Array.from({ length: 51 }, (_, i) => `d${i}.md`);
    expect((await a.inject({ method: 'PUT', url, payload: { paths: many } })).statusCode).toBe(422);
    expect((await a.inject({ method: 'PUT', url, payload: { paths: [''] } })).statusCode).toBe(422);
    expect(called).toBe(false);
    await a.close();

    const b = await app(fake({ setAttachments: throwing('invalid_path') }));
    expect((await b.inject({ method: 'PUT', url, payload: { paths: ['../x.md'] } })).statusCode).toBe(422);
    await b.close();
  });

  it('missing repo_id -> 422', async () => {
    const a = await app(fake());
    expect((await a.inject({ method: 'GET', url: `/${plural}/${ID}/context` })).statusCode).toBe(422);
    await a.close();
  });
});
