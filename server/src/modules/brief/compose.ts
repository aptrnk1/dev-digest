import type { Container } from '../../platform/container.js';
import { ConfigError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { LLM_TIMEOUT_MS } from './constants.js';
import { BriefDomainError } from './domain.js';
import { BriefRepository } from './repository.js';
import { BriefService, type BriefLogger } from './service.js';

/** The only place that wires the brief module to the container. */
export function createBriefService(c: Container, logger?: BriefLogger): BriefService {
  return new BriefService({
    store: new BriefRepository(c.db),
    intent: c.intent,
    blast: c.blast,
    diff: c.smartDiff,
    specs: c.runContext,
    tokens: c.tokenizer,
    logger,
    resolveModel: async (workspaceId) => {
      const choice = await resolveFeatureModel(c, workspaceId, 'risk_brief');
      try {
        // retries live in the service (≤ 2 attempts), so transport retries are 0
        const provider = await c.llmWithLimits(choice.provider, { maxRetries: 0, timeoutMs: LLM_TIMEOUT_MS });
        return { model: choice.model, provider };
      } catch (err) {
        if (err instanceof ConfigError) throw new BriefDomainError('llm_not_configured', err.message);
        throw err;
      }
    },
  });
}
