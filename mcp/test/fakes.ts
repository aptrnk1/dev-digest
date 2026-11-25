import type {
  Agent,
  BlastRadiusResponse,
  ConventionCandidate,
  ConventionsList,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';
import type { Clock, DevDigestApi, RunRef, RunStore, Sleeper } from '../src/app/ports.js';

export const agentFixture = (o: Partial<Agent> = {}): Agent => ({
  id: 'agent-1',
  name: 'Security',
  description: '',
  provider: 'openai',
  model: 'gpt-4o',
  system_prompt: '',
  enabled: true,
  version: 1,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: true,
  ...o,
});

export const repoFixture = (o: Partial<Repo> = {}): Repo => ({
  id: 'repo-1',
  workspace_id: 'ws-1',
  owner: 'acme',
  name: 'web',
  full_name: 'acme/web',
  default_branch: 'main',
  clone_path: null,
  last_polled_at: null,
  created_by: null,
  ...o,
});

export const prFixture = (o: Partial<PrMeta> = {}): PrMeta => ({
  id: 'pr-1',
  number: 1,
  title: 'A PR',
  author: 'dev',
  branch: 'feat',
  base: 'main',
  head_sha: 'abc',
  additions: 1,
  deletions: 0,
  files_count: 1,
  status: 'open',
  ...o,
});

export const findingFixture = (o: Partial<FindingRecord> = {}): FindingRecord => ({
  id: 'f1',
  severity: 'WARNING',
  category: 'bug',
  title: 'A finding',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 12,
  rationale: 'because',
  suggestion: null,
  confidence: 0.9,
  review_id: 'rev-1',
  accepted_at: null,
  dismissed_at: null,
  ...o,
});

export const reviewFixture = (o: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: 'rev-1',
  pr_id: 'pr-1',
  agent_id: 'agent-1',
  run_id: 'run-1',
  agent_name: 'Security',
  kind: 'review',
  verdict: null,
  summary: 'summary',
  score: 80,
  model: 'gpt-4o',
  created_at: '2026-01-01T00:00:00Z',
  findings: [],
  ...o,
});

export const runFixture = (o: Partial<RunSummary> = {}): RunSummary => ({
  run_id: 'run-1',
  agent_id: 'agent-1',
  agent_name: 'Security',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'done',
  error: null,
  duration_ms: 1000,
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
  findings_count: null,
  grounding: null,
  ran_at: null,
  score: null,
  blockers: null,
  ...o,
});

export const conventionFixture = (o: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: 'conv-1',
  category: 'naming',
  rule: 'Use camelCase for variable names',
  evidence_path: 'src/index.ts',
  evidence_line: 10,
  evidence_snippet: 'const MyVar = 1;',
  confidence: 0.95,
  status: 'accepted',
  ...o,
});

const emptyConventions: ConventionsList = { scan: null, items: [] };

export const blastFixture = (o: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse => ({
  pr_id: 'pr-1',
  index_sha: 'abc',
  changed_symbols: [],
  downstream: [],
  summary: '',
  stats: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  degraded: false,
  degraded_reason: null,
  ...o,
});

/** In-memory DevDigestApi; every method is overridable. */
export function fakeApi(overrides: Partial<DevDigestApi> = {}): DevDigestApi {
  return {
    listAgents: async () => [],
    listRepos: async () => [],
    listPulls: async () => [],
    startReview: async (prId, agentId) => ({
      pr_id: prId,
      runs: [{ run_id: 'run-1', agent_id: agentId, agent_name: 'Security' }],
      reviews: [],
    }),
    listRuns: async () => [],
    listReviews: async () => [],
    listConventions: async () => emptyConventions,
    getBlastRadius: async () => blastFixture(),
    ...overrides,
  };
}

export function memoryRunStore(): RunStore {
  const map = new Map<string, RunRef>();
  return {
    remember: (id, ref) => void map.set(id, ref),
    lookup: (id) => map.get(id),
  };
}

/** Sleeper that records requested delays and resolves immediately. */
export const instantSleep: Sleeper & { calls: number[] } = Object.assign(
  async (ms: number) => {
    instantSleep.calls.push(ms);
  },
  { calls: [] as number[] },
);

/** Clock that advances only when `advance` is called (pair with a sleeper that calls it). */
export function fakeClock(start = 0): Clock & { advance(ms: number): void } {
  let t = start;
  return Object.assign(() => t, { advance: (ms: number) => void (t += ms) });
}
