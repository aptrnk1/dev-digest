import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { RepoFiles } from './ports.js';

/** True when `target` is `root` or lies below it (both already realpath-resolved). */
function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith('..' + sep);
}

/**
 * Outbound adapter: the cloned repo's working tree. Symlinked directories are
 * never entered; a symlinked file is only visible when it resolves to a regular
 * file inside the clone.
 */
export class FsRepoFiles implements RepoFiles {
  async isClone(root: string): Promise<boolean> {
    try {
      if (!(await stat(root)).isDirectory()) return false;
      await stat(join(root, '.git')); // dir, or a file for worktrees/submodules
      return true;
    } catch {
      return false;
    }
  }

  async listTree(
    root: string,
    opts: { limit: number; excludeDirs: readonly string[] },
  ): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(join(root, rel), { withFileTypes: true });
      } catch (err) {
        if (rel === '') throw err;
        return; // unreadable or vanished subdirectory
      }
      for (const e of entries) {
        const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) {
          if (!opts.excludeDirs.includes(e.name)) await walk(childRel);
        } else if (e.isFile()) {
          out.push(childRel);
        }
        // symlinks (dirs or files) are skipped
      }
    };
    await walk('');
    out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return out.slice(0, opts.limit);
  }

  async listRootFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  }

  async readCapped(
    root: string,
    path: string,
    opts: { maxLines: number; maxChars: number },
  ): Promise<string | null> {
    const full = await this.resolveInside(root, path);
    if (!full) return null;
    try {
      const text = await readFile(full, 'utf8');
      return text.split('\n').slice(0, opts.maxLines).join('\n').slice(0, opts.maxChars);
    } catch {
      return null;
    }
  }

  async isRegularFileInside(root: string, path: string): Promise<boolean> {
    return (await this.resolveInside(root, path)) !== null;
  }

  /** Real path of a regular file that stays inside the clone, else null. */
  private async resolveInside(root: string, path: string): Promise<string | null> {
    try {
      const realRoot = await realpath(root);
      const real = await realpath(join(realRoot, path));
      if (!within(realRoot, real)) return null;
      if (!(await stat(real)).isFile()) return null;
      return real;
    } catch {
      return null;
    }
  }
}
