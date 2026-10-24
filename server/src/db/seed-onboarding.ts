import type { OnboardingTour } from '@devdigest/shared';

/**
 * L05 — demo Onboarding Tour for acme/payments-api (the demo repo has no clone,
 * so this stands in for one finished generation). Content mirrors designs D1/D2.
 */
export const SEED_ONBOARDING_COMMIT_SHA = 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70819';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function seedOnboardingTour(now: Date): OnboardingTour {
  return {
    commit_sha: SEED_ONBOARDING_COMMIT_SHA,
    generated_at: new Date(now.getTime() - TWO_HOURS_MS).toISOString(),
    files_indexed: 12450,
    index_status: 'full',
    architecture: {
      summary:
        '**payments-api** is a Node + TypeScript service fronting Stripe. Requests enter through `src/server.ts`, pass middleware (auth, rate-limit), and route to `src/api/*`. Persistence is Postgres via a thin `db` client; Redis backs sessions and the new rate-limit buckets.',
      diagram: {
        nodes: [
          { id: 'n1', label: 'client', kind: 'external', path: null },
          { id: 'n2', label: 'server.ts', kind: 'entry', path: 'src/server.ts' },
          { id: 'n3', label: 'middleware', kind: 'middleware', path: null },
          { id: 'n4', label: 'api/public/*', kind: 'module', path: null },
          { id: 'n5', label: 'redis', kind: 'datastore', path: null },
          { id: 'n6', label: 'postgres', kind: 'datastore', path: null },
        ],
        edges: [
          { from: 'n1', to: 'n2' },
          { from: 'n2', to: 'n3' },
          { from: 'n3', to: 'n4' },
          { from: 'n3', to: 'n5' },
          { from: 'n4', to: 'n6' },
        ],
      },
    },
    critical_paths: [
      { path: 'src/server.ts', description: 'App bootstrap + middleware chain' },
      { path: 'src/api/public/index.ts', description: 'Public router — unauthenticated surface' },
      { path: 'src/middleware/auth.ts', description: 'Token validation, used by 14 routes' },
      { path: 'src/lib/redis.ts', description: 'Shared Redis singleton — reuse this' },
    ],
    run_steps: [
      { command: 'pnpm install', source_path: 'package.json' },
      { command: 'cp .env.example .env # add OPENAI + STRIPE keys', source_path: '.env.example' },
      { command: 'docker compose up -d postgres redis', source_path: 'docker-compose.yml' },
      { command: 'pnpm dev # http://localhost:3000', source_path: 'package.json' },
    ],
    reading_path: [
      { path: 'src/server.ts', why: 'See the whole request lifecycle in one file' },
      { path: 'src/api/public/index.ts', why: 'Understand the public contract before touching it' },
      { path: 'src/middleware/auth.ts', why: 'Auth touches almost everything downstream' },
    ],
    first_tasks: [
      {
        title: 'Cover expired tokens in auth middleware',
        description: 'Add a test that an expired token is rejected with 401 before any route handler runs.',
        size: 'S',
        files: ['src/middleware/auth.ts'],
      },
      {
        title: 'Reuse the shared Redis client for rate-limit buckets',
        description: 'Move the rate-limit buckets onto the shared Redis singleton instead of a new connection.',
        size: 'M',
        files: ['src/lib/redis.ts'],
      },
      {
        title: 'Document the public router endpoints',
        description: 'List each public route with its method, path and response shape in the router header.',
        size: 'S',
        files: ['src/api/public/index.ts'],
      },
    ],
  };
}
