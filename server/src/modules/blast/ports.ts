import type { RepoIntel } from '../repo-intel/types.js';

/** Stored PR paths — a read model, not a Drizzle row. */
export interface PullPathsRead {
  prId: string;
  repoId: string;
  paths: string[];
}

export interface BlastStore {
  /** undefined = PR not found in the workspace. */
  loadPull(workspaceId: string, prId: string): Promise<PullPathsRead | undefined>;
}

/** Satisfied structurally by `RepoIntel`. */
export type BlastSource = Pick<RepoIntel, 'getBlastRadius' | 'getIndexState'>;
