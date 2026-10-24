import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { MAX_DOC_BYTES } from './constants.js';
import { hasDocExtension, isExcludedDir } from './paths.js';
import type { DocRead, DocSource, ScannedDoc } from './ports.js';

/** True when `target` is `root` or lies below it (both already realpath-resolved). */
function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Outbound adapter: the cloned repo's working tree. Symlinked directories are
 * never entered; a symlinked file is only visible when it resolves inside the
 * clone (AC75, AC9).
 */
export class FsDocSource implements DocSource {
  async isClone(root: string): Promise<boolean> {
    try {
      if (!(await stat(root)).isDirectory()) return false;
      await stat(join(root, '.git')); // dir, or a file for worktrees/submodules
      return true;
    } catch {
      return false;
    }
  }

  async list(root: string): Promise<ScannedDoc[]> {
    const realRoot = await realpath(root);
    const out: ScannedDoc[] = [];

    const walk = async (rel: string): Promise<void> => {
      const entries = await readdir(join(root, rel), { withFileTypes: true });
      for (const e of entries) {
        const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) {
          if (!isExcludedDir(e.name)) await walk(childRel);
          continue;
        }
        if (!hasDocExtension(e.name)) continue;
        if (e.isFile()) {
          await this.push(out, root, childRel);
        } else if (e.isSymbolicLink()) {
          try {
            const real = await realpath(join(root, childRel));
            if (!within(realRoot, real)) continue;
            if (!(await stat(real)).isFile()) continue;
            await this.push(out, root, childRel);
          } catch {
            // dangling link
          }
        }
      }
    };

    await walk('');
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  private async push(out: ScannedDoc[], root: string, path: string): Promise<void> {
    try {
      const s = await stat(join(root, path));
      out.push({ path, size: s.size, mtime: s.mtime.toISOString() });
    } catch {
      // vanished between readdir and stat
    }
  }

  async read(root: string, path: string): Promise<DocRead> {
    try {
      const realRoot = await realpath(root);
      const full = join(realRoot, path);
      if (!within(realRoot, full)) return { kind: 'missing' };

      // No intermediate directory may be a symlink.
      const segments = relative(realRoot, full).split(sep);
      let cur = realRoot;
      for (const seg of segments.slice(0, -1)) {
        cur = join(cur, seg);
        if ((await lstat(cur)).isSymbolicLink()) return { kind: 'missing' };
      }

      const real = await realpath(full);
      if (!within(realRoot, real)) return { kind: 'missing' };
      const s = await stat(real);
      if (!s.isFile()) return { kind: 'missing' };
      if (s.size > MAX_DOC_BYTES) return { kind: 'too_large', size: s.size };
      return { kind: 'ok', content: await readFile(real, 'utf8'), size: s.size };
    } catch {
      return { kind: 'missing' };
    }
  }
}
