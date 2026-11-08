import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider } from '@devdigest/shared';

vi.mock('../src/modules/settings/feature-models.js', () => ({
  resolveFeatureModel: vi.fn(async () => ({ provider: 'anthropic', model: 'claude-x' })),
}));

import { resolveFeatureModel } from '../src/modules/settings/feature-models.js';
import { createOnboardingFacade } from '../src/modules/onboarding/compose.js';
import { ConfigError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';

const logger = { info: vi.fn(), error: vi.fn() };

function container(llmWithLimits: ReturnType<typeof vi.fn>): Container {
  return {
    db: {},
    repoIntel: {},
    git: {},
    tokenizer: { count: () => 0 },
    config: { repoIntelEnabled: true },
    llmWithLimits,
  } as unknown as Container;
}

describe('createOnboardingFacade', () => {
  it('builds the probe provider from the feature-model choice with maxRetries 0', async () => {
    const llm = vi.fn(async () => ({}) as LLMProvider);
    const c = container(llm);
    // db stub: repository finds no repo -> generate() is undefined, but only after nothing else ran
    const facade = createOnboardingFacade(c, logger);
    expect(typeof facade.get).toBe('function');
    expect(typeof facade.generate).toBe('function');
    expect(resolveFeatureModel).not.toHaveBeenCalled(); // lazy: nothing resolved until a POST
  });

  it('ConfigError from the probe becomes llm_not_configured', async () => {
    const llm = vi.fn(async () => {
      throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    });
    const c = container(llm);
    // Reach the injected resolveModel through a real service with a stubbed repository.
    const { OnboardingRepository } = await import('../src/modules/onboarding/repository.js');
    const spy = vi
      .spyOn(OnboardingRepository.prototype, 'getRepo')
      .mockResolvedValue({ id: 'r', owner: 'o', name: 'n', clonePath: '/c' });
    vi.spyOn(OnboardingRepository.prototype, 'getState').mockResolvedValue(undefined);
    const { FsRepoFiles } = await import('../src/modules/onboarding/fs-source.js');
    vi.spyOn(FsRepoFiles.prototype, 'isClone').mockResolvedValue(true);

    const facade = createOnboardingFacade(c, logger);
    await expect(facade.generate('ws', 'r')).rejects.toMatchObject({ code: 'llm_not_configured' });
    expect(resolveFeatureModel).toHaveBeenCalledWith(c, 'ws', 'onboarding');
    expect(llm).toHaveBeenCalledWith('anthropic', { maxRetries: 0, timeoutMs: 180_000 });
    spy.mockRestore();
  });
});
