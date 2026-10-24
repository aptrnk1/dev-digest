import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsDocSource } from '../src/modules/context/fs-scanner.js';
import { MAX_DOC_BYTES } from '../src/modules/context/constants.js';

let root: string;
let outside: string;
const src = new FsDocSource();

async function put(rel: string, content = 'x') {
  const full = join(root, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'ctx-root-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'ctx-out-')));
  await mkdir(join(root, '.git'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('FsDocSource.isClone', () => {
  it('true for a dir with a git tree', async () => {
    expect(await src.isClone(root)).toBe(true);
  });
  it('false for a missing dir, a file, or a dir without .git', async () => {
    expect(await src.isClone(join(root, 'nope'))).toBe(false);
    await put('f.md');
    expect(await src.isClone(join(root, 'f.md'))).toBe(false);
    expect(await src.isClone(outside)).toBe(false);
  });
});

describe('FsDocSource.list', () => {
  it('keeps only .md/.mdx outside excluded dirs, sorted by path', async () => {
    await put('b.md');
    await put('a.mdx');
    await put('docs/z.md');
    await put('notes.txt');
    await put('node_modules/p/README.md');
    await put('sub/vendor/x.md');
    await put('dist/x.md');
    await put('build/x.md');
    await put('.git/x.md');
    await put('.github/x.md');
    await put('.devdigest/keep.md');
    const docs = await src.list(root);
    expect(docs.map((d) => d.path)).toEqual(['.devdigest/keep.md', 'a.mdx', 'b.md', 'docs/z.md']);
    expect(docs[0]).toMatchObject({ size: 1 });
    expect(typeof docs[0]?.mtime).toBe('string');
  });

  it('does not descend into symlinked dirs (incl. cycles) and drops symlink files escaping the clone', async () => {
    await put('real/a.md');
    await symlink(join(root, 'real'), join(root, 'link'));
    await symlink(root, join(root, 'real', 'loop'));
    await writeFile(join(outside, 'secret.md'), 'secret');
    await symlink(join(outside, 'secret.md'), join(root, 'leak.md'));
    await put('inside.md');
    await symlink(join(root, 'inside.md'), join(root, 'alias.md'));
    const docs = await src.list(root);
    expect(docs.map((d) => d.path)).toEqual(['alias.md', 'inside.md', 'real/a.md']);
  });
});

describe('FsDocSource.list resilience', () => {
  it('skips an unreadable directory instead of failing the scan', async () => {
    await put('ok.md');
    await put('locked/x.md');
    await chmod(join(root, 'locked'), 0o000);
    try {
      expect((await src.list(root)).map((d) => d.path)).toEqual(['ok.md']);
    } finally {
      await chmod(join(root, 'locked'), 0o755);
    }
  });
});

describe('FsDocSource dot-dot-prefixed names', () => {
  it('lists and reads a root file named ..notes.md as ok', async () => {
    await put('..notes.md', 'hi');
    expect((await src.list(root)).map((d) => d.path)).toEqual(['..notes.md']);
    expect(await src.read(root, '..notes.md')).toEqual({ kind: 'ok', content: 'hi', size: 2 });
  });
});

describe('FsDocSource.list root failure', () => {
  it('rejects when the clone root itself is unreadable', async () => {
    await put('ok.md');
    await chmod(root, 0o000);
    try {
      await expect(src.list(root)).rejects.toThrow();
    } finally {
      await chmod(root, 0o755);
    }
  });
});

describe('FsDocSource.read', () => {
  it('reads an ok file', async () => {
    await put('docs/a.md', 'hello');
    expect(await src.read(root, 'docs/a.md')).toEqual({ kind: 'ok', content: 'hello', size: 5 });
  });

  it('too_large without reading content', async () => {
    await put('big.md', 'a'.repeat(MAX_DOC_BYTES + 1));
    expect(await src.read(root, 'big.md')).toEqual({ kind: 'too_large', size: MAX_DOC_BYTES + 1 });
  });

  it('missing for absent files and directories', async () => {
    await mkdir(join(root, 'd.md'));
    expect(await src.read(root, 'nope.md')).toEqual({ kind: 'missing' });
    expect(await src.read(root, 'd.md')).toEqual({ kind: 'missing' });
  });

  it('missing when the realpath escapes the clone', async () => {
    await writeFile(join(outside, 'secret.md'), 'secret');
    await symlink(join(outside, 'secret.md'), join(root, 'leak.md'));
    expect(await src.read(root, 'leak.md')).toEqual({ kind: 'outside' });
    expect(await src.read(root, '../' + outside.split('/').pop() + '/secret.md')).toEqual({
      kind: 'outside',
    });
  });

  it('outside when an intermediate symlinked directory leads out of the clone', async () => {
    await writeFile(join(outside, 'secret.md'), 'secret');
    await symlink(outside, join(root, 'escape'));
    expect(await src.read(root, 'escape/secret.md')).toEqual({ kind: 'outside' });
  });

  it('missing when the path goes through a symlinked directory, even one inside the clone', async () => {
    await put('real/a.md', 'hi');
    await symlink(join(root, 'real'), join(root, 'link'));
    expect(await src.read(root, 'link/a.md')).toEqual({ kind: 'missing' });
  });
});
