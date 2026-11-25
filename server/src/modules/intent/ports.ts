import type {
  Intent,
  IntentBasis,
  IntentConfidence,
  IntentSource,
  IssueMeta,
  LLMProvider,
  RepoRef,
  UnresolvedRef,
} from '@devdigest/shared';
import type { IntentLog } from './types.js';

export type { IntentLog };

/** A PR plus the cheap signals the classifier uses — a read model, NOT a Drizzle row. */
export interface PullInputs {
  id: string;
  number: number;
  title: string;
  body: string | null;
  branch: string;
  headSha: string;
  repo: RepoRef;
  /** ≤ MAX_COMMITS first-line commit messages. */
  commits: string[];
  /** ≤ MAX_PATHS changed files (no patch). */
  files: { path: string; additions: number; deletions: number }[];
}

/** Storage-neutral read model of a stored intent — NOT the wire contract (see `toPrIntentRecordDto`). */
export interface IntentRecord {
  prId: string;
  intent: string;
  inScope: string[];
  outOfScope: string[];
  riskAreas: Intent['risk_areas'];
  confidence: IntentConfidence;
  basis: IntentBasis;
  sources: IntentSource[];
  unresolvedRefs: UnresolvedRef[];
  /** null for legacy rows written before head tracking. */
  headSha: string | null;
  model: string | null;
  costUsd: number | null;
  updatedAt: Date;
}

export interface StoredIntent {
  record: IntentRecord;
  inputHash: string | null;
}

export interface NewIntent extends Intent {
  head_sha: string;
  input_hash: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
}

export interface IntentStore {
  /** undefined = PR not found in the workspace. */
  loadPull(workspaceId: string, prId: string): Promise<PullInputs | undefined>;
  getIntent(prId: string): Promise<StoredIntent | undefined>;
  upsertIntent(prId: string, row: NewIntent): Promise<IntentRecord>;
}

/** GitHub issue lookup — wired to `GitHubClient.getIssue` in compose. */
export interface IssueSource {
  getIssue(repo: RepoRef, n: number): Promise<IssueMeta>;
}

/** File at a commit from the local clone — `GitClient.showFile` satisfies it. */
export interface FileSource {
  showFile(repo: RepoRef, ref: string, path: string): Promise<string | null>;
}

/** The workspace's provider + model for `review_intent`. Throws `IntentDomainError('llm_not_configured')` without a key. */
export type ModelResolver = (workspaceId: string) => Promise<{ llm: LLMProvider; model: string }>;

/** Structured (pino-style) logger — never receives source text. */
export interface Logger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}
