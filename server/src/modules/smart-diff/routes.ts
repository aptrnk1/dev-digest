import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { toHttpError } from './http-errors.js';

/**
 * Smart Diff — PR files grouped by role with a findings overlay.
 *   GET /pulls/:id/smart-diff → SmartDiffResponse (reads stored data only)
 * 404 unknown PR.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await app.container.smartDiff.get(workspaceId, req.params.id);
      } catch (err) {
        throw toHttpError(err);
      }
    },
  );
}
