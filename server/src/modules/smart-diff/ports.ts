import type { ChangedFile, FindingRef, ReviewFindingsRead } from './types.js';

export type { ChangedFile, FindingRef, ReviewFindingsRead };

/** Stored PR files — a read model, not a Drizzle row. */
export interface PullFilesRead {
  prId: string;
  repoId: string;
  files: ChangedFile[];
}

export interface SmartDiffStore {
  /** undefined = PR not found in the workspace. */
  loadPullFiles(workspaceId: string, prId: string): Promise<PullFilesRead | undefined>;
}

/** Satisfied structurally by `ReviewsFacade`. */
export interface ReviewSource {
  listForPull(workspaceId: string, prId: string): Promise<ReviewFindingsRead[]>;
}

/** Satisfied structurally by `RepoIntel`. */
export interface FileRankSource {
  getFileRank(repoId: string, paths: string[]): Promise<{ path: string; percentile: number }[]>;
}
