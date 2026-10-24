import { describe, it, expect } from 'vitest';
import { OnboardingTour } from '@devdigest/shared';
import { sanitizeDraft, sanitizeLabel, truncate } from '../src/modules/onboarding/validate.js';
import type { OnboardingTourDraft } from '../src/modules/onboarding/prompt.js';

const FILES = new Set(Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`).concat(['README.md']));
const deps = (content: string[] = ['README.md', 'src/f0.ts']) => ({
  exists: async (p: string) => FILES.has(p),
  contentPaths: new Set(content),
});

function draft(over: Partial<OnboardingTourDraft> = {}): OnboardingTourDraft {
  return {
    summary: 's',
    diagram: { nodes: [], edges: [] },
    critical_paths: [],
    run_steps: [],
    reading_path: [],
    first_tasks: [],
    ...over,
  };
}
const f = (i: number) => `src/f${i}.ts`;

describe('truncate', () => {
  it('keeps short text, cuts long with an ellipsis within max', () => {
    expect(truncate('abc', 5)).toBe('abc');
    const t = truncate('x'.repeat(50), 10);
    expect(t).toHaveLength(10);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('sanitizeLabel (AC66)', () => {
  it('replaces diagram-breaking characters with _', () => {
    expect(sanitizeLabel('"]<script>')).toBe('___script_');
    expect(sanitizeLabel('')).toBe('_');
    expect(sanitizeLabel('x'.repeat(60))).toHaveLength(40);
  });
});

describe('sanitizeDraft', () => {
  it('AC62: drops missing / unsafe paths; diagram node keeps path null', async () => {
    const out = await sanitizeDraft(
      draft({
        diagram: {
          nodes: [
            { key: 'a', label: 'A', kind: 'module', path: f(0) },
            { key: 'b', label: 'B', kind: 'module', path: 'nope.ts' },
            { key: 'c', label: 'C', kind: 'module', path: '../etc/passwd' },
          ],
          edges: [],
        },
        critical_paths: [
          { path: f(0), description: 'ok' },
          { path: 'nope.ts', description: 'x' },
          { path: '/abs', description: 'x' },
        ],
        reading_path: [{ path: 'nope.ts', why: 'x' }],
      }),
      deps(),
    );
    expect(out.architecture.diagram.nodes.map((n) => n.path)).toEqual([f(0), null, null]);
    expect(out.critical_paths).toHaveLength(1);
    expect(out.reading_path).toHaveLength(0);
  });

  it('AC63: run step source must be a content path', async () => {
    const out = await sanitizeDraft(
      draft({
        run_steps: [
          { command: 'pnpm i', source_path: 'README.md' },
          { command: 'pnpm dev', source_path: f(5) }, // exists, but in tree only
        ],
      }),
      deps(),
    );
    expect(out.run_steps).toEqual([{ command: 'pnpm i', source_path: 'README.md' }]);
  });

  it('AC64: caps from the end, truncates texts, drops long commands', async () => {
    const out = await sanitizeDraft(
      draft({
        summary: 's'.repeat(900),
        critical_paths: Array.from({ length: 9 }, (_, i) => ({ path: f(i), description: 'd'.repeat(200) })),
        reading_path: Array.from({ length: 9 }, (_, i) => ({ path: f(i), why: 'w' })),
        run_steps: [
          ...Array.from({ length: 11 }, (_, i) => ({ command: `cmd ${i}`, source_path: 'README.md' })),
          { command: 'c'.repeat(501), source_path: 'README.md' },
        ],
        first_tasks: Array.from({ length: 6 }, (_, i) => ({
          title: `t${i}`,
          description: 'd',
          size: 'S' as const,
          files: [f(i)],
        })),
      }),
      deps(),
    );
    expect(out.critical_paths).toHaveLength(8);
    expect(out.critical_paths[0]!.description).toHaveLength(140);
    expect(out.reading_path).toHaveLength(8);
    expect(out.run_steps).toHaveLength(10);
    expect(out.first_tasks).toHaveLength(5);
    expect(out.architecture.summary).toHaveLength(800);
    expect(OnboardingTour.shape.critical_paths.safeParse(out.critical_paths).success).toBe(true);
  });

  it('AC64: fewer than the cap is kept as is', async () => {
    const out = await sanitizeDraft(draft({ critical_paths: [{ path: f(0), description: 'a' }] }), deps());
    expect(out.critical_paths).toHaveLength(1);
  });

  it('AC65: duplicates collapse to the first', async () => {
    const out = await sanitizeDraft(
      draft({
        critical_paths: [
          { path: f(0), description: 'first' },
          { path: f(0), description: 'second' },
        ],
        run_steps: [
          { command: 'x', source_path: 'README.md' },
          { command: 'x', source_path: 'README.md' },
        ],
      }),
      deps(),
    );
    expect(out.critical_paths).toEqual([{ path: f(0), description: 'first' }]);
    expect(out.run_steps).toHaveLength(1);
  });

  it('AC66: 13 nodes / 21 edges -> 12 / 20; unknown-node edge dropped; ids n1…', async () => {
    const nodes = Array.from({ length: 13 }, (_, i) => ({
      key: `k${i}`,
      label: i === 0 ? '"]<script>' : `N${i}`,
      kind: 'module' as const,
      path: null,
    }));
    const edges = [
      ...Array.from({ length: 21 }, (_, i) => ({ from: `k${i % 12}`, to: `k${(i + 1 + Math.floor(i / 12)) % 12}` })),
      { from: 'k0', to: 'ghost' },
    ];
    const out = await sanitizeDraft(draft({ diagram: { nodes, edges } }), deps());
    const d = out.architecture.diagram;
    expect(d.nodes).toHaveLength(12);
    expect(d.nodes[0]).toMatchObject({ id: 'n1', label: '___script_' });
    expect(d.edges.length).toBeLessThanOrEqual(20);
    expect(d.edges.every((e) => /^n\d+$/.test(e.from) && /^n\d+$/.test(e.to))).toBe(true);
    expect(d.edges.find((e) => e.to === 'ghost')).toBeUndefined();
  });

  it('AC69: task without valid files dropped; 4 files -> 3', async () => {
    const out = await sanitizeDraft(
      draft({
        first_tasks: [
          { title: 'none', description: 'd', size: 'S', files: ['nope.ts'] },
          { title: 'empty', description: 'd', size: 'M', files: [] },
          { title: 'many', description: 'd', size: 'M', files: [f(0), f(1), f(2), f(3)] },
        ],
      }),
      deps(),
    );
    expect(out.first_tasks).toHaveLength(1);
    expect(out.first_tasks[0]!.files).toEqual([f(0), f(1), f(2)]);
  });
});
