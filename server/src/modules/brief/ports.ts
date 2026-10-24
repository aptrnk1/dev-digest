import type {
  BlastRadiusResponse,
  LLMProvider,
  PrBrief,
  RepoRef,
} from '@devdigest/shared';
import type { RunContextFacade } from '../context/types.js';
import type { IntentFacade } from '../intent/types.js';
import type { SmartDiffFacade } from '../smart-diff/types.js';

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
export type IntentSource = Pick<IntentFacade, 'get'>;

export interface BlastSource {
  get(workspaceId: string, prId: string): Promise<BlastRadiusResponse>;
}

export type DiffFactsSource = Pick<SmartDiffFacade, 'facts'>;

export type SpecSource = Pick<RunContextFacade, 'resolveForRepo'>;

/** The workspace's provider + model for `risk_brief`. Throws `BriefDomainError('llm_not_configured')`. */
export type ModelResolver = (workspaceId: string) => Promise<{ model: string; provider: LLMProvider }>;

export interface TokenCounter {
  count(text: string): number;
}

export type Clock = () => Date;
