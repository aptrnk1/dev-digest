import type { ContextDocUsage, GitClient } from '@devdigest/shared';
import type { ContextOwnerRef, RunAttachments } from './types.js';

export interface ScannedDoc {
  path: string;
  size: number;
  mtime: string | null;
}

export type DocRead =
  | { kind: 'ok'; content: string; size: number }
  | { kind: 'too_large'; size: number }
  | { kind: 'missing' }
  /** realpath (or a `..` segment) leads outside the clone. */
  | { kind: 'outside' };

/** Outbound port: the cloned repo's file system. */
export interface DocSource {
  isClone(root: string): Promise<boolean>;
  /** Sorted by path. */
  list(root: string): Promise<ScannedDoc[]>;
  read(root: string, path: string): Promise<DocRead>;
}

/** Outbound port: persisted attachments. */
export interface AttachmentStore {
  findRepo(ws: string, repoId: string): Promise<{ id: string; clonePath: string | null } | null>;
  ownerExists(ws: string, owner: ContextOwnerRef): Promise<boolean>;
  listOwn(owner: ContextOwnerRef, repoId: string): Promise<string[]>;
  replace(ws: string, owner: ContextOwnerRef, repoId: string, paths: string[]): Promise<void>;
  usage(ws: string, repoId: string, path: string): Promise<ContextDocUsage>;
  loadForRun(agentId: string, repoId: string): Promise<RunAttachments>;
}

/** Outbound port: enabled agents of a workspace (repo-wide context resolution). */
export interface EnabledAgentStore {
  /** Oldest first (`agents.created_at`). */
  listEnabledAgentIds(workspaceId: string): Promise<string[]>;
}

export type BaseRefReader = Pick<GitClient, 'hasRef' | 'showFile'>;

export interface TokenCounter {
  count(text: string): number;
}
