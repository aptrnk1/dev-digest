import { describe, expect, it } from 'vitest';
import { mergeAttachments } from '../src/modules/context/domain.js';

describe('mergeAttachments', () => {
  it('puts own docs first, then each skill in its order, via only for skills', () => {
    const out = mergeAttachments({
      own: ['a.md', 'b.md'],
      skills: [
        { skillId: 's1', skillName: 'One', paths: ['c.md', 'd.md'] },
        { skillId: 's2', skillName: 'Two', paths: ['e.md'] },
      ],
    });
    expect(out).toEqual([
      { path: 'a.md', via: null },
      { path: 'b.md', via: null },
      { path: 'c.md', via: { skillId: 's1', skillName: 'One' } },
      { path: 'd.md', via: { skillId: 's1', skillName: 'One' } },
      { path: 'e.md', via: { skillId: 's2', skillName: 'Two' } },
    ]);
  });

  it('dedupes: own wins over skill, first skill wins over later', () => {
    const out = mergeAttachments({
      own: ['a.md'],
      skills: [
        { skillId: 's1', skillName: 'One', paths: ['a.md', 'b.md'] },
        { skillId: 's2', skillName: 'Two', paths: ['b.md', 'c.md', 'c.md'] },
      ],
    });
    expect(out).toEqual([
      { path: 'a.md', via: null },
      { path: 'b.md', via: { skillId: 's1', skillName: 'One' } },
      { path: 'c.md', via: { skillId: 's2', skillName: 'Two' } },
    ]);
  });

  it('returns [] for nothing attached', () => {
    expect(mergeAttachments({ own: [], skills: [] })).toEqual([]);
  });
});
