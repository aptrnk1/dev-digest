import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DeriveIntentBody, PrIntentRecord, PrIntentState } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { createIntentService } from './compose.js';
import { toHttpError } from './http-errors.js';

/**
 * Intent Layer — PR intent (why the PR exists, scope, risk areas).
 *   GET  /pulls/:id/intent  → cached intent (or null) + `stale` (head moved since)
 *   POST /pulls/:id/intent  → derive now (cache hit unless inputs changed or `force`)
 * 404 unknown PR · 422 `llm_not_configured` (no key for the chosen provider).
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = createIntentService(app.container, app.log);

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentState } } },
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
    '/pulls/:id/intent',
    { schema: { params: IdParams, body: DeriveIntentBody.nullish(), response: { 200: PrIntentRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await service.ensure(workspaceId, req.params.id, { force: req.body?.force ?? false });
      } catch (err) {
        throw toHttpError(err);
      }
    },
  );
}
