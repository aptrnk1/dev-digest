import type { ReviewRecord, RunSummary, Severity } from '@devdigest/shared';
import { BadArgs, RunUnknown } from '../../domain/errors.js';
import { fitBudget, MAX_FINDINGS, toRunView, type Detail, type RunView } from '../../domain/findings.js';
import type { DevDigestApi, RunStore } from '../ports.js';
import type { Resolver } from '../resolve.js';

export interface PrFindingsView {
  repo: string;
  pr: number;
  runs: RunView[];
}

export interface GetFindingsInput {
  runId?: string;
  repo?: string;
  pr?: number;
  agent?: string;
  severityMin?: Severity;
  detail: Detail;
}

export interface GetFindingsDeps {
  api: Pick<DevDigestApi, 'listRuns' | 'listReviews'>;
  resolver: Resolver;
  runs: RunStore;
}

const USAGE = 'pass run_id, or repo and pr (optionally agent)';

/** Missing timestamps mean "in flight", i.e. newest. */
const stamp = (iso: string | null | undefined): number => {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

export function makeGetFindings(deps: GetFindingsDeps): (i: GetFindingsInput) => Promise<RunView | PrFindingsView> {
  const { api, resolver, runs: store } = deps;

  async function byRun(i: GetFindingsInput, runId: string): Promise<RunView> {
    let prId: string | undefined = store.lookup(runId)?.prId;
    if (!prId) {
      if (!i.repo || i.pr === undefined) throw new RunUnknown();
      const repo = await resolver.repo(i.repo);
      prId = (await resolver.pull(repo, i.pr)).id;
    }
    const [runList, reviews] = await Promise.all([api.listRuns(prId), api.listReviews(prId)]);
    const run = runList.find((r) => r.run_id === runId);
    const review = reviews.find((r) => r.run_id === runId);
    if (!run && !review) throw new RunUnknown();
    return fitBudget(
      toRunView(
        {
          run_id: runId,
          agent: run?.agent_name ?? review?.agent_name ?? '',
          status: run?.status ?? 'done',
          error: run?.error ?? null,
          ...(review ? { review } : {}),
        },
        { ...(i.severityMin ? { severityMin: i.severityMin } : {}), detail: i.detail },
      ),
    );
  }

  async function byPr(i: GetFindingsInput, repoName: string, prNumber: number): Promise<PrFindingsView> {
    const repo = await resolver.repo(repoName);
    const pull = await resolver.pull(repo, prNumber);
    const agentId = i.agent ? (await resolver.agent(i.agent, { enabledOnly: false })).id : undefined;
    const [runList, reviewList] = await Promise.all([api.listRuns(pull.id), api.listReviews(pull.id)]);

    const newestReview = new Map<string, ReviewRecord>();
    for (const r of reviewList) {
      if (r.kind !== 'review' || (agentId && (r.agent_id ?? '') !== agentId)) continue;
      const cur = newestReview.get(r.agent_id ?? '');
      if (!cur || stamp(r.created_at) > stamp(cur.created_at)) newestReview.set(r.agent_id ?? '', r);
    }
    const pendingRun = new Map<string, RunSummary>();
    for (const r of runList) {
      if (r.status === 'done' || (agentId && (r.agent_id ?? '') !== agentId)) continue;
      const cur = pendingRun.get(r.agent_id ?? '');
      if (!cur || stamp(r.ran_at) > stamp(cur.ran_at)) pendingRun.set(r.agent_id ?? '', r);
    }

    const entries: Array<{ at: number; run?: RunSummary; review?: ReviewRecord }> = [];
    for (const id of new Set([...newestReview.keys(), ...pendingRun.keys()])) {
      const review = newestReview.get(id);
      const run = pendingRun.get(id);
      if (run && (!review || stamp(run.ran_at) > stamp(review.created_at))) entries.push({ at: stamp(run.ran_at), run });
      else if (review) entries.push({ at: stamp(review.created_at), review });
    }
    entries.sort((a, b) => b.at - a.at);

    let remaining = MAX_FINDINGS;
    const views: RunView[] = entries.map((e) => {
      const view = toRunView(
        e.run
          ? { run_id: e.run.run_id, agent: e.run.agent_name ?? '', status: e.run.status ?? 'running', error: e.run.error }
          : { run_id: e.review!.run_id, agent: e.review!.agent_name ?? '', status: 'done', review: e.review! },
        { ...(i.severityMin ? { severityMin: i.severityMin } : {}), detail: i.detail, limit: remaining },
      );
      remaining -= view.findings.length;
      return view;
    });
    return fitBudget({ repo: repo.full_name, pr: prNumber, runs: views });
  }

  return async (i) => {
    if (i.runId) return byRun(i, i.runId);
    if (i.repo && i.pr !== undefined) return byPr(i, i.repo, i.pr);
    throw new BadArgs(i.repo || i.pr !== undefined ? `repo and pr go together; ${USAGE}` : USAGE);
  };
}
