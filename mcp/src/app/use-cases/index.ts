import type { makeGetBlastRadius } from './get-blast-radius.js';
import type { makeGetConventions } from './get-conventions.js';
import type { makeGetFindings } from './get-findings.js';
import type { makeListAgents } from './list-agents.js';
import type { makeRunReview } from './run-review.js';

export interface UseCases {
  listAgents: ReturnType<typeof makeListAgents>;
  runReview: ReturnType<typeof makeRunReview>;
  getFindings: ReturnType<typeof makeGetFindings>;
  getConventions: ReturnType<typeof makeGetConventions>;
  getBlastRadius: ReturnType<typeof makeGetBlastRadius>;
}
