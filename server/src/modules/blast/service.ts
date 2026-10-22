import type { BlastRadiusResponse } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';
import { BlastDomainError } from './domain.js';
import { toBlastRadiusResponse, type BlastIndexView } from './helpers.js';
import type { BlastSource, BlastStore } from './ports.js';

export interface BlastDeps {
  store: BlastStore;
  intel: BlastSource;
  repoIntelEnabled: boolean;
}

const EMPTY: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [] };
const FAILED_STATE: BlastIndexView = { status: 'failed', lastIndexedSha: '' };

/** Read-only: maps one repo-intel blast query to the contract. No re-analysis, no LLM. */
export class BlastService {
  constructor(private readonly deps: BlastDeps) {}

  async get(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const pull = await this.deps.store.loadPull(workspaceId, prId);
    if (!pull) throw new BlastDomainError('pr_not_found', 'Pull request not found');

    const { intel, repoIntelEnabled } = this.deps;
    try {
      const [result, state] = await Promise.all([
        pull.paths.length === 0 ? Promise.resolve(EMPTY) : intel.getBlastRadius(pull.repoId, pull.paths),
        intel.getIndexState(pull.repoId),
      ]);
      return toBlastRadiusResponse({ prId: pull.prId, result, state, repoIntelEnabled });
    } catch {
      // repo-intel failing is not an API error: report an empty, degraded map
      return toBlastRadiusResponse({
        prId: pull.prId,
        result: { ...EMPTY, degraded: true, reason: 'no_data' },
        state: FAILED_STATE,
        repoIntelEnabled,
      });
    }
  }
}
