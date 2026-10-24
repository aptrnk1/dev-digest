import { and, asc, eq } from 'drizzle-orm';
import type { PrBrief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BriefPull, BriefStore } from './ports.js';

/** Drizzle adapter for `pr_brief` (sole owner) + the PR reads the brief needs. */
export class BriefRepository implements BriefStore {
  constructor(private readonly db: Db) {}

  async loadPull(workspaceId: string, prId: string): Promise<BriefPull | undefined> {
    const [pr] = await this.db
      .select({
        id: t.pullRequests.id,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        headSha: t.pullRequests.headSha,
        base: t.pullRequests.base,
        repoId: t.pullRequests.repoId,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
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

    return {
      id: pr.id,
      title: pr.title,
      body: pr.body,
      headSha: pr.headSha,
      base: pr.base,
      repoId: pr.repoId,
      repo: { owner: pr.owner, name: pr.name },
      clonePath: pr.clonePath,
      files,
    };
  }

  async getBriefJson(prId: string): Promise<unknown | undefined> {
    const [row] = await this.db.select({ json: t.prBrief.json }).from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row?.json;
  }

  async upsertBrief(prId: string, brief: PrBrief): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: brief })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } });
  }
}
