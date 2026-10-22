import type { Severity } from '@devdigest/shared';
import { RunFailed, RunNotStarted } from '../../domain/errors.js';
import { fitBudget, toRunView, type Detail, type RunView } from '../../domain/findings.js';
import type { Clock, DevDigestApi, RunCtx, RunStore, Sleeper } from '../ports.js';
import type { Resolver } from '../resolve.js';

export interface PendingRunView {
  status: 'running';
  run_id: string;
  hint: string;
}

export interface RunReviewInput {
  repo: string;
  pr: number;
  agent: string;
  timeoutS: number;
  severityMin?: Severity;
  detail: Detail;
}

export interface RunReviewDeps {
  api: Pick<DevDigestApi, 'startReview' | 'listRuns' | 'listReviews'>;
  resolver: Resolver;
  runs: RunStore;
  sleep: Sleeper;
  now: Clock;
}

const MAX_BACKOFF_S = 5;

export function makeRunReview(
  deps: RunReviewDeps,
): (i: RunReviewInput, ctx: RunCtx) => Promise<RunView | PendingRunView> {
  const { api, resolver, runs, sleep, now } = deps;
  return async (i, ctx) => {
    const repo = await resolver.repo(i.repo);
    const pull = await resolver.pull(repo, i.pr);
    const agent = await resolver.agent(i.agent, { enabledOnly: true });

    const started = await api.startReview(pull.id, agent.id);
    const runId = started.runs[0]?.run_id;
    if (!runId) throw new RunNotStarted(pull.number, repo.full_name);
    runs.remember(runId, { prId: pull.id, repo: repo.full_name, pr: pull.number, agent: agent.name });

    const pending = (): PendingRunView => ({
      status: 'running',
      run_id: runId,
      hint: `call get_findings(run_id="${runId}", repo="${repo.full_name}", pr=${pull.number}) later`,
    });

    const startedAt = now();
    const deadline = startedAt + i.timeoutS * 1000;
    for (let attempt = 0; ; attempt++) {
      if (ctx.signal.aborted) return pending();
      const run = (await api.listRuns(pull.id)).find((r) => r.run_id === runId);
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        throw new RunFailed(run.status, run.error);
      }
      if (run?.status === 'done') {
        const review = (await api.listReviews(pull.id)).find((r) => r.run_id === runId);
        const base = { run_id: runId, agent: agent.name, status: 'done' };
        return fitBudget(
          toRunView(review ? { ...base, review } : base, {
            detail: i.detail,
            ...(i.severityMin ? { severityMin: i.severityMin } : {}),
          }),
        );
      }
      await ctx.progress?.(Math.round((now() - startedAt) / 1000), i.timeoutS);
      if (now() >= deadline) return pending();
      await sleep(Math.min(attempt + 1, MAX_BACKOFF_S) * 1000, ctx.signal);
    }
  };
}
