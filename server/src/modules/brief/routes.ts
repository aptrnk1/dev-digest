import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBrief, PrBriefState } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { createBriefService } from './compose.js';
import { toHttpError } from './http-errors.js';

/**
 * PR Risk Brief.
 *   GET  /pulls/:id/brief  → { brief, stale } (never calls the LLM)
 *   POST /pulls/:id/brief  → generate now, stores and returns the brief
 * 404 unknown PR · 409 brief_in_progress · 422 llm_not_configured · 502 brief_failed.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // once per app: the generation lock lives in this instance
  const service = createBriefService(app.container, app.log);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefState } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await service.get(workspaceId, req.params.id);
      } catch (err) {
        throw toHttpError(err);
      }
    },
  );

  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBrief } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await service.generate(workspaceId, req.params.id);
      } catch (err) {
        throw toHttpError(err);
      }
    },
  );
}
