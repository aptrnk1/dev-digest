import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { IntentBasis, IntentConfidence, IntentRiskKind } from '@devdigest/shared';
import type { IntentRecord, IntentStore, NewIntent, PullInputs, StoredIntent } from './ports.js';
import { MAX_COMMITS, MAX_PATHS } from './constants.js';

type IntentRow = typeof t.prIntent.$inferSelect;

const toRecord = (r: IntentRow): IntentRecord => ({
  prId: r.prId,
  intent: r.intent,
  inScope: r.inScope,
  outOfScope: r.outOfScope,
  riskAreas: r.riskAreas.map((a) => ({ label: a.label, kind: a.kind as IntentRiskKind })),
  confidence: r.confidence as IntentConfidence,
  // legacy rows (pre-Intent Layer) have no basis — they were never evidence-graded
  basis: (r.basis ?? 'inferred') as IntentBasis,
  sources: r.sources.map((s) => ({ kind: s.kind as IntentBasis, ref: s.ref, truncated: s.truncated })),
  unresolvedRefs: r.unresolvedRefs,
  headSha: r.headSha,
  model: r.model,
  costUsd: r.costUsd,
  updatedAt: r.updatedAt,
});

const toStored = (r: IntentRow): StoredIntent => ({ inputHash: r.inputHash, record: toRecord(r) });

/** Drizzle adapter for `pr_intent` (sole owner) + the PR reads the classifier needs. */
export class IntentRepository implements IntentStore {
  constructor(private readonly db: Db) {}

  async loadPull(workspaceId: string, prId: string): Promise<PullInputs | undefined> {
    const [pr] = await this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        branch: t.pullRequests.branch,
        headSha: t.pullRequests.headSha,
        owner: t.repos.owner,
        name: t.repos.name,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) return undefined;

    const [commits, files] = await Promise.all([
      this.db
        .select({ message: t.prCommits.message })
        .from(t.prCommits)
        .where(eq(t.prCommits.prId, prId))
        .orderBy(asc(t.prCommits.committedAt))
        .limit(MAX_COMMITS),
      this.db
        .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
        .from(t.prFiles)
        .where(eq(t.prFiles.prId, prId))
        .orderBy(asc(t.prFiles.path))
        .limit(MAX_PATHS),
    ]);

    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      branch: pr.branch,
      headSha: pr.headSha,
      repo: { owner: pr.owner, name: pr.name },
      commits: commits.map((c) => c.message),
      files,
    };
  }

  async getIntent(prId: string): Promise<StoredIntent | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row && toStored(row);
  }

  async upsertIntent(prId: string, row: NewIntent): Promise<IntentRecord> {
    const values = {
      intent: row.intent,
      inScope: row.in_scope,
      outOfScope: row.out_of_scope,
      riskAreas: row.risk_areas,
      confidence: row.confidence,
      basis: row.basis,
      sources: row.sources,
      unresolvedRefs: row.unresolved_refs,
      headSha: row.head_sha,
      inputHash: row.input_hash,
      model: row.model,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      costUsd: row.cost_usd,
      updatedAt: new Date(),
    };
    const [saved] = await this.db
      .insert(t.prIntent)
      .values({ prId, ...values })
      .onConflictDoUpdate({ target: t.prIntent.prId, set: values })
      .returning();
    return toRecord(saved!);
  }
}
