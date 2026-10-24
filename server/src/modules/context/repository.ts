import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextDocUsage } from '@devdigest/shared';
import type { AttachmentStore } from './ports.js';
import type { ContextOwnerRef, RunAttachments } from './types.js';

/** Drizzle adapter for `context_attachments` (+ workspace-scoped owner/repo lookups). */
export class ContextRepository implements AttachmentStore {
  constructor(private readonly db: Db) {}

  async findRepo(ws: string, repoId: string) {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, ws), eq(t.repos.id, repoId)));
    return row ?? null;
  }

  async ownerExists(ws: string, owner: ContextOwnerRef): Promise<boolean> {
    const rows =
      owner.kind === 'agent'
        ? await this.db
            .select({ id: t.agents.id })
            .from(t.agents)
            .where(and(eq(t.agents.workspaceId, ws), eq(t.agents.id, owner.id)))
        : await this.db
            .select({ id: t.skills.id })
            .from(t.skills)
            .where(and(eq(t.skills.workspaceId, ws), eq(t.skills.id, owner.id)));
    return rows.length > 0;
  }

  private ownerCol(owner: ContextOwnerRef) {
    return owner.kind === 'agent' ? t.contextAttachments.agentId : t.contextAttachments.skillId;
  }

  async listOwn(owner: ContextOwnerRef, repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.contextAttachments.path })
      .from(t.contextAttachments)
      .where(and(eq(this.ownerCol(owner), owner.id), eq(t.contextAttachments.repoId, repoId)))
      .orderBy(asc(t.contextAttachments.order));
    return rows.map((r) => r.path);
  }

  /** Replace the (owner, repo) list in one transaction: delete + insert in order. */
  async replace(ws: string, owner: ContextOwnerRef, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Serialize overlapping PUTs for the same (owner, repo): last one wins, no unique-index 500.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${owner.kind}:${owner.id}:${repoId}`}))`,
      );
      await tx
        .delete(t.contextAttachments)
        .where(and(eq(this.ownerCol(owner), owner.id), eq(t.contextAttachments.repoId, repoId)));
      if (paths.length === 0) return;
      await tx.insert(t.contextAttachments).values(
        paths.map((path, order) => ({
          workspaceId: ws,
          repoId,
          agentId: owner.kind === 'agent' ? owner.id : null,
          skillId: owner.kind === 'skill' ? owner.id : null,
          path,
          order,
        })),
      );
    });
  }

  async usage(ws: string, repoId: string, path: string): Promise<ContextDocUsage> {
    const scope = and(
      eq(t.contextAttachments.workspaceId, ws),
      eq(t.contextAttachments.repoId, repoId),
      eq(t.contextAttachments.path, path),
    );
    const agents = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.contextAttachments)
      .innerJoin(t.agents, eq(t.agents.id, t.contextAttachments.agentId))
      .where(scope)
      .orderBy(asc(t.agents.name));
    const skills = await this.db
      .select({ id: t.skills.id, name: t.skills.name })
      .from(t.contextAttachments)
      .innerJoin(t.skills, eq(t.skills.id, t.contextAttachments.skillId))
      .where(scope)
      .orderBy(asc(t.skills.name));
    return { agents, skills };
  }

  async loadForRun(agentId: string, repoId: string): Promise<RunAttachments> {
    const own = await this.listOwn({ kind: 'agent', id: agentId }, repoId);

    const links = await this.db
      .select({ skillId: t.skills.id, skillName: t.skills.name })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
        ),
      )
      .orderBy(asc(t.agentSkills.order));
    if (links.length === 0) return { own, skills: [] };

    const rows = await this.db
      .select({ skillId: t.contextAttachments.skillId, path: t.contextAttachments.path })
      .from(t.contextAttachments)
      .where(
        and(
          eq(t.contextAttachments.repoId, repoId),
          inArray(
            t.contextAttachments.skillId,
            links.map((l) => l.skillId),
          ),
        ),
      )
      .orderBy(asc(t.contextAttachments.order));

    return {
      own,
      skills: links.map((l) => ({
        ...l,
        paths: rows.filter((r) => r.skillId === l.skillId).map((r) => r.path),
      })),
    };
  }
}
