import { describe, expect, it } from 'vitest';
import { categoryOf, folderOf, validateDocPath } from '../src/modules/context/paths.js';

describe('validateDocPath', () => {
  it.each(['README.md', 'docs/a.mdx', 'specs/x/y.md', '.devdigest/notes.md', 'a b/c.md'])(
    'accepts %s',
    (p) => expect(validateDocPath(p)).toEqual({ ok: true }),
  );

  it.each([
    ['/etc/passwd.md', 'absolute'],
    ['C:/x/a.md', 'absolute'],
    ['\\a.md', 'absolute'],
    ['../a.md', 'traversal'],
    ['docs/../../a.md', 'traversal'],
    ['docs\\..\\a.md', 'traversal'],
    ['a.txt', 'extension'],
    ['README', 'extension'],
    ['node_modules/x/a.md', 'excluded_dir'],
    ['docs/vendor/a.md', 'excluded_dir'],
    ['dist/a.md', 'excluded_dir'],
    ['build/a.md', 'excluded_dir'],
    ['.github/a.md', 'excluded_dir'],
    ['docs/.hidden/a.md', 'excluded_dir'],
    ['', 'empty'],
    ['a\0.md', 'invalid_char'],
  ])('rejects %s (%s)', (p, reason) => {
    expect(validateDocPath(p)).toEqual({ ok: false, reason });
  });
});

describe('categoryOf', () => {
  it.each([
    ['specs/a.md', 'specs'],
    ['docs/specs/a.md', 'specs'],
    ['feature.prd.md', 'specs'],
    ['insights/a.md', 'insights'],
    ['server/INSIGHTS.md', 'insights'],
    ['specs/insights/a.md', 'specs'],
    ['README.md', 'docs'],
    ['docs/guide.md', 'docs'],
  ])('%s -> %s', (p, c) => expect(categoryOf(p)).toBe(c));
});

describe('folderOf', () => {
  it('ends with / or is empty for root', () => {
    expect(folderOf('README.md')).toBe('');
    expect(folderOf('docs/a.md')).toBe('docs/');
    expect(folderOf('a/b/c.md')).toBe('a/b/');
  });
});
