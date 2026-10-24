import { describe, expect, it, vi } from 'vitest';
import { renderSpecsBlock } from '@devdigest/reviewer-core';
import { RunContextService } from '../src/modules/context/run-context.service.js';
import type { RepoContextInput, RunAttachments, RunContextInput } from '../src/modules/context/types.js';

const repo = { owner: 'o', name: 'r' };
const input: RunContextInput = {
  repoId: 'r1',
  agentId: 'a1',
  repo,
  clonePath: '/clone',
  base: 'main',
};
const chars = { count: (t: string) => t.length };

function setup(opts: {
  attached?: RunAttachments;
  files?: Record<string, string | null | Error>;
  isClone?: boolean;
  hasRef?: boolean;
}) {
  const logs: string[] = [];
  const loadForRun = vi.fn(async (_agentId: string, _repoId: string) => opts.attached ?? { own: [], skills: [] });
  const isClone = vi.fn(async (_root: string) => opts.isClone ?? true);
  const hasRef = vi.fn(async (_r: unknown, _ref: string) => opts.hasRef ?? true);
  const showFile = vi.fn(async (_r: unknown, _ref: string, path: string) => {
    const v = opts.files?.[path];
    if (v instanceof Error) throw v;
    return v ?? null;
  });
  const svc = new RunContextService({
    store: { loadForRun },
    docs: { isClone },
    git: { hasRef, showFile },
    tokenizer: chars,
  });
  return { svc, logs, log: { info: (m: string) => logs.push(m) }, loadForRun, isClone, hasRef, showFile };
}

describe('RunContextService.resolveForRun', () => {
  it('merges own then skills (AC57), reads origin/<base> (AC58), keeps order (AC59)', async () => {
    const s = setup({
      attached: {
        own: ['a.md', 'b.md'],
        skills: [{ skillId: 's', skillName: 'S', paths: ['b.md', 'c.md'] }],
      },
      files: { 'a.md': 'AA', 'b.md': 'BB', 'c.md': 'CC' },
    });
    const out = await s.svc.resolveForRun(input, s.log);
    expect(out.specs).toEqual([
      { path: 'a.md', content: 'AA' },
      { path: 'b.md', content: 'BB' },
      { path: 'c.md', content: 'CC' },
    ]);
    expect(out.specsRead).toEqual(['a.md', 'b.md', 'c.md']);
    expect(s.showFile.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['origin/main', 'a.md'],
      ['origin/main', 'b.md'],
      ['origin/main', 'c.md'],
    ]);
    expect(s.hasRef).toHaveBeenCalledWith(repo, 'origin/main');
    const total = chars.count(renderSpecsBlock(out.specs)!);
    expect(s.logs).toEqual([`Project context: 3 doc(s), +${total} tokens — a.md, b.md, c.md`]);
  });

  it('skips a doc that would exceed the budget, later smaller ones still fit (AC60, NFR2)', async () => {
    const s = setup({
      attached: { own: ['a.md', 'b.md', 'c.md'], skills: [] },
      files: { 'a.md': 'a'.repeat(5000), 'b.md': 'b'.repeat(4000), 'c.md': 'c'.repeat(2000) },
    });
    const out = await s.svc.resolveForRun(input, s.log);
    expect(out.specsRead).toEqual(['a.md', 'c.md']);
    expect(chars.count(renderSpecsBlock(out.specs)!)).toBeLessThanOrEqual(8000);
    expect(s.logs[0]).toBe('Project context: skipped b.md (budget)');
    expect(s.logs).toHaveLength(2);
    expect(s.logs[1]).toMatch(/^Project context: 2 doc\(s\), \+\d+ tokens — a\.md, c\.md$/);
  });

  it('skips null, >1MB and throwing docs as missing (AC61)', async () => {
    const s = setup({
      attached: { own: ['n.md', 'big.md', 'err.md', 'ok.md'], skills: [] },
      files: {
        'n.md': null,
        'big.md': 'x'.repeat(1_048_577),
        'err.md': new Error('boom'),
        'ok.md': 'ok',
      },
    });
    const out = await s.svc.resolveForRun(input, s.log);
    expect(out.specsRead).toEqual(['ok.md']);
    expect(s.logs.slice(0, 3)).toEqual([
      'Project context: skipped n.md (missing)',
      'Project context: skipped big.md (missing)',
      'Project context: skipped err.md (missing)',
    ]);
    expect(s.logs).toHaveLength(4);
  });

  it('none attached: one line, no clone/git access (AC64)', async () => {
    const s = setup({});
    const out = await s.svc.resolveForRun(input, s.log);
    expect(out).toEqual({ specs: [], specsRead: [] });
    expect(s.logs).toEqual(['Project context: none attached']);
    expect(s.isClone).not.toHaveBeenCalled();
    expect(s.hasRef).not.toHaveBeenCalled();
  });

  it('repo not cloned: null clonePath or missing dir (AC63)', async () => {
    const attached = { own: ['a.md'], skills: [] };
    const a = setup({ attached });
    await a.svc.resolveForRun({ ...input, clonePath: null }, a.log);
    expect(a.logs).toEqual(['Project context: repo not cloned — skipped']);
    const b = setup({ attached, isClone: false });
    const out = await b.svc.resolveForRun(input, b.log);
    expect(out).toEqual({ specs: [], specsRead: [] });
    expect(b.logs).toEqual(['Project context: repo not cloned — skipped']);
    expect(b.hasRef).not.toHaveBeenCalled();
  });

  it('base ref absent: one line, no showFile (AC79)', async () => {
    const s = setup({ attached: { own: ['a.md'], skills: [] }, hasRef: false, files: { 'a.md': 'x' } });
    const out = await s.svc.resolveForRun(input, s.log);
    expect(out).toEqual({ specs: [], specsRead: [] });
    expect(s.logs).toEqual(['Project context: base branch main not fetched — skipped']);
    expect(s.showFile).not.toHaveBeenCalled();
  });

  it('all skipped: per-doc lines then the summary (AC82)', async () => {
    const s = setup({ attached: { own: ['a.md'], skills: [] } });
    const out = await s.svc.resolveForRun(input, s.log);
    expect(out).toEqual({ specs: [], specsRead: [] });
    expect(s.logs).toEqual([
      'Project context: skipped a.md (missing)',
      'Project context: no documents injected (all skipped)',
    ]);
  });

  it('loads attachments once, at the start (AC67)', async () => {
    const s = setup({ attached: { own: ['a.md', 'b.md'], skills: [] }, files: { 'a.md': 'A', 'b.md': 'B' } });
    await s.svc.resolveForRun(input, s.log);
    expect(s.loadForRun).toHaveBeenCalledTimes(1);
    expect(s.loadForRun).toHaveBeenCalledWith('a1', 'r1');
  });
});

const repoInput: RepoContextInput = {
  workspaceId: 'w1',
  repoId: 'r1',
  repo,
  clonePath: '/clone',
  base: 'main',
};

function setupRepo(opts: {
  agents?: string[];
  attached?: Record<string, RunAttachments>;
  files?: Record<string, string | null>;
  isClone?: boolean;
  hasRef?: boolean;
}) {
  const logs: string[] = [];
  const listEnabledAgentIds = vi.fn(async (_ws: string) => opts.agents ?? []);
  const loadForRun = vi.fn(
    async (agentId: string, _repoId: string) => opts.attached?.[agentId] ?? { own: [], skills: [] },
  );
  const showFile = vi.fn(async (_r: unknown, _ref: string, path: string) => opts.files?.[path] ?? null);
  const svc = new RunContextService({
    store: { loadForRun, listEnabledAgentIds },
    docs: { isClone: async () => opts.isClone ?? true },
    git: { hasRef: async () => opts.hasRef ?? true, showFile },
    tokenizer: chars,
  });
  return { svc, logs, log: { info: (m: string) => logs.push(m) }, loadForRun, listEnabledAgentIds, showFile };
}

describe('RunContextService.resolveForRepo', () => {
  it('unions enabled agents in order, own then skills, first occurrence wins (AC42)', async () => {
    const s = setupRepo({
      agents: ['a1', 'a2'],
      attached: {
        a1: { own: ['a.md'], skills: [{ skillId: 's', skillName: 'S', paths: ['b.md'] }] },
        a2: { own: ['b.md', 'c.md'], skills: [] },
      },
      files: { 'a.md': 'AA', 'b.md': 'BB', 'c.md': 'CC' },
    });
    const out = await s.svc.resolveForRepo(repoInput, s.log);
    expect(out.specsRead).toEqual(['a.md', 'b.md', 'c.md']);
    expect(s.listEnabledAgentIds).toHaveBeenCalledWith('w1');
    expect(s.loadForRun.mock.calls.map((c) => c[0])).toEqual(['a1', 'a2']);
    expect(s.showFile.mock.calls.map((c) => c[1])).toEqual(['origin/main', 'origin/main', 'origin/main']);
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toMatch(/^Project context: 3 doc\(s\), \+\d+ tokens — a\.md, b\.md, c\.md$/);
  });

  it('applies the shared budget and skip rules across agents', async () => {
    const s = setupRepo({
      agents: ['a1', 'a2'],
      attached: { a1: { own: ['a.md', 'gone.md'], skills: [] }, a2: { own: ['b.md', 'c.md'], skills: [] } },
      files: { 'a.md': 'a'.repeat(5000), 'b.md': 'b'.repeat(4000), 'c.md': 'c'.repeat(2000) },
    });
    const out = await s.svc.resolveForRepo(repoInput, s.log);
    expect(out.specsRead).toEqual(['a.md', 'c.md']);
    expect(s.logs).toContain('Project context: skipped gone.md (missing)');
    expect(s.logs).toContain('Project context: skipped b.md (budget)');
  });

  it('no enabled agents / no attachments → empty', async () => {
    const none = setupRepo({});
    expect(await none.svc.resolveForRepo(repoInput, none.log)).toEqual({ specs: [], specsRead: [] });
    expect(none.logs).toEqual(['Project context: none attached']);
    const empty = setupRepo({ agents: ['a1'] });
    expect(await empty.svc.resolveForRepo(repoInput, empty.log)).toEqual({ specs: [], specsRead: [] });
  });

  it('not cloned or base ref missing → empty', async () => {
    const attached = { a1: { own: ['a.md'], skills: [] } };
    const a = setupRepo({ agents: ['a1'], attached, files: { 'a.md': 'x' } });
    expect(await a.svc.resolveForRepo({ ...repoInput, clonePath: null }, a.log)).toEqual({
      specs: [],
      specsRead: [],
    });
    const b = setupRepo({ agents: ['a1'], attached, files: { 'a.md': 'x' }, hasRef: false });
    expect(await b.svc.resolveForRepo(repoInput, b.log)).toEqual({ specs: [], specsRead: [] });
    expect(b.showFile).not.toHaveBeenCalled();
  });
});
