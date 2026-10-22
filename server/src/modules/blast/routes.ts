import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { toHttpError } from './http-errors.js';

/**
 * Blast radius — changed symbols, callers and affected endpoints/crons.
 *   GET /pulls/:id/blast-radius → BlastRadiusResponse (reads the repo index only)
 * 404 unknown PR.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/blast-radius',
    { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      try {
        return await app.container.blast.get(workspaceId, req.params.id);
      } catch (err) {
        throw toHttpError(err);
      }
    },
  );
}
