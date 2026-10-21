import type { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff, normalizePath, selectFindings, SmartDiffDomainError } from './domain.js';
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
    return buildSmartDiff(pull.files, findings, ranks);
  }
}
