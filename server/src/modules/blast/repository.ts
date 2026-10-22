import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BlastStore, PullPathsRead } from './ports.js';

/** Drizzle adapter: workspace-scoped read of a PR's repo and file paths. Writes nothing. */
export class BlastRepository implements BlastStore {
  constructor(private readonly db: Db) {}

  async loadPull(workspaceId: string, prId: string): Promise<PullPathsRead | undefined> {
    const [pr] = await this.db
      .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) return undefined;

    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
    return { prId: pr.id, repoId: pr.repoId, paths: rows.map((r) => r.path) };
  }
}
