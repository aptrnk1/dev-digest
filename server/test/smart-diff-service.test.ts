import { describe, it, expect, vi } from 'vitest';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import { SmartDiffDomainError } from '../src/modules/smart-diff/domain.js';
import type {
  FileRankSource,
  PullFilesRead,
  ReviewSource,
  SmartDiffStore,
} from '../src/modules/smart-diff/ports.js';

const pull: PullFilesRead = {
  prId: 'p1',
  repoId: 'r1',
  files: [
    { path: 'src/a.ts', additions: 5, deletions: 0, patch: null },
    { path: 'src/b.ts', additions: 1, deletions: 0, patch: null },
  ],
};

function setup(over: { pull?: PullFilesRead | undefined; ranks?: FileRankSource['getFileRank'] } = {}) {
  const reviews: ReviewSource = {
    listForPull: vi.fn(async () => [
      {
        id: 'rv',
        agent_id: 'ag',
        created_at: '2026-01-01T00:00:00Z',
        findings: [
          { id: 'f1', file: 'src/b.ts', start_line: 1, end_line: 3, severity: 'WARNING' as const, dismissed_at: null },
        ],
      },
    ]),
  };
  const ranks: FileRankSource = {
    getFileRank: vi.fn(over.ranks ?? (async () => [{ path: 'src/b.ts', percentile: 0.8 }])),
  };
  const store: SmartDiffStore = { loadPullFiles: vi.fn(async () => ('pull' in over ? over.pull : pull)) };
  return { service: new SmartDiffService({ store, reviews, ranks }), reviews, ranks, store };
}

describe('SmartDiffService', () => {
  it('unknown PR -> pr_not_found, no review/rank calls', async () => {
    const { service, reviews, ranks } = setup({ pull: undefined });
    await expect(service.get('w', 'p1')).rejects.toMatchObject({ code: 'pr_not_found' });
    await expect(service.get('w', 'p1')).rejects.toBeInstanceOf(SmartDiffDomainError);
    expect(reviews.listForPull).not.toHaveBeenCalled();
    expect(ranks.getFileRank).not.toHaveBeenCalled();
  });

  it('combines files, findings and ranks', async () => {
    const { service, ranks } = setup();
    const out = await service.get('w', 'p1');
    expect(ranks.getFileRank).toHaveBeenCalledWith('r1', ['src/a.ts', 'src/b.ts']);
    const files = out.groups[0]!.files;
    expect(files.map((f) => f.path)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(files[0]!.finding_ids).toEqual(['f1']);
    expect(files[0]!.rank_percentile).toBe(0.8);
  });

  it('empty ranks -> secondary sort, no error', async () => {
    const { service } = setup({ ranks: async () => [] });
    const out = await service.get('w', 'p1');
    expect(out.groups[0]!.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(out.groups[0]!.files[0]!.rank_percentile).toBeNull();
  });

  it('rejecting getFileRank -> no ranks, no throw', async () => {
    const { service } = setup({
      ranks: async () => {
        throw new Error('boom');
      },
    });
    const out = await service.get('w', 'p1');
    expect(out.groups[0]!.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
