import { describe, expect, it } from 'vitest';
import { RunRegistry } from '../../../src/adapters/memory/run-registry.js';

const ref = (n: number) => ({ prId: `pr-${n}`, repo: 'a/b', pr: n, agent: 'x' });

describe('RunRegistry', () => {
  it('remembers and looks up', () => {
    const r = new RunRegistry();
    r.remember('run-1', ref(1));
    expect(r.lookup('run-1')).toEqual(ref(1));
    expect(r.lookup('nope')).toBeUndefined();
  });

  it('evicts the oldest at the 201st entry', () => {
    const r = new RunRegistry();
    for (let i = 1; i <= 201; i++) r.remember(`run-${i}`, ref(i));
    expect(r.lookup('run-1')).toBeUndefined();
    expect(r.lookup('run-2')).toBeDefined();
    expect(r.lookup('run-201')).toBeDefined();
  });
});
