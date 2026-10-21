import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullFilesRead, SmartDiffStore } from './ports.js';

/** Drizzle adapter: workspace-scoped read of a PR's stored files. Writes nothing. */
export class SmartDiffRepository implements SmartDiffStore {
  constructor(private readonly db: Db) {}

  async loadPullFiles(workspaceId: string, prId: string): Promise<PullFilesRead | undefined> {
    const [pr] = await this.db
      .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) return undefined;

    const files = await this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
        patch: t.prFiles.patch,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
    return { prId: pr.id, repoId: pr.repoId, files };
  }
}
