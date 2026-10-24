import type {
  ContextAttachments,
  ContextDocUsage,
  RepoRef,
  SpecFile,
  SpecFileList,
} from '@devdigest/shared';
import type { ProjectSpec } from '@devdigest/reviewer-core';

export interface ContextOwnerRef {
  kind: 'agent' | 'skill';
  id: string;
}

export interface ContextFacade {
  list(ws: string, repoId: string): Promise<SpecFileList>;
  file(ws: string, repoId: string, path: string): Promise<SpecFile>;
  usage(ws: string, repoId: string, path: string): Promise<ContextDocUsage>;
  getAttachments(ws: string, owner: ContextOwnerRef, repoId: string): Promise<ContextAttachments>;
  setAttachments(
    ws: string,
    owner: ContextOwnerRef,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachments>;
}

export interface RunContextInput {
  repoId: string;
  agentId: string;
  repo: RepoRef;
  clonePath: string | null;
  base: string;
}

/** Repo-wide resolution (no single agent): specs of every enabled agent. */
export interface RepoContextInput {
  workspaceId: string;
  repoId: string;
  repo: RepoRef;
  clonePath: string | null;
  base: string;
}

export interface ContextLog {
  info(msg: string): void;
}

export interface RunProjectContext {
  specs: ProjectSpec[];
  specsRead: string[];
}

export interface RunContextFacade {
  resolveForRun(input: RunContextInput, log: ContextLog): Promise<RunProjectContext>;
  resolveForRepo(input: RepoContextInput, log: ContextLog): Promise<RunProjectContext>;
}

/** Enabled skills (enabled link) attached to the agent, in `agent_skills.order`. */
export interface RunAttachments {
  own: string[];
  skills: { skillId: string; skillName: string; paths: string[] }[];
}

export interface MergedDoc {
  path: string;
  via: { skillId: string; skillName: string } | null;
}
