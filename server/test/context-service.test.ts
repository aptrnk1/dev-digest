import { describe, expect, it } from 'vitest';
import { wrapSpec } from '@devdigest/reviewer-core';
import { ContextService } from '../src/modules/context/service.js';
import { ContextDomainError } from '../src/modules/context/domain.js';
import { MAX_DOC_BYTES, MAX_DOCS } from '../src/modules/context/constants.js';
import type {
  AttachmentStore,
  DocRead,
  DocSource,
  ScannedDoc,
} from '../src/modules/context/ports.js';
import type { ContextOwnerRef, RunAttachments } from '../src/modules/context/types.js';

const WS = 'w1';
const REPO = 'r1';
const AGENT: ContextOwnerRef = { kind: 'agent', id: 'a1' };
const SKILL: ContextOwnerRef = { kind: 'skill', id: 's1' };

class FakeDocs implements DocSource {
  cloned = true;
  files: Record<string, DocRead> = {};
  scanned: ScannedDoc[] = [];
  reads: string[] = [];
  async isClone() {
    return this.cloned;
  }
  listError: Error | null = null;
  async list() {
    if (this.listError) throw this.listError;
    return this.scanned;
  }
  async read(_root: string, path: string): Promise<DocRead> {
    this.reads.push(path);
    return this.files[path] ?? { kind: 'missing' };
  }
}

class FakeStore implements AttachmentStore {
  repo: { id: string; clonePath: string | null } | null = { id: REPO, clonePath: '/clone' };
  owners = new Set(['agent:a1', 'skill:s1']);
  own: string[] = [];
  run: RunAttachments = { own: [], skills: [] };
  replaced: string[][] = [];
  async findRepo() {
    return this.repo;
  }
  async ownerExists(_ws: string, o: ContextOwnerRef) {
    return this.owners.has(`${o.kind}:${o.id}`);
  }
  async listOwn() {
    return this.own;
  }
  async replace(_ws: string, _o: ContextOwnerRef, _r: string, paths: string[]) {
    this.replaced.push(paths);
    this.own = paths;
  }
  async usage() {
    return { agents: [{ id: 'a1', name: 'A' }], skills: [] };
  }
  async loadForRun() {
    return this.run;
  }
}

const counter = { count: (t: string) => t.length };

function setup() {
  const docs = new FakeDocs();
  const store = new FakeStore();
  const svc = new ContextService({ store, docs, tokens: counter });
  return { docs, store, svc };
}

const ok = (content: string): DocRead => ({ kind: 'ok', content, size: content.length });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ContextDomainError ? e.code : 'other';
  }
  return 'none';
};

describe('ContextService.list', () => {
  it('maps an unreadable clone root to repo_not_cloned without leaking the path', async () => {
    const { docs, svc } = setup();
    docs.listError = new Error("EACCES: permission denied, scandir '/Users/x/.devdigest/clones/r'");
    expect(await code(svc.list(WS, REPO))).toBe('repo_not_cloned');
    await expect(svc.list(WS, REPO)).rejects.toThrow(/^Repository is not cloned$/);
  });

  it('maps docs with folder/category/size and tokens = count(wrapSpec) (AC2, AC3, AC11)', async () => {
    const { docs, svc } = setup();
    docs.scanned = [
      { path: 'README.md', size: 3, mtime: '2026-01-01T00:00:00.000Z' },
      { path: 'specs/a.md', size: 5, mtime: null },
    ];
    docs.files['README.md'] = ok('hey');
    docs.files['specs/a.md'] = ok('hello');
    const res = await svc.list(WS, REPO);
    expect(res.truncated).toBe(false);
    expect(res.docs[0]).toMatchObject({
      path: 'README.md',
      folder: '',
      category: 'docs',
      size: 3,
      status: 'ok',
      updated_at: '2026-01-01T00:00:00.000Z',
      tokens: wrapSpec({ path: 'README.md', content: 'hey' }).length,
    });
    expect(res.docs[1]).toMatchObject({ folder: 'specs/', category: 'specs' });
    expect(res.docs[0]?.content).toBeUndefined();
  });

  it('too_large: tokens null and content never read (AC4)', async () => {
    const { docs, svc } = setup();
    docs.scanned = [{ path: 'big.md', size: MAX_DOC_BYTES + 1, mtime: null }];
    const res = await svc.list(WS, REPO);
    expect(res.docs[0]).toMatchObject({ status: 'too_large', tokens: null });
    expect(docs.reads).toEqual([]);
  });

  it('returns the first 500 and truncated (AC5)', async () => {
    const { docs, svc } = setup();
    docs.scanned = Array.from({ length: MAX_DOCS + 3 }, (_, i) => ({
      path: `d${String(i).padStart(4, '0')}.md`,
      size: 1,
      mtime: null,
    }));
    for (const d of docs.scanned) docs.files[d.path] = ok('x');
    const res = await svc.list(WS, REPO);
    expect(res.docs).toHaveLength(MAX_DOCS);
    expect(res.truncated).toBe(true);
  });

  it('repo_not_found / repo_not_cloned (AC6, AC7)', async () => {
    const { docs, store, svc } = setup();
    docs.cloned = false;
    expect(await code(svc.list(WS, REPO))).toBe('repo_not_cloned');
    docs.cloned = true;
    store.repo = { id: REPO, clonePath: null };
    expect(await code(svc.list(WS, REPO))).toBe('repo_not_cloned');
    store.repo = null;
    expect(await code(svc.list(WS, REPO))).toBe('repo_not_found');
  });
});

describe('ContextService.file', () => {
  it('returns path and content (AC8)', async () => {
    const { docs, svc } = setup();
    docs.files['a.md'] = ok('body');
    const f = await svc.file(WS, REPO, 'a.md');
    expect(f).toMatchObject({ path: 'a.md', content: 'body', status: 'ok', size: 4 });
  });

  it('missing or too large -> doc_not_found (AC10)', async () => {
    const { docs, svc } = setup();
    expect(await code(svc.file(WS, REPO, 'a.md'))).toBe('doc_not_found');
    docs.files['a.md'] = { kind: 'too_large', size: MAX_DOC_BYTES + 1 };
    expect(await code(svc.file(WS, REPO, 'a.md'))).toBe('doc_not_found');
  });

  it('realpath outside the clone -> invalid_path (AC9)', async () => {
    const { docs, svc } = setup();
    docs.files['leak.md'] = { kind: 'outside' };
    expect(await code(svc.file(WS, REPO, 'leak.md'))).toBe('invalid_path');
  });

  it('bad path -> invalid_path without reading (AC9)', async () => {
    const { docs, svc } = setup();
    for (const p of ['/abs.md', '../x.md', 'a.txt', 'node_modules/a.md', '.hid/a.md']) {
      expect(await code(svc.file(WS, REPO, p))).toBe('invalid_path');
    }
    expect(docs.reads).toEqual([]);
  });

  it('usage validates repo and path', async () => {
    const { store, svc } = setup();
    expect(await svc.usage(WS, REPO, 'a.md')).toEqual({ agents: [{ id: 'a1', name: 'A' }], skills: [] });
    expect(await code(svc.usage(WS, REPO, '../a.md'))).toBe('invalid_path');
    store.repo = null;
    expect(await code(svc.usage(WS, REPO, 'a.md'))).toBe('repo_not_found');
  });
});

describe('ContextService.getAttachments', () => {
  it('statuses are independent of the 500 limit; tokens only for ok (AC51, AC90)', async () => {
    const { docs, store, svc } = setup();
    store.own = ['z-late.md', 'big.md', 'gone.md'];
    docs.scanned = [];
    docs.files['z-late.md'] = ok('abc');
    docs.files['big.md'] = { kind: 'too_large', size: MAX_DOC_BYTES + 1 };
    const res = await svc.getAttachments(WS, AGENT, REPO);
    expect(res.repo_id).toBe(REPO);
    expect(res.attached).toEqual([
      { path: 'z-late.md', status: 'ok', tokens: wrapSpec({ path: 'z-late.md', content: 'abc' }).length },
      { path: 'big.md', status: 'too_large', tokens: null },
      { path: 'gone.md', status: 'missing', tokens: null },
    ]);
    expect(res.inherited).toEqual([]);
  });

  it('an escaping path is reported as missing (AC51)', async () => {
    const { docs, store, svc } = setup();
    store.own = ['leak.md'];
    docs.files['leak.md'] = { kind: 'outside' };
    const res = await svc.getAttachments(WS, AGENT, REPO);
    expect(res.attached).toEqual([{ path: 'leak.md', status: 'missing', tokens: null }]);
  });

  it('inherited = skill docs not attached by the agent, in merge order, once (AC41)', async () => {
    const { docs, store, svc } = setup();
    store.own = ['a.md'];
    store.run = {
      own: ['a.md'],
      skills: [
        { skillId: 's1', skillName: 'One', paths: ['a.md', 'b.md'] },
        { skillId: 's2', skillName: 'Two', paths: ['b.md', 'c.md'] },
      ],
    };
    docs.files['a.md'] = ok('1');
    docs.files['b.md'] = ok('22');
    const res = await svc.getAttachments(WS, AGENT, REPO);
    expect(res.attached.map((a) => a.path)).toEqual(['a.md']);
    expect(res.inherited).toEqual([
      { path: 'b.md', skill_id: 's1', skill_name: 'One', status: 'ok', tokens: wrapSpec({ path: 'b.md', content: '22' }).length },
      { path: 'c.md', skill_id: 's2', skill_name: 'Two', status: 'missing', tokens: null },
    ]);
  });

  it('skill owner: inherited is always empty', async () => {
    const { store, svc } = setup();
    store.own = ['a.md'];
    store.run = { own: [], skills: [{ skillId: 's9', skillName: 'X', paths: ['q.md'] }] };
    const res = await svc.getAttachments(WS, SKILL, REPO);
    expect(res.inherited).toEqual([]);
  });

  it('404s before 409; not cloned -> repo_not_cloned (AC53, AC91)', async () => {
    const { docs, store, svc } = setup();
    docs.cloned = false;
    expect(await code(svc.getAttachments(WS, AGENT, REPO))).toBe('repo_not_cloned');
    expect(await code(svc.getAttachments(WS, { kind: 'agent', id: 'zz' }, REPO))).toBe('agent_not_found');
    expect(await code(svc.getAttachments(WS, { kind: 'skill', id: 'zz' }, REPO))).toBe('skill_not_found');
    store.repo = null;
    expect(await code(svc.getAttachments(WS, AGENT, REPO))).toBe('repo_not_found');
  });
});

describe('ContextService.setAttachments', () => {
  it('replaces the list in order and returns the stored state', async () => {
    const { docs, store, svc } = setup();
    docs.files['b.md'] = ok('b');
    docs.files['a.md'] = ok('a');
    const res = await svc.setAttachments(WS, AGENT, REPO, ['b.md', 'a.md']);
    expect(store.replaced).toEqual([['b.md', 'a.md']]);
    expect(res.attached.map((a) => a.path)).toEqual(['b.md', 'a.md']);
  });

  it('bad path, duplicate or too many -> invalid_path, nothing written (AC52)', async () => {
    const { store, svc } = setup();
    expect(await code(svc.setAttachments(WS, AGENT, REPO, ['ok.md', '../x.md']))).toBe('invalid_path');
    expect(await code(svc.setAttachments(WS, AGENT, REPO, ['a.md', 'a.md']))).toBe('invalid_path');
    const many = Array.from({ length: 51 }, (_, i) => `d${i}.md`);
    expect(await code(svc.setAttachments(WS, AGENT, REPO, many))).toBe('invalid_path');
    expect(store.replaced).toEqual([]);
  });

  it('unknown agent, skill or repo -> *_not_found, nothing written (AC53)', async () => {
    const { store, svc } = setup();
    expect(await code(svc.setAttachments(WS, { kind: 'agent', id: 'zz' }, REPO, []))).toBe('agent_not_found');
    expect(await code(svc.setAttachments(WS, { kind: 'skill', id: 'zz' }, REPO, []))).toBe('skill_not_found');
    store.repo = null;
    expect(await code(svc.setAttachments(WS, AGENT, REPO, []))).toBe('repo_not_found');
    expect(store.replaced).toEqual([]);
  });
});
