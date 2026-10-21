import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
} from '../src/adapters/mocks.js';
import type { SmartDiffResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * Smart Diff end to end against real Postgres + the seeded PR #482: grouping,
 * per-file findings, newest-run-per-agent selection, dismissed and non-PR-file
 * findings dropped, unknown PR is a 404 (AC2, AC4).
 */
d('Smart Diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let prId: string;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openrouter: new MockLLMProvider('openai', {}) },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function getSmartDiff(id = prId): Promise<SmartDiffResponse> {
    const res = await app.inject({ method: 'GET', url: `/pulls/${id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    return res.json() as SmartDiffResponse;
  }
  const findFile = (body: SmartDiffResponse, path: string) =>
    body.groups.flatMap((g) => g.files).find((f) => f.path === path);

  async function addReview(agentId: string, createdAt: Date, fs: { file: string; line: number }[]) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, kind: 'review', model: 'test', createdAt })
      .returning();
    const rows = await pg.handle.db
      .insert(t.findings)
      .values(
        fs.map((f) => ({
          reviewId: review!.id,
          file: f.file,
          startLine: f.line,
          endLine: f.line,
          severity: 'SUGGESTION',
          category: 'style',
          title: `finding ${f.file}:${f.line}`,
          rationale: 'r',
          confidence: 0.5,
        })),
      )
      .returning();
    return rows;
  }

  it('groups the seeded PR in display order with the seeded findings', async () => {
    const body = await getSmartDiff();
    const groups = body.groups;
    expect(groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(groups[0]!.files_with_findings).toBe(2);
    const config = findFile(body, 'src/config.ts')!;
    expect(config.finding_lines).toEqual([12]);
    expect(config.max_severity).toBe('CRITICAL');
    expect(config.finding_ids).toHaveLength(1);
    expect(body.split_suggestion.too_big).toBe(false);
  });

  it('counts only the newest review per agent and drops findings on non-PR files', async () => {
    const agentId = randomUUID();
    const older = await addReview(agentId, new Date('2030-01-01T00:00:00Z'), [
      { file: 'src/middleware/ratelimit.ts', line: 5 },
    ]);
    const newer = await addReview(agentId, new Date('2030-01-02T00:00:00Z'), [
      { file: 'src/api/public/webhooks.ts', line: 46 },
      { file: 'src/not-in-this-pr.ts', line: 3 },
    ]);

    const body = await getSmartDiff();
    const ratelimit = findFile(body, 'src/middleware/ratelimit.ts')!;
    expect(ratelimit.finding_ids).not.toContain(older[0]!.id);
    expect(ratelimit.finding_ids).toHaveLength(0);
    expect(ratelimit.max_severity).toBeNull();

    const webhooks = findFile(body, 'src/api/public/webhooks.ts')!;
    expect(webhooks.finding_ids).toEqual([newer[0]!.id]);
    expect(webhooks.finding_lines).toEqual([46]);

    const allIds = body.groups.flatMap((g) => g.files.flatMap((f) => f.finding_ids));
    expect(allIds).not.toContain(newer[1]!.id);
  });

  it('a dismissed finding disappears from the response', async () => {
    const [row] = await pg.handle.db
      .select({ id: t.findings.id })
      .from(t.findings)
      .where(and(eq(t.findings.file, 'src/config.ts'), eq(t.findings.startLine, 12)));
    const before = findFile(await getSmartDiff(), 'src/config.ts')!;
    expect(before.finding_ids).toContain(row!.id);

    const res = await app.inject({ method: 'POST', url: `/findings/${row!.id}/dismiss` });
    expect(res.statusCode).toBe(200);

    const after = findFile(await getSmartDiff(), 'src/config.ts')!;
    expect(after.finding_ids).not.toContain(row!.id);
    expect(after.finding_lines).toEqual([]);
    expect(after.max_severity).toBeNull();
  });

  it('unknown PR is a 404', async () => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${randomUUID()}/smart-diff` });
    expect(res.statusCode).toBe(404);
  });
});
