import type { Severity, SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';
import {
  BARREL_BASENAME, BARREL_LINE, CONTENT_SCAN_LINES, DOCS_BASENAME, DOCS_EXT, GENERATED_BASENAME,
  GENERATED_DIRS, GENERATED_MARKERS, LOCK_NAMES, ROLE_ORDER, SEVERITY_RANK, TEST_BASENAME, TEST_DIRS,
  TOO_BIG_LINES, WIRING_BASENAME,
} from './constants.js';
import type { ChangedFile, FindingRef, ReviewFindingsRead } from './types.js';

/**
 * Smart Diff rules: role classification, finding selection, grouping and
 * ordering. Pure: no I/O, no framework.
 */

export class SmartDiffDomainError extends Error {
  constructor(
    readonly code: 'pr_not_found',
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** First `CONTENT_SCAN_LINES` added/context lines (hunk headers, `-` and `\` lines skipped). */
function leadingLines(patch: string): string[] {
  const out: string[] = [];
  for (const line of patch.split('\n')) {
    if (out.length >= CONTENT_SCAN_LINES) break;
    if (line.startsWith('@@') || line.startsWith('-') || line.startsWith('\\')) continue;
    out.push(line.slice(1));
  }
  return out;
}

function isBarrel(patch: string): boolean {
  const added = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    .filter((l) => l !== '');
  return added.length > 0 && added.every((l) => BARREL_LINE.test(l));
}

export function classifyFile(file: { path: string; patch: string | null }): SmartDiffRole {
  const path = normalizePath(file.path);
  const segments = path.split('/');
  const base = (segments[segments.length - 1] ?? '').toLowerCase();
  const dirs = segments.slice(0, -1);
  const lower = path.toLowerCase();

  if (LOCK_NAMES.has(base)) return 'boilerplate';
  if (dirs.some((d) => GENERATED_DIRS.has(d)) || GENERATED_BASENAME.some((re) => re.test(base))) {
    return 'boilerplate';
  }
  if (file.patch && leadingLines(file.patch).some((l) => GENERATED_MARKERS.test(l))) return 'boilerplate';

  const inDocs = dirs.includes('docs');
  if (DOCS_EXT.test(base) || inDocs || DOCS_BASENAME.test(base)) return 'docs';
  if (base.endsWith('.txt') && lower.includes('docs/')) return 'docs';

  if (dirs.some((d) => TEST_DIRS.has(d)) || TEST_BASENAME.some((re) => re.test(base))) return 'tests';

  if (WIRING_BASENAME.some((re) => re.test(base))) return 'wiring';
  if (dirs[dirs.length - 1] === 'workflows' && dirs[dirs.length - 2] === '.github') return 'wiring';
  if (BARREL_BASENAME.test(base) && file.patch && isBarrel(file.patch)) return 'wiring';

  return 'core';
}

/** Newest review per agent (null-agent reviews stand alone), undismissed findings on PR files only. */
export function selectFindings(reviews: ReviewFindingsRead[], prPaths: ReadonlySet<string>): FindingRef[] {
  const newest = new Map<string, ReviewFindingsRead>();
  for (const r of reviews) {
    const key = r.agent_id ?? `__null:${r.id}`;
    const cur = newest.get(key);
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) newest.set(key, r);
  }
  const out: FindingRef[] = [];
  for (const r of newest.values()) {
    for (const f of r.findings) {
      if (f.dismissed_at != null) continue;
      const file = normalizePath(f.file);
      if (!prPaths.has(file)) continue;
      out.push({ ...f, file });
    }
  }
  return out;
}

export function sortGroup<T extends { path: string; additions: number; deletions: number; rank_percentile: number | null }>(
  files: T[],
): T[] {
  return [...files].sort((a, b) => {
    if (a.rank_percentile !== b.rank_percentile) {
      if (a.rank_percentile === null) return 1;
      if (b.rank_percentile === null) return -1;
      return b.rank_percentile - a.rank_percentile;
    }
    const size = b.additions + b.deletions - (a.additions + a.deletions);
    if (size !== 0) return size;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

const bySeverityThenLine = (a: FindingRef, b: FindingRef): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  a.end_line - b.end_line ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildSmartDiff(
  files: ChangedFile[],
  findings: FindingRef[],
  ranks: ReadonlyMap<string, number>,
): SmartDiff {
  const byFile = new Map<string, FindingRef[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  const buckets = new Map<SmartDiffRole, SmartDiffFile[]>();
  let totalLines = 0;
  for (const f of files) {
    const path = normalizePath(f.path);
    const own = (byFile.get(path) ?? []).slice().sort(bySeverityThenLine);
    const max: Severity | null = own[0]?.severity ?? null;
    const entry: SmartDiffFile = {
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: own.map((x) => x.end_line),
      finding_ids: own.map((x) => x.id),
      max_severity: max,
      rank_percentile: ranks.get(path) ?? null,
    };
    totalLines += f.additions + f.deletions;
    const role = classifyFile(f);
    const list = buckets.get(role) ?? [];
    list.push(entry);
    buckets.set(role, list);
  }

  const groups = ROLE_ORDER.flatMap((role) => {
    const list = buckets.get(role);
    if (!list || list.length === 0) return [];
    const sorted = sortGroup(list);
    return [{ role, files: sorted, files_with_findings: sorted.filter((x) => x.finding_ids.length > 0).length }];
  });

  return {
    groups,
    split_suggestion: { too_big: totalLines > TOO_BIG_LINES, total_lines: totalLines, proposed_splits: [] },
  };
}
