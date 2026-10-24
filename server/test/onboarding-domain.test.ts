import { describe, it, expect } from 'vitest';
import { isSafeRelativePath, isStaleRunning } from '../src/modules/onboarding/domain.js';
import { ERROR_MESSAGES, httpError, STALE_RUN_MS } from '../src/modules/onboarding/constants.js';

describe('isSafeRelativePath', () => {
  it.each(['/etc/passwd', 'a/../b', '..', '../x', 'a\\b', 'a\0b', '', 'a//b'])('rejects %j', (p) => {
    expect(isSafeRelativePath(p)).toBe(false);
  });
  it.each(['src/index.ts', '..notes.md', 'a/..b/c.md', 'README.md'])('accepts %j', (p) => {
    expect(isSafeRelativePath(p)).toBe(true);
  });
});

describe('isStaleRunning', () => {
  const now = new Date('2026-01-01T01:00:00Z');
  const at = (ms: number) => ({ status: 'running', startedAt: new Date(now.getTime() - ms) });
  it('is false at exactly the threshold, true beyond it', () => {
    expect(isStaleRunning(at(STALE_RUN_MS), now, STALE_RUN_MS)).toBe(false);
    expect(isStaleRunning(at(STALE_RUN_MS + 1), now, STALE_RUN_MS)).toBe(true);
  });
  it('is false for non-running jobs', () => {
    expect(isStaleRunning({ status: 'done', startedAt: new Date(0) }, now, STALE_RUN_MS)).toBe(false);
    expect(isStaleRunning({ status: 'failed', startedAt: new Date(0) }, now, STALE_RUN_MS)).toBe(false);
  });
});

describe('ERROR_MESSAGES', () => {
  it('has seven fixed texts of at most 200 chars', () => {
    const texts = [...Object.values(ERROR_MESSAGES), httpError(503)];
    expect(Object.keys(ERROR_MESSAGES)).toHaveLength(6);
    expect(texts).toHaveLength(7);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(200);
  });
  it('formats the HTTP status', () => {
    expect(httpError(503)).toBe('The model provider returned an error (HTTP 503)');
  });
});
