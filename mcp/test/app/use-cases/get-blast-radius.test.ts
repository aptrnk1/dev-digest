import { describe, expect, it } from 'vitest';
import { makeGetBlastRadius } from '../../../src/app/use-cases/get-blast-radius.js';

describe('getBlastRadius', () => {
  it('returns the not_implemented stub', async () => {
    const r = await makeGetBlastRadius()({ repo: 'a/b', pr: 1 });
    expect(r.status).toBe('not_implemented');
    expect(r.hint.length).toBeGreaterThan(0);
  });
});
