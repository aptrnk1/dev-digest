import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachments,
  ContextAttachmentsInput,
  ContextDocUsage,
  SpecFile,
  SpecFileList,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { toHttpError } from './http-errors.js';

const PathQuery = z.object({ path: z.string().min(1) });
const RepoQuery = z.object({ repo_id: z.string().uuid() });

/**
 * Project Context — repo Markdown docs and their attachments to agents/skills.
 *   GET /repos/:id/context · /context/file?path= · /context/usage?path=
 *   GET|PUT /agents/:id/context?repo_id= · /skills/:id/context?repo_id=
 * 404 unknown repo/agent/skill/doc · 409 repo_not_cloned · 422 bad path.
 */
export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw toHttpError(err);
    }
  };

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: SpecFileList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return run(() => app.container.projectContext.list(workspaceId, req.params.id));
    },
  );

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: PathQuery, response: { 200: SpecFile } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return run(() =>
        app.container.projectContext.file(workspaceId, req.params.id, req.query.path),
      );
    },
  );

  app.get(
    '/repos/:id/context/usage',
    { schema: { params: IdParams, querystring: PathQuery, response: { 200: ContextDocUsage } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return run(() =>
        app.container.projectContext.usage(workspaceId, req.params.id, req.query.path),
      );
    },
  );

  for (const kind of ['agent', 'skill'] as const) {
    const url = `/${kind}s/:id/context`;

    app.get(
      url,
      { schema: { params: IdParams, querystring: RepoQuery, response: { 200: ContextAttachments } } },
      async (req) => {
        const { workspaceId } = await getContext(app.container, req);
        return run(() =>
          app.container.projectContext.getAttachments(
            workspaceId,
            { kind, id: req.params.id },
            req.query.repo_id,
          ),
        );
      },
    );

    app.put(
      url,
      {
        schema: {
          params: IdParams,
          querystring: RepoQuery,
          body: ContextAttachmentsInput,
          response: { 200: ContextAttachments },
        },
      },
      async (req) => {
        const { workspaceId } = await getContext(app.container, req);
        return run(() =>
          app.container.projectContext.setAttachments(
            workspaceId,
            { kind, id: req.params.id },
            req.query.repo_id,
            req.body.paths,
          ),
        );
      },
    );
  }
}
