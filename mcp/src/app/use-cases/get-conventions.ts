import type { ConventionCategory } from '@devdigest/shared';
import { MAX_RESPONSE_CHARS } from '../../domain/findings.js';
import type { DevDigestApi } from '../ports.js';
import type { Resolver } from '../resolve.js';

const MAX_CONVENTIONS = 60;

export interface ConventionsView {
  repo: string;
  conventions: Array<{ category: string; rule: string; path: string | null; line: number | null }>;
  truncated?: number;
  hint?: string;
}

export interface GetConventionsInput {
  repo: string;
  category?: ConventionCategory;
}

export interface GetConventionsDeps {
  api: Pick<DevDigestApi, 'listConventions'>;
  resolver: Resolver;
}

export function makeGetConventions(deps: GetConventionsDeps): (i: GetConventionsInput) => Promise<ConventionsView> {
  return async (input) => {
    const repo = await deps.resolver.repo(input.repo);
    const list = await deps.api.listConventions(repo.id);

    // Filter to only accepted conventions
    let items = list.items.filter((item) => item.status === 'accepted');

    // Filter by category if provided
    if (input.category) {
      items = items.filter((item) => item.category === input.category);
    }

    // Compute whether scan is running
    const scanRunning = list.scan?.status === 'running';

    // Generate hint for empty results
    let hint: string | undefined;
    if (items.length === 0) {
      if (scanRunning) {
        hint = 'extraction is in progress; check back in a minute';
      } else {
        hint = 'run extraction in the UI: Skills Lab → Conventions';
      }
    }

    // Limit to MAX_CONVENTIONS and compute truncated
    let truncated: number | undefined;
    if (items.length > MAX_CONVENTIONS) {
      truncated = items.length - MAX_CONVENTIONS;
      const total = items.length;
      items = items.slice(0, MAX_CONVENTIONS);
      if (!hint) {
        hint = `Showing ${MAX_CONVENTIONS}/${total} conventions; pass category to filter`;
      }
    }

    // Map to output format
    const conventions = items.map((item) => ({
      category: item.category,
      rule: item.rule,
      path: item.evidence_path,
      line: item.evidence_line,
    }));

    // Long rules can still blow the response budget: drop from the tail until it fits.
    const view: ConventionsView = { repo: repo.full_name, conventions, ...(hint !== undefined ? { hint } : {}) };
    if (truncated !== undefined) view.truncated = truncated;
    while (conventions.length > 0 && JSON.stringify(view).length > MAX_RESPONSE_CHARS) {
      conventions.pop();
      view.truncated = (view.truncated ?? 0) + 1;
      view.hint = 'response too large; pass category to filter';
    }
    return view;
  };
}
