import type {
  Agent,
  ConventionsList,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';

/** Outbound port: the DevDigest HTTP API (workspace is implicit). */
export interface DevDigestApi {
  listAgents(): Promise<Agent[]>;
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  startReview(prId: string, agentId: string): Promise<ReviewRunResponse>;
  listRuns(prId: string): Promise<RunSummary[]>;
  listReviews(prId: string): Promise<ReviewRecord[]>;
  listConventions(repoId: string): Promise<ConventionsList>;
}

export type RunRef = { prId: string; repo: string; pr: number; agent: string };

/** Remembers runs started by this MCP process (no API maps run_id -> PR). */
export interface RunStore {
  remember(runId: string, ref: RunRef): void;
  lookup(runId: string): RunRef | undefined;
}

export type Sleeper = (ms: number, signal?: AbortSignal) => Promise<void>;
export type Clock = () => number;
export type ProgressSink = (progress: number, total?: number) => Promise<void>;
export type RunCtx = { signal: AbortSignal; progress?: ProgressSink };
