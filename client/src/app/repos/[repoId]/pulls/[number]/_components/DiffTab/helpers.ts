/** Pure helpers for DiffTab: join the smart-diff groups with the loaded PR files
    and the review findings the page already holds. */
import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse, SmartDiffRole } from "@devdigest/shared";

export type FindingIndex = Map<string, FindingRecord>;

export interface ResolvedFile {
  file: PrFile;
  findings: FindingRecord[];
  maxSeverity: FindingRecord["severity"] | null;
}

export interface ResolvedGroup {
  role: SmartDiffRole;
  files_with_findings: number;
  files: ResolvedFile[];
}

/** Every finding of every loaded review, by id. */
export function indexFindings(reviews: ReviewRecord[] | undefined | null): FindingIndex {
  const out: FindingIndex = new Map();
  for (const r of reviews ?? []) for (const f of r.findings) out.set(f.id, f);
  return out;
}

/** Smart-diff groups -> renderable files (patch from `prFiles`, findings from
    `index`). PR files the smart-diff doesn't know about are appended to Core
    without an overlay, so nothing silently disappears. */
export function resolveGroups(
  smartDiff: SmartDiffResponse,
  prFiles: PrFile[],
  index: FindingIndex,
): ResolvedGroup[] {
  const byPath = new Map(prFiles.map((f) => [f.path, f] as const));
  const seen = new Set<string>();

  const groups: ResolvedGroup[] = smartDiff.groups.map((g) => ({
    role: g.role,
    files_with_findings: g.files_with_findings,
    files: g.files.map((sf) => {
      seen.add(sf.path);
      const file: PrFile = byPath.get(sf.path) ?? {
        path: sf.path,
        additions: sf.additions,
        deletions: sf.deletions,
        patch: null,
      };
      const findings = sf.finding_ids.flatMap((id) => {
        const f = index.get(id);
        return f ? [f] : [];
      });
      return { file, findings, maxSeverity: findings.length > 0 ? sf.max_severity : null };
    }),
  }));

  const missing = prFiles.filter((f) => !seen.has(f.path));
  if (missing.length > 0) {
    const extra: ResolvedFile[] = missing.map((file) => ({ file, findings: [], maxSeverity: null }));
    const core = groups.find((g) => g.role === "core");
    if (core) core.files.push(...extra);
    else groups.unshift({ role: "core", files_with_findings: 0, files: extra });
  }
  return groups;
}

/** The changed file a `?file=` deep link points at (exact path match), else null. */
export function matchTarget(files: PrFile[], file: string | null): string | null {
  if (!file) return null;
  return files.some((f) => f.path === file) ? file : null;
}
