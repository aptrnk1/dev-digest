import type { Container } from '../../platform/container.js';
import { ConfigError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { IntentService } from './service.js';
import { IntentRepository } from './repository.js';
import { IntentDomainError } from './domain.js';
import { renderIntentForPrompt } from './helpers.js';
import type { Logger } from './ports.js';
import type { IntentFacade } from './types.js';

export function createIntentService(c: Container, logger?: Logger): IntentService {
  return new IntentService({
    store: new IntentRepository(c.db),
    issues: { getIssue: async (repo, n) => (await c.github()).getIssue(repo, n) },
    files: c.git,
    resolveModel: async (workspaceId) => {
      const choice = await resolveFeatureModel(c, workspaceId, 'review_intent');
      try {
        return { llm: await c.llm(choice.provider), model: choice.model };
      } catch (err) {
        if (err instanceof ConfigError) {
          throw new IntentDomainError('llm_not_configured', err.message);
        }
        throw err;
      }
    },
    logger,
  });
}

/** `container.intent` — what the reviews module sees of this module. */
export function createIntentFacade(c: Container, logger?: Logger): IntentFacade {
  const service = createIntentService(c, logger);
  return {
    ensure: (workspaceId, prId, opts) => service.ensure(workspaceId, prId, opts),
    get: (workspaceId, prId) => service.get(workspaceId, prId),
    renderForPrompt: renderIntentForPrompt,
  };
}
