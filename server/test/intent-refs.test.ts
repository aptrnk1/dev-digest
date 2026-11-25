import { describe, it, expect } from 'vitest';
import { extractRefs } from '../src/modules/intent/helpers.js';

const repo = { owner: 'acme', name: 'payments-api' };
const run = (body: string | null, branch = 'main') => extractRefs({ body, branch, repo });

describe('intent refs — issues', () => {
  it.each([
    ['Fixes #12', 12],
    ['closes: #7', 7],
    ['Resolved #3', 3],
    ['fixed #9', 9],
    ['Close #1', 1],
    ['resolves acme/payments-api#44', 44],
  ])('closing keyword %j', (body, n) => {
    expect(run(body).issues).toEqual([n]);
  });

  it('finds bare #N and same-repo owner/repo#N, ordered and deduped', () => {
    const r = run('See #5 and acme/payments-api#6. Fixes #5', 'main');
    expect(r.issues).toEqual([5, 6]);
  });

  it('puts closing keywords before bare refs, branch number last', () => {
    expect(run('mentions #2. Fixes #1', '42-add-limiter').issues).toEqual([1, 2, 42]);
  });

  it('takes the number from the branch', () => {
    expect(run('', 'feat/123_rate-limit').issues).toEqual([123]);
    expect(run('', 'feat/rate-limit').issues).toEqual([]);
  });

  it('sends another repo to unresolved without a fetch candidate', () => {
    const r = run('Fixes other/repo#8');
    expect(r.issues).toEqual([]);
    expect(r.unresolved).toEqual([{ ref: 'other/repo#8', reason: expect.stringContaining('another repository') }]);
  });

  it('ignores refs inside HTML comments (PR template)', () => {
    expect(run('<!-- Fixes #99 -->\nreal text').issues).toEqual([]);
  });

  it('does not mistake anchors or word-glued hashes for issues', () => {
    expect(run('see page#12 and a&#39;').issues).toEqual([]);
  });
});

describe('intent refs — trackers (AC8)', () => {
  it('recognises Jira keys and Linear URLs as unresolved only', () => {
    const r = run('Implements PAY-123, see https://linear.app/acme/issue/ENG-5/foo', 'feat/PAY-123-x');
    expect(r.issues).toEqual([]);
    expect(r.specs).toEqual([]);
    expect(r.unresolved.map((u) => u.ref).sort()).toEqual(
      ['PAY-123', 'https://linear.app/acme/issue/ENG-5/foo'].sort(),
    );
  });

  it('does not treat UTF-8 / SHA-256 as Jira keys', () => {
    expect(run('encoded as UTF-8, hashed with SHA-256').unresolved).toEqual([]);
  });
});

describe('intent refs — spec links (AC1, AC7)', () => {
  it('reads a relative markdown link and normalizes it', () => {
    expect(run('Plan: [spec](specs/foo.md) and [again](./specs/../specs/foo.md#x)').specs).toEqual(['specs/foo.md']);
  });

  it('reads a same-repo blob URL', () => {
    const r = run('https://github.com/acme/payments-api/blob/main/docs/plan.mdx');
    expect(r.specs).toEqual(['docs/plan.mdx']);
  });

  it('refuses another repo blob URL', () => {
    const url = 'https://github.com/evil/other/blob/main/README.md';
    const r = run(`[x](${url})`);
    expect(r.specs).toEqual([]);
    expect(r.unresolved).toEqual([{ ref: url, reason: expect.stringContaining('another repository') }]);
  });

  it('refuses a path that escapes the repo root', () => {
    const r = run('[p](../../etc/passwd)');
    expect(r.specs).toEqual([]);
    expect(r.unresolved).toEqual([{ ref: '../../etc/passwd', reason: expect.stringContaining('escapes') }]);
  });

  it('refuses an absolute path', () => {
    const r = run('[p](/etc/passwd.md)');
    expect(r.specs).toEqual([]);
    expect(r.unresolved[0]?.reason).toContain('absolute');
  });

  it('refuses extensions outside the allowlist, ignores images and extension-less links', () => {
    const r = run('[code](src/a.ts) ![img](pics/a.png) [nav](docs/guide) [ok](notes.txt)');
    expect(r.specs).toEqual(['notes.txt']);
    expect(r.unresolved).toEqual([{ ref: 'src/a.ts', reason: expect.stringContaining('unsupported') }]);
  });

  it('ignores mailto and external non-github links', () => {
    const r = run('[m](mailto:a@b.c) [x](https://example.com/spec.md)');
    expect(r.specs).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });
});
