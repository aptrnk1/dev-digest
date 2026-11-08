import type { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff, normalizePath, selectFindings, SmartDiffDomainError } from './domain.js';
import type { SmartDiffFacts } from './types.js';
import type { FileRankSource, ReviewSource, SmartDiffStore } from './ports.js';

export interface SmartDiffDeps {
  store: SmartDiffStore;
  reviews: ReviewSource;
  ranks: FileRankSource;
}

/** Read-only: groups stored PR files by role and overlays the review findings. */
export class SmartDiffService {
  constructor(private readonly deps: SmartDiffDeps) {}

  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    return (await this.load(workspaceId, prId)).diff;
  }

  /** Roles in display order + finding anchors under the Smart Diff selection rule. */
  async facts(workspaceId: string, prId: string): Promise<SmartDiffFacts> {
    const { diff, findings, reviewed } = await this.load(workspaceId, prId);
    return {
      files: diff.groups.flatMap((g) => g.files.map((f) => ({ path: f.path, role: g.role }))),
      findings: findings.map((f) => ({ file: f.file, start_line: f.start_line, severity: f.severity, title: f.title })),
      reviewed,
    };
  }

  private async load(workspaceId: string, prId: string) {
    const pull = await this.deps.store.loadPullFiles(workspaceId, prId);
    if (!pull) throw new SmartDiffDomainError('pr_not_found', 'Pull request not found');

    const paths = pull.files.map((f) => f.path);
    const [reviews, rankRows] = await Promise.all([
      this.deps.reviews.listForPull(workspaceId, prId),
      // repo-intel off / failing is not an error: fall back to secondary sort keys
      this.deps.ranks.getFileRank(pull.repoId, paths).catch(() => []),
    ]);

    const findings = selectFindings(reviews, new Set(paths.map(normalizePath)));
    const ranks = new Map(rankRows.map((r) => [normalizePath(r.path), r.percentile] as const));
    return { diff: buildSmartDiff(pull.files, findings, ranks), findings, reviewed: reviews.length > 0 };
  }
}
