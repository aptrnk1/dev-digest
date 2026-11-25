import type { Container } from '../../platform/container.js';
import { ConfigError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { DEADLINE_MS } from './constants.js';
import { OnboardingDomainError } from './domain.js';
import { FsRepoFiles } from './fs-source.js';
import { OnboardingRepository } from './repository.js';
import { OnboardingService } from './service.js';
import type { OnboardingLogger } from './ports.js';
import type { OnboardingFacade } from './types.js';

/**
 * Transport retries are always 0: the service owns the single retry, so the
 * "at most MAX_HTTP_REQUESTS requests" budget is counted in exactly one place.
 */
const PROVIDER_RETRIES = 0;

/** `container.onboarding` — the only place that wires this module to the container. */
export function createOnboardingFacade(c: Container, logger: OnboardingLogger): OnboardingFacade {
  const service = new OnboardingService({
    store: new OnboardingRepository(c.db, logger),
    files: new FsRepoFiles(),
    index: c.repoIntel,
    head: c.git,
    tokens: c.tokenizer,
    resolveModel: async (workspaceId) => {
      const choice = await resolveFeatureModel(c, workspaceId, 'onboarding');
      const build = (timeoutMs: number) =>
        c.llmWithLimits(choice.provider, { maxRetries: PROVIDER_RETRIES, timeoutMs });
      try {
        await build(DEADLINE_MS); // probe: fails fast (422) when the key is missing
      } catch (err) {
        if (err instanceof ConfigError) {
          throw new OnboardingDomainError('llm_not_configured', err.message);
        }
        throw err;
      }
      return { model: choice.model, provider: build };
    },
    loadSystemPrompt: () => renderPrompt('onboarding.system.md', { language: 'English' }),
    repoIntelEnabled: c.config.repoIntelEnabled,
    logger,
  });
  return {
    get: (workspaceId, repoId) => service.get(workspaceId, repoId),
    generate: (workspaceId, repoId) => service.generate(workspaceId, repoId),
  };
}
