import type { BlastRadiusResponse } from '@devdigest/shared';
import { MAX_RESPONSE_CHARS } from '../../domain/findings.js';
import type { DevDigestApi } from '../ports.js';
import type { Resolver } from '../resolve.js';

export type BlastRadiusView = { repo: string; pr: number } & BlastRadiusResponse & {
    truncated_callers?: number;
    hint?: string;
  };

export interface GetBlastRadiusDeps {
  api: Pick<DevDigestApi, 'getBlastRadius'>;
  resolver: Resolver;
}

const FLAG_OFF_HINT = 'repo intelligence is disabled on the server (REPO_INTEL_ENABLED=false)';
const TOO_LARGE_HINT = 'response too large; open the PR Overview in the UI';

export function makeGetBlastRadius(
  deps: GetBlastRadiusDeps,
): (i: { repo: string; pr: number }) => Promise<BlastRadiusView> {
  return async (input) => {
    const repo = await deps.resolver.repo(input.repo);
    const pull = await deps.resolver.pull(repo, input.pr);
    const body = await deps.api.getBlastRadius(pull.id);

    const view: BlastRadiusView = { repo: repo.full_name, pr: input.pr, ...body };
    if (body.degraded) {
      view.hint =
        body.degraded_reason === 'flag_off'
          ? FLAG_OFF_HINT
          : `index is ${body.degraded_reason ?? 'unavailable'}; rebuild it in the UI (PR Overview → Rebuild index)`;
    }

    // Pop callers from the tail until the payload fits; empty groups are dropped.
    let dropped = 0;
    const downstream = view.downstream.map((d) => ({ ...d, callers: [...d.callers] }));
    view.downstream = downstream;
    while (downstream.length > 0 && JSON.stringify(view).length > MAX_RESPONSE_CHARS) {
      const last = downstream[downstream.length - 1]!;
      last.callers.pop();
      dropped += 1;
      if (last.callers.length === 0) downstream.pop();
      view.truncated_callers = dropped;
      view.hint = TOO_LARGE_HINT;
    }
    return view;
  };
}
