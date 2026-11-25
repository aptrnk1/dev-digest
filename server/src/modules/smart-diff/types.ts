import type { Severity, SmartDiffResponse } from '@devdigest/shared';

/** What `container.smartDiff` exposes to the route. */
export interface SmartDiffFacade {
  get(workspaceId: string, prId: string): Promise<SmartDiffResponse>;
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
  dismissed_at: string | null;
}

export interface ReviewFindingsRead {
  id: string;
  agent_id: string | null;
  created_at: string;
  findings: FindingRef[];
}
