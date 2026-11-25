import type { LLMProvider, OnboardingTour, RepoRef } from '@devdigest/shared';
import type { RepoIntel } from '../repo-intel/types.js';

export interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

/** Read model of the `onboarding` row — NOT a Drizzle row. */
export interface JobRecord {
  runId: string;
  status: 'running' | 'done' | 'failed';
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface OnboardingState {
  job: JobRecord;
  /** null when no tour is stored or the stored json no longer parses. */
  tour: OnboardingTour | null;
}

export interface OnboardingStore {
  getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined>;
  getState(repoId: string): Promise<OnboardingState | undefined>;
  /** Atomic upsert; null = a live run already exists (`onboarding_in_progress`). */
  tryStart(repoId: string, runId: string, now: Date, staleMs: number): Promise<JobRecord | null>;
  /** Compare-and-set on run_id + still running + not stale; false = result discarded. */
  complete(
    repoId: string,
    runId: string,
    tour: OnboardingTour,
    finishedAt: Date,
    staleMs: number,
  ): Promise<boolean>;
  fail(
    repoId: string,
    runId: string,
    error: string,
    finishedAt: Date,
    staleMs: number,
  ): Promise<boolean>;
}

/** Working-tree reads from the clone (outbound adapter: filesystem). */
export interface RepoFiles {
  /** clone_path exists and holds a `.git` entry. */
  isClone(root: string): Promise<boolean>;
  /** Sorted ascending, capped at `limit`, `excludeDirs` skipped, symlink dirs not entered. */
  listTree(root: string, opts: { limit: number; excludeDirs: readonly string[] }): Promise<string[]>;
  listRootFiles(root: string): Promise<string[]>;
  /** null when missing / not a regular file / outside the clone. */
  readCapped(
    root: string,
    path: string,
    opts: { maxLines: number; maxChars: number },
  ): Promise<string | null>;
  isRegularFileInside(root: string, path: string): Promise<boolean>;
}

export type IndexSource = Pick<RepoIntel, 'getIndexState' | 'getTopFilesByRank' | 'getCriticalPaths'>;

export interface HeadReader {
  currentHead(repo: RepoRef): Promise<string>;
}

export interface TokenCounter {
  count(text: string): number;
}

/** Provider is built per HTTP request with the remaining time budget. */
export interface ModelHandle {
  model: string;
  provider(timeoutMs: number): Promise<LLMProvider>;
}

export type ResolveModel = (workspaceId: string) => Promise<ModelHandle>;

export interface OnboardingLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}
