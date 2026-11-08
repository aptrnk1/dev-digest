import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingGenerateResponse, OnboardingTourResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { toHttpError } from './http-errors.js';

/**
 * Onboarding Tour.
 *   GET  /repos/:id/onboarding           → { job, tour } (nulls before the first run)
 *   POST /repos/:id/onboarding/generate  → 202 { job }, generation runs in the background
 * 404 unknown repo · 409 repo_not_cloned / onboarding_in_progress · 422 llm_not_configured.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams, response: { 200: OnboardingTourResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const res = await app.container.onboarding(app.log).get(workspaceId, req.params.id);
      if (!res) throw new NotFoundError('Repo not found');
      return res;
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    { schema: { params: IdParams, response: { 202: OnboardingGenerateResponse } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        const job = await app.container.onboarding(app.log).generate(workspaceId, req.params.id);
        if (!job) throw new NotFoundError('Repo not found');
        reply.status(202);
        return { job };
      } catch (err) {
        throw toHttpError(err);
      }
    },
  );
}
