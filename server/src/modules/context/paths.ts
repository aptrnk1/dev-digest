import { DOC_EXTENSIONS, EXCLUDED_DIRS, INCLUDED_DOT_DIR } from './constants.js';

export type PathCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'empty' | 'invalid_char' | 'absolute' | 'traversal' | 'non_canonical' | 'extension' | 'excluded_dir';
    };

/** True for a directory name the scanner never enters (shared with the FS scanner). */
export function isExcludedDir(name: string): boolean {
  if ((EXCLUDED_DIRS as readonly string[]).includes(name)) return true;
  return name.startsWith('.') && name !== INCLUDED_DOT_DIR;
}

export function hasDocExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return DOC_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** Syntactic rules for a repo-relative doc path from the client (AC9, AC52). */
export function validateDocPath(p: string): PathCheck {
  if (p.length === 0) return { ok: false, reason: 'empty' };
  if (p.includes('\0')) return { ok: false, reason: 'invalid_char' };
  if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) {
    return { ok: false, reason: 'absolute' };
  }
  const segments = p.split(/[\\/]/);
  if (segments.includes('..')) return { ok: false, reason: 'traversal' };
  if (segments.includes('.') || segments.includes('')) return { ok: false, reason: 'non_canonical' };
  if (!hasDocExtension(p)) return { ok: false, reason: 'extension' };
  if (segments.slice(0, -1).some(isExcludedDir)) return { ok: false, reason: 'excluded_dir' };
  return { ok: true };
}

export type DocCategory = 'specs' | 'insights' | 'docs';

export function categoryOf(path: string): DocCategory {
  const segments = path.split('/');
  const name = segments[segments.length - 1] ?? '';
  if (segments.includes('specs') || name.endsWith('.prd.md')) return 'specs';
  if (segments.includes('insights') || name === 'INSIGHTS.md') return 'insights';
  return 'docs';
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}
