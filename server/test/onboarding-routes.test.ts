import { describe, it, expect, vi } from 'vitest';
import { OnboardingGenerateResponse, OnboardingTourResponse } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { OnboardingDomainError } from '../src/modules/onboarding/domain.js';
import type { OnboardingFacade } from '../src/modules/onboarding/types.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const ID = '11111111-1111-4111-8111-111111111111';
const job = { status: 'running' as const, error: null, started_at: '2026-10-24T10:00:00.000Z', finished_at: null };

function app(onboarding: OnboardingFacade) {
  return buildApp({ config, overrides: { auth: new MockAuthProvider(), onboarding } });
}
const facade = (over: Partial<OnboardingFacade> = {}): OnboardingFacade => ({
  get: vi.fn(async () => ({ job: null, tour: null })),
  generate: vi.fn(async () => job),
  ...over,
});

describe('GET /repos/:id/onboarding', () => {
  it('200 body matches OnboardingTourResponse', async () => {
    const a = await app(facade());
    const res = await a.inject({ method: 'GET', url: `/repos/${ID}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(OnboardingTourResponse.safeParse(res.json()).success).toBe(true);
  });
  it('404 unknown repo, 422 non-uuid', async () => {
    const a = await app(facade({ get: async () => undefined }));
    expect((await a.inject({ method: 'GET', url: `/repos/${ID}/onboarding` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: '/repos/nope/onboarding' })).statusCode).toBe(422);
  });
});

describe('POST /repos/:id/onboarding/generate', () => {
  it('202 { job }', async () => {
    const a = await app(facade());
    const res = await a.inject({ method: 'POST', url: `/repos/${ID}/onboarding/generate` });
    expect(res.statusCode).toBe(202);
    expect(OnboardingGenerateResponse.safeParse(res.json()).success).toBe(true);
  });
  it('404 and 422', async () => {
    const a = await app(facade({ generate: async () => undefined }));
    expect((await a.inject({ method: 'POST', url: `/repos/${ID}/onboarding/generate` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'POST', url: '/repos/nope/onboarding/generate' })).statusCode).toBe(422);
  });
  it.each([
    ['repo_not_cloned', 409],
    ['onboarding_in_progress', 409],
    ['llm_not_configured', 422],
  ] as const)('%s -> %i', async (code, status) => {
    const a = await app(
      facade({
        generate: async () => {
          throw new OnboardingDomainError(code, 'msg');
        },
      }),
    );
    const res = await a.inject({ method: 'POST', url: `/repos/${ID}/onboarding/generate` });
    expect(res.statusCode).toBe(status);
    expect(JSON.stringify(res.json())).toContain(code);
  });
});
