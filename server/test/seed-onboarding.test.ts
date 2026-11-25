import { describe, it, expect } from 'vitest';
import { OnboardingTour } from '@devdigest/shared';
import { SEED_ONBOARDING_COMMIT_SHA, seedOnboardingTour } from '../src/db/seed-onboarding.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');

describe('seedOnboardingTour (AC71)', () => {
  const tour = seedOnboardingTour(NOW);

  it('passes the OnboardingTour contract', () => {
    expect(() => OnboardingTour.parse(tour)).not.toThrow();
    expect(SEED_ONBOARDING_COMMIT_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(tour.commit_sha).toBe(SEED_ONBOARDING_COMMIT_SHA);
  });

  it('has the indexing metadata and generated_at = now - 2h', () => {
    expect(tour.files_indexed).toBe(12450);
    expect(tour.index_status).toBe('full');
    expect(tour.generated_at).toBe(new Date(NOW.getTime() - 2 * 3600_000).toISOString());
  });

  it('has the summary verbatim', () => {
    expect(tour.architecture.summary).toBe(
      '**payments-api** is a Node + TypeScript service fronting Stripe. Requests enter through `src/server.ts`, pass middleware (auth, rate-limit), and route to `src/api/*`. Persistence is Postgres via a thin `db` client; Redis backs sessions and the new rate-limit buckets.',
    );
  });

  it('has the 6-node, 5-edge diagram', () => {
    const { nodes, edges } = tour.architecture.diagram;
    expect(nodes).toEqual([
      { id: 'n1', label: 'client', kind: 'external', path: null },
      { id: 'n2', label: 'server.ts', kind: 'entry', path: 'src/server.ts' },
      { id: 'n3', label: 'middleware', kind: 'middleware', path: null },
      { id: 'n4', label: 'api/public/*', kind: 'module', path: null },
      { id: 'n5', label: 'redis', kind: 'datastore', path: null },
      { id: 'n6', label: 'postgres', kind: 'datastore', path: null },
    ]);
    expect(edges).toEqual([
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n3', to: 'n5' },
      { from: 'n4', to: 'n6' },
    ]);
  });

  it('has the critical paths, run steps and reading path', () => {
    expect(tour.critical_paths).toEqual([
      { path: 'src/server.ts', description: 'App bootstrap + middleware chain' },
      { path: 'src/api/public/index.ts', description: 'Public router — unauthenticated surface' },
      { path: 'src/middleware/auth.ts', description: 'Token validation, used by 14 routes' },
      { path: 'src/lib/redis.ts', description: 'Shared Redis singleton — reuse this' },
    ]);
    expect(tour.run_steps).toEqual([
      { command: 'pnpm install', source_path: 'package.json' },
      { command: 'cp .env.example .env # add OPENAI + STRIPE keys', source_path: '.env.example' },
      { command: 'docker compose up -d postgres redis', source_path: 'docker-compose.yml' },
      { command: 'pnpm dev # http://localhost:3000', source_path: 'package.json' },
    ]);
    expect(tour.reading_path).toEqual([
      { path: 'src/server.ts', why: 'See the whole request lifecycle in one file' },
      { path: 'src/api/public/index.ts', why: 'Understand the public contract before touching it' },
      { path: 'src/middleware/auth.ts', why: 'Auth touches almost everything downstream' },
    ]);
  });

  it('has 3 first tasks with descriptions <= 140', () => {
    expect(tour.first_tasks.map((x) => [x.title, x.size, x.files])).toEqual([
      ['Cover expired tokens in auth middleware', 'S', ['src/middleware/auth.ts']],
      ['Reuse the shared Redis client for rate-limit buckets', 'M', ['src/lib/redis.ts']],
      ['Document the public router endpoints', 'S', ['src/api/public/index.ts']],
    ]);
    for (const x of tour.first_tasks) {
      expect(x.description.length).toBeGreaterThan(0);
      expect(x.description.length).toBeLessThanOrEqual(140);
    }
  });
});
