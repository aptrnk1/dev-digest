import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsRepoFiles } from '../src/modules/onboarding/fs-source.js';

let root: string;
let outside: string;
const fs = new FsRepoFiles();
const EXCLUDE = ['node_modules', 'dist', 'vendor', '.git'];

async function put(rel: string, content = 'x'): Promise<void> {
  const full = join(root, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'onb-root-'));
  outside = await mkdtemp(join(tmpdir(), 'onb-out-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('FsRepoFiles.isClone (AC47)', () => {
  it('is false for a missing dir, a file and a dir without .git', async () => {
    expect(await fs.isClone(join(root, 'nope'))).toBe(false);
    await put('file.txt');
    expect(await fs.isClone(join(root, 'file.txt'))).toBe(false);
    expect(await fs.isClone(root)).toBe(false);
  });
  it('is true with a .git entry', async () => {
    await mkdir(join(root, '.git'));
    expect(await fs.isClone(root)).toBe(true);
  });
});

describe('FsRepoFiles.listTree', () => {
  it('skips excluded dirs, sorts ascending, caps, does not enter symlinked dirs', async () => {
    await put('b.ts');
    await put('a/z.ts');
    await put('a/a.ts');
    await put('node_modules/x/index.js');
    await put('src/vendor/v.ts');
    await put('.git/config');
    await put('dist/o.js');
    await writeFile(join(outside, 'secret.ts'), 's');
    await symlink(outside, join(root, 'linked'));
    expect(await fs.listTree(root, { limit: 100, excludeDirs: EXCLUDE })).toEqual([
      'a/a.ts',
      'a/z.ts',
      'b.ts',
    ]);
    expect(await fs.listTree(root, { limit: 2, excludeDirs: EXCLUDE })).toEqual(['a/a.ts', 'a/z.ts']);
  });

  it('listRootFiles returns root regular files only', async () => {
    await put('README.md');
    await put('package.json');
    await put('src/a.ts');
    expect((await fs.listRootFiles(root)).sort()).toEqual(['README.md', 'package.json']);
  });
});

describe('FsRepoFiles.readCapped', () => {
  it('caps lines', async () => {
    await put('m.txt', Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n'));
    expect(await fs.readCapped(root, 'm.txt', { maxLines: 3, maxChars: 1000 })).toBe('l0\nl1\nl2');
  });
  it('caps chars on a minified single-line file', async () => {
    await put('min.js', 'a'.repeat(5000));
    const out = await fs.readCapped(root, 'min.js', { maxLines: 400, maxChars: 100 });
    expect(out).toHaveLength(100);
  });
  it('returns null for missing, directory, escaping symlink', async () => {
    await put('d/x.txt');
    await writeFile(join(outside, 's.txt'), 'secret');
    await symlink(join(outside, 's.txt'), join(root, 'link.txt'));
    const o = { maxLines: 10, maxChars: 100 };
    expect(await fs.readCapped(root, 'missing.txt', o)).toBeNull();
    expect(await fs.readCapped(root, 'd', o)).toBeNull();
    expect(await fs.readCapped(root, 'link.txt', o)).toBeNull();
  });
});

describe('FsRepoFiles.readCapped symlinks and bounded read (AC57)', () => {
  const o = { maxLines: 10, maxChars: 100 };
  it('never reads through a file symlink, even one pointing inside the clone', async () => {
    await put('.env', 'SECRET=1');
    await mkdir(join(root, 'config'), { recursive: true });
    await symlink('../.env', join(root, 'config/settings.txt'));
    expect(await fs.readCapped(root, 'config/settings.txt', o)).toBeNull();
    expect(await fs.readCapped(root, '.env', o)).toBe('SECRET=1');
  });
  it('never reads through a symlinked directory component', async () => {
    await put('real/a.txt', 'hi');
    await symlink('real', join(root, 'alias'));
    expect(await fs.readCapped(root, 'alias/a.txt', o)).toBeNull();
    expect(await fs.readCapped(root, 'real/a.txt', o)).toBe('hi');
  });
  it('caps a large multibyte file and keeps small files unchanged', async () => {
    await put('big.txt', 'é'.repeat(200_000));
    expect(await fs.readCapped(root, 'big.txt', { maxLines: 5, maxChars: 50 })).toBe('é'.repeat(50));
    await put('small.txt', 'a\nb');
    expect(await fs.readCapped(root, 'small.txt', o)).toBe('a\nb');
  });
});

describe('FsRepoFiles.isRegularFileInside (AC62)', () => {
  it('rejects symlinks out of the clone and non-files', async () => {
    await put('ok.ts');
    await put('..notes.md');
    await put('dir/x.ts');
    await writeFile(join(outside, 's.txt'), 'secret');
    await symlink(join(outside, 's.txt'), join(root, 'link.txt'));
    await symlink(join(root, 'ok.ts'), join(root, 'inner-link.ts'));
    expect(await fs.isRegularFileInside(root, 'ok.ts')).toBe(true);
    expect(await fs.isRegularFileInside(root, '..notes.md')).toBe(true);
    expect(await fs.isRegularFileInside(root, 'inner-link.ts')).toBe(true);
    expect(await fs.isRegularFileInside(root, 'link.txt')).toBe(false);
    expect(await fs.isRegularFileInside(root, 'dir')).toBe(false);
    expect(await fs.isRegularFileInside(root, 'missing')).toBe(false);
    expect(await fs.isRegularFileInside(root, '../etc/passwd')).toBe(false);
  });
});
