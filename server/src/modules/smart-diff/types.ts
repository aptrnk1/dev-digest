import type { Severity, SmartDiffResponse, SmartDiffRole } from '@devdigest/shared';

/** What `container.smartDiff` exposes to the route. */
export interface SmartDiffFacade {
  get(workspaceId: string, prId: string): Promise<SmartDiffResponse>;
  /** Roles in display order + finding anchors, for the PR brief. */
  facts(workspaceId: string, prId: string): Promise<SmartDiffFacts>;
}

export interface SmartDiffFacts {
  /** Display order of Smart Diff. */
  files: { path: string; role: SmartDiffRole }[];
  /** Newest review per agent, undismissed, PR files only. */
  findings: { file: string; start_line: number; severity: Severity; title: string }[];
  /** At least one review exists for the PR. */
  reviewed: boolean;
}

// Data shapes shared by the pure domain and the ports (domain may not import ports).
export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface FindingRef {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
  title: string;
  dismissed_at: string | null;
}

export interface ReviewFindingsRead {
  id: string;
  agent_id: string | null;
  created_at: string;
  findings: FindingRef[];
}
