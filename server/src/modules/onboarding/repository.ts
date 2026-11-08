import { and, eq, gte, lt, ne, or } from 'drizzle-orm';
import { OnboardingTour } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  JobRecord,
  OnboardingLogger,
  OnboardingState,
  OnboardingStore,
  RepoBasics,
} from './ports.js';

type Row = typeof t.onboarding.$inferSelect;

const toJob = (r: Pick<Row, 'runId' | 'status' | 'error' | 'startedAt' | 'finishedAt'>): JobRecord => ({
  runId: r.runId,
  status: r.status,
  error: r.error,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
});

/** Drizzle adapter for the `onboarding` row (one per repo). */
export class OnboardingRepository implements OnboardingStore {
  constructor(
    private readonly db: Db,
    private readonly logger?: OnboardingLogger,
  ) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, owner: t.repos.owner, name: t.repos.name, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async getState(repoId: string): Promise<OnboardingState | undefined> {
    const [row] = await this.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    if (!row) return undefined;
    let tour: OnboardingTour | null = null;
    if (row.json != null) {
      const parsed = OnboardingTour.safeParse(row.json);
      if (parsed.success) tour = parsed.data;
      else this.logger?.info({ repoId }, 'onboarding: stored tour no longer matches the contract');
    }
    return { job: toJob(row), tour };
  }

  async tryStart(
    repoId: string,
    runId: string,
    now: Date,
    staleMs: number,
  ): Promise<JobRecord | null> {
    const cutoff = new Date(now.getTime() - staleMs);
    // One statement: insert, or take over a finished/failed/stale row. A live
    // `running` row makes the WHERE false -> no row returned.
    const [row] = await this.db
      .insert(t.onboarding)
      .values({ repoId, runId, status: 'running', error: null, startedAt: now, finishedAt: null })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { runId, status: 'running', error: null, startedAt: now, finishedAt: null },
        setWhere: or(ne(t.onboarding.status, 'running'), lt(t.onboarding.startedAt, cutoff)),
      })
      .returning();
    return row ? toJob(row) : null;
  }

  async complete(
    repoId: string,
    runId: string,
    tour: OnboardingTour,
    finishedAt: Date,
    staleMs: number,
  ): Promise<boolean> {
    const rows = await this.db
      .update(t.onboarding)
      .set({ status: 'done', error: null, json: tour, generatedAt: finishedAt, finishedAt })
      .where(this.liveRun(repoId, runId, finishedAt, staleMs))
      .returning({ repoId: t.onboarding.repoId });
    return rows.length > 0;
  }

  async fail(
    repoId: string,
    runId: string,
    error: string,
    finishedAt: Date,
    staleMs: number,
  ): Promise<boolean> {
    const rows = await this.db
      .update(t.onboarding)
      .set({ status: 'failed', error, finishedAt })
      .where(this.liveRun(repoId, runId, finishedAt, staleMs))
      .returning({ repoId: t.onboarding.repoId });
    return rows.length > 0;
  }

  /** Compare-and-set guard: same run, still running, not older than the stale threshold. */
  private liveRun(repoId: string, runId: string, now: Date, staleMs: number) {
    return and(
      eq(t.onboarding.repoId, repoId),
      eq(t.onboarding.runId, runId),
      eq(t.onboarding.status, 'running'),
      gte(t.onboarding.startedAt, new Date(now.getTime() - staleMs)),
    );
  }
}
