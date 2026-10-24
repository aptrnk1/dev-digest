import type {
  BlastRadiusResponse,
  LLMProvider,
  PrBrief,
  PrIntentState,
  RepoRef,
  Severity,
  SmartDiffRole,
} from '@devdigest/shared';
import type { RunProjectContext } from '../context/types.js';

/** A PR plus what the brief reads of its files — a read model, NOT a Drizzle row. */
export interface BriefPull {
  id: string;
  title: string;
  body: string | null;
  headSha: string;
  base: string;
  repoId: string;
  repo: RepoRef;
  clonePath: string | null;
  files: { path: string; additions: number; deletions: number; patch: string | null }[];
}

export interface BriefStore {
  /** undefined = PR not found in the workspace. */
  loadPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;
  /** Raw stored `pr_brief.json` (validated by `parseStoredBrief`); undefined = none. */
  getBriefJson(prId: string): Promise<unknown | undefined>;
  upsertBrief(prId: string, brief: PrBrief): Promise<void>;
}

/** Read-only stored intent (`container.intent.get`) — never derives. */
export interface IntentSource {
  get(workspaceId: string, prId: string): Promise<PrIntentState>;
}

export interface BlastSource {
  get(workspaceId: string, prId: string): Promise<BlastRadiusResponse>;
}

/** Declared structurally (mirrors `SmartDiffFacts` of smart-diff/types.ts, plan Cross-task decisions). */
export interface SmartDiffFacts {
  /** Smart Diff display order. */
  files: { path: string; role: SmartDiffRole }[];
  /** `selectFindings` — newest review per agent, no dismissed, PR files only. */
  findings: { file: string; start_line: number; severity: Severity; title: string }[];
  /** At least one review of the PR exists. */
  reviewed: boolean;
}

export interface DiffFactsSource {
  facts(workspaceId: string, prId: string): Promise<SmartDiffFacts>;
}

export interface RepoContextInput {
  workspaceId: string;
  repoId: string;
  repo: RepoRef;
  clonePath: string | null;
  base: string;
}

export interface SpecSource {
  resolveForRepo(input: RepoContextInput, log: { info(msg: string): void }): Promise<RunProjectContext>;
}

/** The workspace's provider + model for `risk_brief`. Throws `BriefDomainError('llm_not_configured')`. */
export type ModelResolver = (workspaceId: string) => Promise<{ model: string; provider: LLMProvider }>;

export interface TokenCounter {
  count(text: string): number;
}

export type Clock = () => Date;
